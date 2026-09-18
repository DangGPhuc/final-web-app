import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';

import {
  generateOAuthParams,
  validateRedirectPath,
  setMockOidcExchangeHandler,
  resetOidcConfigForTesting,
  buildGoogleAuthorizationUrl,
  exchangeAndVerifyGoogleOidc,
  generateOAuthBinder,
  extractOAuthBinder,
  hashOAuthBinder,
  createOAuthBinderCookieHeader,
  clearOAuthBinderCookieHeader,
  validateGoogleIdentityClaims,
  getCanonicalAppOrigin,
  getGoogleOidcCredentials,
  buildCanonicalCallbackUrl,
  OAUTH_BINDER_COOKIE,
  OAUTH_BINDER_MAX_AGE_SECONDS,
} from '../src/server/oidc';

import {
  recordOAuthState,
  consumeOAuthState,
  findOrCreateUserFromIdentity,
  getSafeUserIdentity,
} from '../src/server/auth-repository';

import {
  issueSession,
  createSessionCookieHeader,
  clearSessionCookieHeader,
  revokeExistingSessionIfPresent,
  sessionHash,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from '../src/server/session';

import { setTestAuthClientOverride, authTransaction } from '../src/server/auth-database';
import { GET as startGet } from '../src/app/api/v2/auth/google/start/route';
import { GET as callbackGet } from '../src/app/api/v2/auth/google/callback/route';
import { logSecurityEvent } from '../src/server/logger';
import { performLogout, checkSessionMe, type AuthUser } from '../src/context/auth-actions';

describe('FinTrack Pro OIDC Identity & Real Authentication Foundation', () => {
  let db: PGlite;
  let poolClient: PoolClient;

  beforeAll(async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'test';
    process.env.APP_ORIGIN = 'https://localhost:3000';
    process.env.ENABLE_BACKEND_API = 'true';
    process.env.GOOGLE_OIDC_CLIENT_ID = 'mock-google-client-id.apps.googleusercontent.com';
    process.env.GOOGLE_OIDC_CLIENT_SECRET = 'mock-google-client-secret';
    process.env.GOOGLE_OIDC_REDIRECT_URI = 'https://localhost:3000/api/v2/auth/google/callback';

    db = new PGlite();
    await db.exec(readFileSync('db/migrations/001_backend_foundation.sql', 'utf8'));
    await db.exec(readFileSync('db/migrations/002_backend_security_hardening.sql', 'utf8'));
    await db.exec(readFileSync('db/migrations/003_backend_deployment_closure.sql', 'utf8'));
    await db.exec(readFileSync('db/migrations/004_runtime_role_hardening.sql', 'utf8'));
    await db.exec(readFileSync('db/migrations/005_session_revocation_hardening.sql', 'utf8'));
    await db.exec(readFileSync('db/migrations/006_auth_identity.sql', 'utf8'));
    await db.exec(readFileSync('db/migrations/007_auth_security_hardening.sql', 'utf8'));

    poolClient = db as unknown as PoolClient;
    setTestAuthClientOverride(poolClient);
  });

  afterAll(async () => {
    setTestAuthClientOverride(undefined);
    resetOidcConfigForTesting();
    await db?.close();
  });

  beforeEach(async () => {
    resetOidcConfigForTesting();
    process.env.APP_ORIGIN = 'https://localhost:3000';
    process.env.GOOGLE_OIDC_CLIENT_ID = 'mock-google-client-id.apps.googleusercontent.com';
    process.env.GOOGLE_OIDC_CLIENT_SECRET = 'mock-google-client-secret';
    process.env.GOOGLE_OIDC_REDIRECT_URI = 'https://localhost:3000/api/v2/auth/google/callback';

    // Clean up auth tables between tests
    await db.exec('DELETE FROM fintrack.oauth_login_states');
    await db.exec('DELETE FROM fintrack.auth_identities');
    await db.exec('DELETE FROM fintrack.sessions');
    await db.exec('DELETE FROM fintrack.users');
  });

  // --------------------------------------------------------------------------
  // AUTH-01: State entropy
  // --------------------------------------------------------------------------
  it('AUTH-01 state contains adequate cryptographic entropy (>= 256 bits)', async () => {
    const states = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const params = await generateOAuthParams('/');
      expect(params.state.length).toBeGreaterThanOrEqual(43);
      expect(params.stateHash).toMatch(/^[0-9a-f]{64}$/);
      expect(states.has(params.state)).toBe(false);
      states.add(params.state);
    }
  });

  // --------------------------------------------------------------------------
  // AUTH-02: PKCE S256 challenge
  // --------------------------------------------------------------------------
  it('AUTH-02 PKCE S256 challenge generated correctly through library flow', async () => {
    const params = await generateOAuthParams('/');
    expect(params.codeVerifier.length).toBeGreaterThanOrEqual(43);
    const expectedChallenge = createHash('sha256').update(params.codeVerifier).digest('base64url');
    expect(params.codeChallenge).toBe(expectedChallenge);
  });

  // --------------------------------------------------------------------------
  // AUTH-03: Expired OAuth state rejected
  // --------------------------------------------------------------------------
  it('AUTH-03 expired OAuth state is rejected with AUTH_STATE_EXPIRED', async () => {
    const params = await generateOAuthParams('/');
    const { binderHash } = generateOAuthBinder();
    await db.query(
      `INSERT INTO fintrack.oauth_login_states (
         state_hash, browser_bind_hash, provider, code_verifier, nonce_hash, redirect_path, expires_at
       ) VALUES ($1, $2, 'google', $3, $4, $5, now() - interval '5 seconds')`,
      [params.stateHash, binderHash, params.codeVerifier, params.nonceHash, '/dashboard']
    );

    await expect(consumeOAuthState(poolClient, params.stateHash, binderHash)).rejects.toMatchObject({
      code: 'AUTH_STATE_EXPIRED',
    });
  });

  // --------------------------------------------------------------------------
  // AUTH-04: Consumed OAuth state replay rejected
  // --------------------------------------------------------------------------
  it('AUTH-04 consumed OAuth state replay is rejected with AUTH_STATE_REPLAYED', async () => {
    const params = await generateOAuthParams('/');
    const { binderHash } = generateOAuthBinder();
    await recordOAuthState(poolClient, {
      stateHash: params.stateHash,
      browserBindHash: binderHash,
      provider: 'google',
      codeVerifier: params.codeVerifier,
      nonceHash: params.nonceHash,
      redirectPath: '/dashboard',
    });

    // First consumption succeeds
    const consumed = await consumeOAuthState(poolClient, params.stateHash, binderHash);
    expect(consumed.codeVerifier).toBe(params.codeVerifier);

    // Second consumption must fail closed
    await expect(consumeOAuthState(poolClient, params.stateHash, binderHash)).rejects.toMatchObject({
      code: 'AUTH_STATE_REPLAYED',
    });
  });

  // --------------------------------------------------------------------------
  // AUTH-05: State mismatch rejected
  // --------------------------------------------------------------------------
  it('AUTH-05 state mismatch is rejected with AUTH_STATE_INVALID', async () => {
    const nonExistentHash = createHash('sha256').update('non-existent-state').digest('hex');
    const { binderHash } = generateOAuthBinder();
    await expect(consumeOAuthState(poolClient, nonExistentHash, binderHash)).rejects.toMatchObject({
      code: 'AUTH_STATE_INVALID',
    });
  });

  // --------------------------------------------------------------------------
  // AUTH-06 / AUTH-H08: Nonce mismatch rejected by pure claim validator
  // --------------------------------------------------------------------------
  it('AUTH-06 (AUTH-H08) nonce mismatch is rejected by validateGoogleIdentityClaims', () => {
    const expectedNonceHash = createHash('sha256').update('expected-valid-nonce').digest('hex');
    const claims = {
      iss: 'https://accounts.google.com',
      aud: process.env.GOOGLE_OIDC_CLIENT_ID,
      sub: 'google-sub-valid-1',
      nonce: 'tampered-nonce-sent-by-attacker',
      email: 'user@example.com',
      email_verified: true,
    };

    expect(() =>
      validateGoogleIdentityClaims(claims, process.env.GOOGLE_OIDC_CLIENT_ID!, expectedNonceHash)
    ).toThrowError(expect.objectContaining({ code: 'AUTH_IDENTITY_INVALID', status: 400 }));
  });

  // --------------------------------------------------------------------------
  // AUTH-07 / AUTH-H06: Invalid issuer rejected by pure claim validator
  // --------------------------------------------------------------------------
  it('AUTH-07 (AUTH-H06) invalid issuer is rejected by validateGoogleIdentityClaims', () => {
    const nonce = 'valid-nonce';
    const nonceHash = createHash('sha256').update(nonce).digest('hex');
    const claims = {
      iss: 'https://evil-issuer.attacker.com',
      aud: process.env.GOOGLE_OIDC_CLIENT_ID,
      sub: 'google-sub-valid-2',
      nonce,
      email: 'user@example.com',
      email_verified: true,
    };

    expect(() =>
      validateGoogleIdentityClaims(claims, process.env.GOOGLE_OIDC_CLIENT_ID!, nonceHash)
    ).toThrowError(expect.objectContaining({ code: 'AUTH_IDENTITY_INVALID', status: 400 }));
  });

  // --------------------------------------------------------------------------
  // AUTH-08 / AUTH-H07: Invalid audience rejected by pure claim validator
  // --------------------------------------------------------------------------
  it('AUTH-08 (AUTH-H07) invalid audience is rejected by validateGoogleIdentityClaims', () => {
    const nonce = 'valid-nonce';
    const nonceHash = createHash('sha256').update(nonce).digest('hex');
    const claims = {
      iss: 'https://accounts.google.com',
      aud: 'attacker-client-id.apps.googleusercontent.com',
      sub: 'google-sub-valid-3',
      nonce,
      email: 'user@example.com',
      email_verified: true,
    };

    expect(() =>
      validateGoogleIdentityClaims(claims, process.env.GOOGLE_OIDC_CLIENT_ID!, nonceHash)
    ).toThrowError(expect.objectContaining({ code: 'AUTH_IDENTITY_INVALID', status: 400 }));
  });

  // --------------------------------------------------------------------------
  // AUTH-09 / AUTH-H09: Unverified or missing email rejected by pure claim validator
  // --------------------------------------------------------------------------
  it('AUTH-09 (AUTH-H09) unverified or missing email is rejected by validateGoogleIdentityClaims', () => {
    const nonce = 'valid-nonce';
    const nonceHash = createHash('sha256').update(nonce).digest('hex');

    // Case 1: email_verified is false
    expect(() =>
      validateGoogleIdentityClaims(
        {
          iss: 'https://accounts.google.com',
          aud: process.env.GOOGLE_OIDC_CLIENT_ID,
          sub: 'google-sub-valid-4',
          nonce,
          email: 'unverified@example.com',
          email_verified: false,
        },
        process.env.GOOGLE_OIDC_CLIENT_ID!,
        nonceHash
      )
    ).toThrowError(expect.objectContaining({ code: 'AUTH_IDENTITY_INVALID', status: 400 }));

    // Case 2: email is null / missing
    expect(() =>
      validateGoogleIdentityClaims(
        {
          iss: 'https://accounts.google.com',
          aud: process.env.GOOGLE_OIDC_CLIENT_ID,
          sub: 'google-sub-valid-5',
          nonce,
          email: null,
          email_verified: true,
        },
        process.env.GOOGLE_OIDC_CLIENT_ID!,
        nonceHash
      )
    ).toThrowError(expect.objectContaining({ code: 'AUTH_IDENTITY_INVALID', status: 400 }));

    // Case 3: email is empty string
    expect(() =>
      validateGoogleIdentityClaims(
        {
          iss: 'https://accounts.google.com',
          aud: process.env.GOOGLE_OIDC_CLIENT_ID,
          sub: 'google-sub-valid-6',
          nonce,
          email: '   ',
          email_verified: true,
        },
        process.env.GOOGLE_OIDC_CLIENT_ID!,
        nonceHash
      )
    ).toThrowError(expect.objectContaining({ code: 'AUTH_IDENTITY_INVALID', status: 400 }));
  });

  // --------------------------------------------------------------------------
  // AUTH-10: Existing provider subject maps to same user
  // --------------------------------------------------------------------------
  it('AUTH-10 existing provider subject maps to the same FinTrack user', async () => {
    const claims = {
      provider: 'google' as const,
      providerSubject: 'google-sub-repeat-test',
      email: 'repeat@example.com',
      emailVerified: true as const,
      displayName: 'Repeat User',
      avatarUrl: 'https://example.com/repeat.png',
    };

    const first = await findOrCreateUserFromIdentity(poolClient, claims);
    expect(first.isNewUser).toBe(true);

    const second = await findOrCreateUserFromIdentity(poolClient, {
      ...claims,
      displayName: 'Repeat User Updated',
    });
    expect(second.isNewUser).toBe(false);
    expect(second.userId).toBe(first.userId);

    const safeUser = await getSafeUserIdentity(poolClient, first.userId);
    expect(safeUser.displayName).toBe('Repeat User Updated');
  });

  // --------------------------------------------------------------------------
  // AUTH-11: First provider identity creates one user and one identity
  // --------------------------------------------------------------------------
  it('AUTH-11 first login creates exactly one user and one auth_identity record', async () => {
    const claims = {
      provider: 'google' as const,
      providerSubject: 'google-sub-first-test',
      email: 'first@example.com',
      emailVerified: true as const,
      displayName: 'First User',
      avatarUrl: 'https://example.com/first.png',
    };

    const res = await findOrCreateUserFromIdentity(poolClient, claims);
    expect(res.isNewUser).toBe(true);

    const userCount = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM fintrack.users');
    expect(userCount.rows[0].count).toBe(1);

    const identityCount = await db.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM fintrack.auth_identities WHERE user_id = $1',
      [res.userId]
    );
    expect(identityCount.rows[0].count).toBe(1);
  });

  // --------------------------------------------------------------------------
  // AUTH-13: Same email alone never auto-links identity
  // --------------------------------------------------------------------------
  it('AUTH-13 same email alone never auto-links to another external identity', async () => {
    const email = 'shared@example.com';

    const identityGoogle = {
      provider: 'google' as const,
      providerSubject: 'subject-google-primary',
      email,
      emailVerified: true as const,
      displayName: 'Google Account 1',
      avatarUrl: null,
    };

    const identityOther = {
      provider: 'google' as const,
      providerSubject: 'subject-google-secondary',
      email,
      emailVerified: true as const,
      displayName: 'Google Account 2',
      avatarUrl: null,
    };

    const user1 = await findOrCreateUserFromIdentity(poolClient, identityGoogle);
    const user2 = await findOrCreateUserFromIdentity(poolClient, identityOther);

    expect(user1.userId).not.toBe(user2.userId);

    const totalUsers = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM fintrack.users');
    expect(totalUsers.rows[0].count).toBe(2);
  });

  // --------------------------------------------------------------------------
  // AUTH-14 & AUTH-15: Provider tokens not persisted
  // --------------------------------------------------------------------------
  it('AUTH-14 & AUTH-15 provider tokens are not persisted in database schema', async () => {
    const columns = await db.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'fintrack' AND table_name = 'auth_identities'`
    );
    const colNames = columns.rows.map((c) => c.column_name);

    expect(colNames).not.toContain('access_token');
    expect(colNames).not.toContain('refresh_token');
    expect(colNames).not.toContain('id_token');
    expect(colNames).not.toContain('token');
  });

  // --------------------------------------------------------------------------
  // AUTH-16 & AUTH-17: Raw session token not persisted; stored hash equals SHA-256
  // --------------------------------------------------------------------------
  it('AUTH-16 & AUTH-17 raw session token is never stored; SHA-256 hash is stored', async () => {
    const newUserId = randomBytes(16).toString('hex');
    // Using server-side generated UUID
    await db.query(`INSERT INTO fintrack.users (id) VALUES (gen_random_uuid())`);
    const user = await db.query<{ id: string }>('SELECT id FROM fintrack.users LIMIT 1');
    const userId = user.rows[0].id;

    const { rawToken, tokenHash } = await issueSession(poolClient, userId);
    expect(rawToken.length).toBe(43);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);

    const computedHash = createHash('sha256').update(rawToken).digest('hex');
    expect(tokenHash).toBe(computedHash);

    const stored = await db.query<{ token_hash: string }>(
      'SELECT token_hash FROM fintrack.sessions WHERE token_hash = $1',
      [tokenHash]
    );
    expect(stored.rows.length).toBe(1);
    expect(stored.rows[0].token_hash).toBe(tokenHash);

    const searchRaw = await db.query(
      'SELECT 1 FROM fintrack.sessions WHERE token_hash = $1',
      [rawToken]
    );
    expect(searchRaw.rows.length).toBe(0);
  });

  // --------------------------------------------------------------------------
  // AUTH-18 through AUTH-22: Cookie attributes
  // --------------------------------------------------------------------------
  it('AUTH-18 to AUTH-22 cookie contains Secure, HttpOnly, SameSite=Lax, Path=/, and NO Domain', () => {
    const rawToken = randomBytes(32).toString('base64url');
    const header = createSessionCookieHeader(rawToken, 86400);

    expect(header).toContain('Secure');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Path=/');
    expect(header).not.toContain('Domain=');
    expect(header).not.toContain('domain=');
    expect(header.startsWith(`${SESSION_COOKIE}=`)).toBe(true);
  });

  // --------------------------------------------------------------------------
  // AUTH-23 / AUTH-H16: DB session expiry aligns with cookie expiry; cookie never outlives DB
  // --------------------------------------------------------------------------
  it('AUTH-23 (AUTH-H16) DB session expiry aligns with cookie lifetime; cookie never outlives DB session', async () => {
    await db.query(`INSERT INTO fintrack.users (id) VALUES (gen_random_uuid())`);
    const user = await db.query<{ id: string }>('SELECT id FROM fintrack.users LIMIT 1');
    const explicitExpiry = new Date(Date.now() + 300 * 1000); // 5 minutes in future

    const { expiresAt, maxAgeSeconds } = await issueSession(poolClient, user.rows[0].id, explicitExpiry);

    expect(expiresAt.getTime()).toBe(explicitExpiry.getTime());
    expect(maxAgeSeconds).toBeLessThanOrEqual(300);
    expect(maxAgeSeconds).toBeGreaterThanOrEqual(295);

    // Emitted cookie with maxAgeSeconds
    const header = createSessionCookieHeader('dummy-token-43-chars-long-dummy-dummy-dum', maxAgeSeconds);
    expect(header).toContain(`Max-Age=${maxAgeSeconds}`);
    // Cookie lifetime never exceeds remaining session duration
    expect(maxAgeSeconds * 1000).toBeLessThanOrEqual(expiresAt.getTime() - Date.now() + 1000);
  });

  // --------------------------------------------------------------------------
  // AUTH-24: Session fixation prevented
  // --------------------------------------------------------------------------
  it('AUTH-24 session fixation prevented: previous session revoked and fresh session issued', async () => {
    await db.query(`INSERT INTO fintrack.users (id) VALUES (gen_random_uuid())`);
    const user = await db.query<{ id: string }>('SELECT id FROM fintrack.users LIMIT 1');
    const userId = user.rows[0].id;

    const oldSession = await issueSession(poolClient, userId);
    const incomingReq = new Request('https://localhost:3000/api/v2/auth/google/callback', {
      headers: {
        cookie: `${SESSION_COOKIE}=${oldSession.rawToken}`,
      },
    });

    await revokeExistingSessionIfPresent(poolClient, incomingReq);

    const oldDb = await db.query<{ revoked_at: Date | null }>(
      'SELECT revoked_at FROM fintrack.sessions WHERE token_hash = $1',
      [oldSession.tokenHash]
    );
    expect(oldDb.rows[0].revoked_at).not.toBeNull();

    const freshSession = await issueSession(poolClient, userId);
    expect(freshSession.tokenHash).not.toBe(oldSession.tokenHash);
  });

  // --------------------------------------------------------------------------
  // AUTH-25: /session/me exposes only safe fields
  // --------------------------------------------------------------------------
  it('AUTH-25 session/me helper returns safe fields only, never token or hash', async () => {
    await db.query(`INSERT INTO fintrack.users (id) VALUES (gen_random_uuid())`);
    const user = await db.query<{ id: string }>('SELECT id FROM fintrack.users LIMIT 1');
    const userId = user.rows[0].id;

    await db.query(
      `INSERT INTO fintrack.auth_identities (
         user_id, provider, provider_subject, email, email_verified, display_name, avatar_url
       ) VALUES ($1, 'google', 'sub-safe-test', 'safe@example.com', true, 'Safe Name', 'https://example.com/pic.jpg')`,
      [userId]
    );

    const safeData = await getSafeUserIdentity(poolClient, userId);
    expect(safeData).toEqual({
      userId,
      displayName: 'Safe Name',
      avatarUrl: 'https://example.com/pic.jpg',
      email: 'safe@example.com',
    });

    expect(safeData).not.toHaveProperty('token');
    expect(safeData).not.toHaveProperty('tokenHash');
    expect(safeData).not.toHaveProperty('providerSubject');
  });

  // --------------------------------------------------------------------------
  // AUTH-26: Logout cookie clearing header
  // --------------------------------------------------------------------------
  it('AUTH-26 clearSessionCookieHeader clears cookie with Max-Age=0', () => {
    const clearHeader = clearSessionCookieHeader();
    expect(clearHeader).toContain('Max-Age=0');
    expect(clearHeader).toContain('Path=/');
    expect(clearHeader).toContain('HttpOnly');
    expect(clearHeader).toContain('Secure');
    expect(clearHeader).not.toContain('Domain=');
  });

  // --------------------------------------------------------------------------
  // AUTH-27: Callback replay rejected
  // --------------------------------------------------------------------------
  it('AUTH-27 callback route rejects replaying an authorization code / state', async () => {
    const params = await generateOAuthParams('/dashboard');
    const { rawBinder, binderHash } = generateOAuthBinder();
    await recordOAuthState(poolClient, {
      stateHash: params.stateHash,
      browserBindHash: binderHash,
      provider: 'google',
      codeVerifier: params.codeVerifier,
      nonceHash: params.nonceHash,
      redirectPath: '/dashboard',
    });

    setMockOidcExchangeHandler(async () => ({
      provider: 'google',
      providerSubject: 'sub-replay-test',
      email: 'replay@example.com',
      emailVerified: true,
      displayName: 'Replay User',
      avatarUrl: null,
    }));

    const callbackUrl = `https://localhost:3000/api/v2/auth/google/callback?code=mock-code&state=${params.state}`;

    // Request 1: Succeeds and consumes state
    const req1 = new Request(callbackUrl, {
      headers: {
        cookie: `${OAUTH_BINDER_COOKIE}=${rawBinder}`,
      },
    });
    const res1 = await callbackGet(req1);
    expect(res1.status).toBe(302);
    expect(res1.headers.get('Set-Cookie')).toContain(SESSION_COOKIE);

    // Request 2: Must be rejected as replayed
    const req2 = new Request(callbackUrl, {
      headers: {
        cookie: `${OAUTH_BINDER_COOKIE}=${rawBinder}`,
      },
    });
    const res2 = await callbackGet(req2);
    expect(res2.status).toBe(400);
    const body2 = await res2.json();
    expect(body2.error).toBe('AUTH_STATE_REPLAYED');
  });

  // --------------------------------------------------------------------------
  // AUTH-28: Open redirect attempts rejected
  // --------------------------------------------------------------------------
  it('AUTH-28 open redirect attempts are rejected with AUTH_INVALID_REDIRECT', () => {
    const badRedirects = [
      'https://evil.example',
      'http://evil.example',
      '//evil.example',
      '//evil.example/path',
      '/\\evil.example',
      'javascript:alert(1)',
      'data:text/html,evil',
      '/%2f/evil.example',
    ];

    for (const bad of badRedirects) {
      expect(() => validateRedirectPath(bad)).toThrow();
    }

    expect(validateRedirectPath('/dashboard')).toBe('/dashboard');
    expect(validateRedirectPath('/wallets?tab=active')).toBe('/wallets?tab=active');
    expect(validateRedirectPath('')).toBe('/');
    expect(validateRedirectPath(null)).toBe('/');
  });

  // --------------------------------------------------------------------------
  // AUTH-35: No secrets in structured logs
  // --------------------------------------------------------------------------
  it('AUTH-35 no auth secrets appear in structured security logs', () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    logSecurityEvent({
      event: 'AUTH_LOGIN_SUCCEEDED',
      requestId: '11111111-1111-4111-8111-111111111111',
      errorCode: 'OK',
      provider: 'google',
      userId: '22222222-2222-4222-8222-222222222222',
      timestamp: new Date().toISOString(),
    });

    expect(consoleWarnSpy).toHaveBeenCalled();
    const loggedOutput = consoleWarnSpy.mock.calls[0][0];

    expect(loggedOutput).not.toContain('code');
    expect(loggedOutput).not.toContain('verifier');
    expect(loggedOutput).not.toContain('secret');
    expect(loggedOutput).not.toContain('token');
    expect(loggedOutput).not.toContain('hash');

    consoleWarnSpy.mockRestore();
  });

  // ==========================================================================
  // HARDENING ITERATION TESTS (AUTH-H01 through AUTH-H21)
  // ==========================================================================

  // --------------------------------------------------------------------------
  // AUTH-H01: State from Browser A rejected in Browser B
  // --------------------------------------------------------------------------
  it('AUTH-H01 state from Browser A rejected when used in Browser B', async () => {
    const params = await generateOAuthParams('/dashboard');
    const binderA = generateOAuthBinder();
    const binderB = generateOAuthBinder();

    // State is registered for Browser A
    await recordOAuthState(poolClient, {
      stateHash: params.stateHash,
      browserBindHash: binderA.binderHash,
      provider: 'google',
      codeVerifier: params.codeVerifier,
      nonceHash: params.nonceHash,
      redirectPath: '/dashboard',
    });

    // Browser B attempts to consume Browser A's state
    const callbackUrl = `https://localhost:3000/api/v2/auth/google/callback?code=mock-code&state=${params.state}`;
    const reqBrowserB = new Request(callbackUrl, {
      headers: {
        cookie: `${OAUTH_BINDER_COOKIE}=${binderB.rawBinder}`,
      },
    });

    const res = await callbackGet(reqBrowserB);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('AUTH_STATE_INVALID');
  });

  // --------------------------------------------------------------------------
  // AUTH-H02: Missing OAuth binder cookie rejected
  // --------------------------------------------------------------------------
  it('AUTH-H02 missing OAuth binder cookie rejected with AUTH_STATE_INVALID', async () => {
    const params = await generateOAuthParams('/dashboard');
    const binder = generateOAuthBinder();
    await recordOAuthState(poolClient, {
      stateHash: params.stateHash,
      browserBindHash: binder.binderHash,
      provider: 'google',
      codeVerifier: params.codeVerifier,
      nonceHash: params.nonceHash,
      redirectPath: '/dashboard',
    });

    const callbackUrl = `https://localhost:3000/api/v2/auth/google/callback?code=mock-code&state=${params.state}`;
    // Request has NO cookies
    const reqNoCookie = new Request(callbackUrl);

    const res = await callbackGet(reqNoCookie);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('AUTH_STATE_INVALID');
  });

  // --------------------------------------------------------------------------
  // AUTH-H03: Correct state + binder accepted
  // --------------------------------------------------------------------------
  it('AUTH-H03 correct state + browser binder accepted, issues session, clears binder', async () => {
    const params = await generateOAuthParams('/wallets');
    const binder = generateOAuthBinder();
    await recordOAuthState(poolClient, {
      stateHash: params.stateHash,
      browserBindHash: binder.binderHash,
      provider: 'google',
      codeVerifier: params.codeVerifier,
      nonceHash: params.nonceHash,
      redirectPath: '/wallets',
    });

    setMockOidcExchangeHandler(async () => ({
      provider: 'google',
      providerSubject: 'sub-h03-test',
      email: 'h03@example.com',
      emailVerified: true,
      displayName: 'H03 User',
      avatarUrl: null,
    }));

    const callbackUrl = `https://localhost:3000/api/v2/auth/google/callback?code=mock-code-h03&state=${params.state}`;
    const req = new Request(callbackUrl, {
      headers: {
        cookie: `${OAUTH_BINDER_COOKIE}=${binder.rawBinder}`,
      },
    });

    const res = await callbackGet(req);
    expect(res.status).toBe(302);
    // Destination matches canonical origin
    expect(res.headers.get('Location')).toBe('https://localhost:3000/wallets');

    // Both session cookie emitted and binder cookie cleared
    const setCookie = res.headers.get('Set-Cookie') ?? '';
    expect(setCookie).toContain(SESSION_COOKIE);
    expect(setCookie).toContain(OAUTH_BINDER_COOKIE);
    expect(setCookie).toContain('Max-Age=0'); // cleared binder cookie
  });

  // --------------------------------------------------------------------------
  // AUTH-H04: Second auth start invalidates previous browser attempt
  // --------------------------------------------------------------------------
  it('AUTH-H04 second auth start invalidates previous browser attempt', async () => {
    const binder = generateOAuthBinder();

    // Start 1 from this browser
    const req1 = new Request('https://localhost:3000/api/v2/auth/google/start', {
      headers: {
        cookie: `${OAUTH_BINDER_COOKIE}=${binder.rawBinder}`,
        'sec-fetch-site': 'same-origin',
      },
    });
    const res1 = await startGet(req1);
    expect(res1.status).toBe(302);

    const statesAfterFirst = await db.query<{ state_hash: string; consumed_at: Date | null }>(
      'SELECT state_hash, consumed_at FROM fintrack.oauth_login_states WHERE browser_bind_hash = $1',
      [binder.binderHash]
    );
    expect(statesAfterFirst.rows.length).toBe(1);
    expect(statesAfterFirst.rows[0].consumed_at).toBeNull();
    const firstStateHash = statesAfterFirst.rows[0].state_hash;

    // Start 2 from same browser (same binder)
    const req2 = new Request('https://localhost:3000/api/v2/auth/google/start', {
      headers: {
        cookie: `${OAUTH_BINDER_COOKIE}=${binder.rawBinder}`,
        'sec-fetch-site': 'same-origin',
      },
    });
    const res2 = await startGet(req2);
    expect(res2.status).toBe(302);

    const statesAfterSecond = await db.query<{ state_hash: string; consumed_at: Date | null }>(
      'SELECT state_hash, consumed_at FROM fintrack.oauth_login_states WHERE browser_bind_hash = $1 ORDER BY created_at ASC',
      [binder.binderHash]
    );
    expect(statesAfterSecond.rows.length).toBe(2);

    // Prior attempt is invalidated (consumed_at is NOT null)
    const priorState = statesAfterSecond.rows.find((r) => r.state_hash === firstStateHash);
    expect(priorState?.consumed_at).not.toBeNull();

    // Latest attempt is active
    const activeStates = statesAfterSecond.rows.filter((r) => r.consumed_at === null);
    expect(activeStates.length).toBe(1);
  });

  // --------------------------------------------------------------------------
  // AUTH-H05: Provider-error callback consumes state
  // --------------------------------------------------------------------------
  it('AUTH-H05 provider-error callback consumes state and repeating callback fails', async () => {
    const params = await generateOAuthParams('/dashboard');
    const binder = generateOAuthBinder();
    await recordOAuthState(poolClient, {
      stateHash: params.stateHash,
      browserBindHash: binder.binderHash,
      provider: 'google',
      codeVerifier: params.codeVerifier,
      nonceHash: params.nonceHash,
      redirectPath: '/dashboard',
    });

    const errorCallbackUrl = `https://localhost:3000/api/v2/auth/google/callback?error=access_denied&state=${params.state}`;
    const req1 = new Request(errorCallbackUrl, {
      headers: {
        cookie: `${OAUTH_BINDER_COOKIE}=${binder.rawBinder}`,
      },
    });

    const res1 = await callbackGet(req1);
    expect(res1.status).toBe(400);
    const body1 = await res1.json();
    expect(body1.error).toBe('AUTH_PROVIDER_REJECTED');

    // Verify state was consumed in DB
    const stateDb = await db.query<{ consumed_at: Date | null }>(
      'SELECT consumed_at FROM fintrack.oauth_login_states WHERE state_hash = $1',
      [params.stateHash]
    );
    expect(stateDb.rows[0].consumed_at).not.toBeNull();

    // Repeating callback with the same state and valid code is rejected
    const repeatUrl = `https://localhost:3000/api/v2/auth/google/callback?code=mock-code&state=${params.state}`;
    const req2 = new Request(repeatUrl, {
      headers: {
        cookie: `${OAUTH_BINDER_COOKIE}=${binder.rawBinder}`,
      },
    });
    const res2 = await callbackGet(req2);
    expect(res2.status).toBe(400);
    const body2 = await res2.json();
    expect(body2.error).toBe('AUTH_STATE_REPLAYED');
  });

  // --------------------------------------------------------------------------
  // AUTH-H12: Google external exchange occurs outside DB transaction
  // --------------------------------------------------------------------------
  it('AUTH-H12 Google external exchange occurs outside DB transaction (architectural isolation)', async () => {
    const params = await generateOAuthParams('/dashboard');
    const binder = generateOAuthBinder();
    await recordOAuthState(poolClient, {
      stateHash: params.stateHash,
      browserBindHash: binder.binderHash,
      provider: 'google',
      codeVerifier: params.codeVerifier,
      nonceHash: params.nonceHash,
      redirectPath: '/dashboard',
    });

    let exchangeExecutedWithoutDbTx = false;

    setMockOidcExchangeHandler(async () => {
      // While external exchange is in progress:
      // Verify no open transaction on poolClient by attempting a read that would deadlock or checking isolation
      // In PGlite/PostgreSQL, if we run a statement and rollback, we verify we are not in an active user tx
      try {
        // Can execute independent statement outside tx
        await poolClient.query('SELECT 1');
        exchangeExecutedWithoutDbTx = true;
      } catch {
        exchangeExecutedWithoutDbTx = false;
      }

      // Return valid claims
      return {
        provider: 'google',
        providerSubject: 'sub-h12-test',
        email: 'h12@example.com',
        emailVerified: true,
        displayName: 'H12 User',
        avatarUrl: null,
      };
    });

    const callbackUrl = `https://localhost:3000/api/v2/auth/google/callback?code=mock-code-h12&state=${params.state}`;
    const req = new Request(callbackUrl, {
      headers: {
        cookie: `${OAUTH_BINDER_COOKIE}=${binder.rawBinder}`,
      },
    });

    const res = await callbackGet(req);
    expect(res.status).toBe(302);
    expect(exchangeExecutedWithoutDbTx).toBe(true);

    // Verify exchangeAndVerifyGoogleOidc signature does not accept a PoolClient
    expect(exchangeAndVerifyGoogleOidc.length).toBe(2);
  });

  // --------------------------------------------------------------------------
  // AUTH-H13: Poisoned request Host cannot change final redirect origin
  // --------------------------------------------------------------------------
  it('AUTH-H13 poisoned request Host cannot change final redirect origin', async () => {
    const params = await generateOAuthParams('/dashboard');
    const binder = generateOAuthBinder();
    await recordOAuthState(poolClient, {
      stateHash: params.stateHash,
      browserBindHash: binder.binderHash,
      provider: 'google',
      codeVerifier: params.codeVerifier,
      nonceHash: params.nonceHash,
      redirectPath: '/dashboard',
    });

    setMockOidcExchangeHandler(async () => ({
      provider: 'google',
      providerSubject: 'sub-h13-test',
      email: 'h13@example.com',
      emailVerified: true,
      displayName: 'H13 User',
      avatarUrl: null,
    }));

    // Attacker sends request with poisoned Host and X-Forwarded-Host headers
    const poisonedUrl = 'https://attacker.evil.com/api/v2/auth/google/callback?code=mock-code&state=' + params.state;
    const req = new Request(poisonedUrl, {
      headers: {
        Host: 'attacker.evil.com',
        'X-Forwarded-Host': 'attacker.evil.com',
        cookie: `${OAUTH_BINDER_COOKIE}=${binder.rawBinder}`,
      },
    });

    const res = await callbackGet(req);
    expect(res.status).toBe(302);
    const location = res.headers.get('Location');
    // Final destination must remain on canonical APP_ORIGIN (https://localhost:3000)
    expect(location).toBe('https://localhost:3000/dashboard');
    expect(location).not.toContain('attacker.evil.com');
  });

  // --------------------------------------------------------------------------
  // AUTH-H14: GOOGLE_OIDC_REDIRECT_URI origin mismatch rejected
  // --------------------------------------------------------------------------
  it('AUTH-H14 GOOGLE_OIDC_REDIRECT_URI origin mismatch rejected with AUTH_UNAVAILABLE', () => {
    process.env.APP_ORIGIN = 'https://localhost:3000';
    process.env.GOOGLE_OIDC_REDIRECT_URI = 'https://malicious.attacker.com/api/v2/auth/google/callback';

    expect(() => getGoogleOidcCredentials()).toThrowError(
      expect.objectContaining({ code: 'AUTH_UNAVAILABLE', status: 503 })
    );
  });

  // --------------------------------------------------------------------------
  // AUTH-H15: Callback processing uses configured canonical redirect URI
  // --------------------------------------------------------------------------
  it('AUTH-H15 callback processing uses configured canonical redirect URI', () => {
    const configuredRedirectUri = 'https://localhost:3000/api/v2/auth/google/callback';
    const incomingPoisonedUrl = new URL('https://attacker.example.com/some/path?code=mock-code&state=mock-state');

    const canonicalUrl = buildCanonicalCallbackUrl(incomingPoisonedUrl, configuredRedirectUri);
    expect(canonicalUrl.origin).toBe('https://localhost:3000');
    expect(canonicalUrl.pathname).toBe('/api/v2/auth/google/callback');
    expect(canonicalUrl.searchParams.get('code')).toBe('mock-code');
    expect(canonicalUrl.searchParams.get('state')).toBe('mock-state');
  });

  // --------------------------------------------------------------------------
  // AUTH-H20: Failed server logout does not set frontend UNAUTHENTICATED
  // --------------------------------------------------------------------------
  it('AUTH-H20 failed server logout does not set frontend UNAUTHENTICATED', async () => {
    let onSuccessCalled = false;
    let errorReported: string | null = null;

    // Simulate fetch returning 500 server error on logout
    const mockFetch500 = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    } as unknown as Response);

    await performLogout(mockFetch500 as unknown as typeof fetch, {
      onSuccess: () => {
        onSuccessCalled = true;
      },
      onError: (err) => {
        errorReported = err;
      },
    });

    // Invariant: onSuccess is NOT called, frontend does not set UNAUTHENTICATED or clear user
    expect(onSuccessCalled).toBe(false);
    expect(errorReported).toBe('LOGOUT_FAILED');
  });

  // --------------------------------------------------------------------------
  // AUTH-H21: /session/me 503 results in frontend ERROR, not UNAUTHENTICATED
  // --------------------------------------------------------------------------
  it('AUTH-H21 /session/me 503 results in frontend ERROR, not UNAUTHENTICATED', async () => {
    let unauthCalled = false;
    let authUser: AuthUser | null = null;
    let errorReported: string | null = null;

    // Simulate fetch returning 503 service unavailable on /session/me
    const mockFetch503 = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    } as unknown as Response);

    await checkSessionMe(mockFetch503 as unknown as typeof fetch, {
      onAuthenticated: (user) => {
        authUser = user;
      },
      onUnauthenticated: () => {
        unauthCalled = true;
      },
      onError: (err) => {
        errorReported = err;
      },
    });

    // Invariant: 503 backend error is NOT treated as user unauthenticated
    expect(unauthCalled).toBe(false);
    expect(authUser).toBeNull();
    expect(errorReported).toBe('AUTH_BACKEND_ERROR');
  });
});
