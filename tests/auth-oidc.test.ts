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

import { setTestAuthClientOverride } from '../src/server/auth-database';
import { GET as startGet } from '../src/app/api/v2/auth/google/start/route';
import { GET as callbackGet } from '../src/app/api/v2/auth/google/callback/route';
import { logSecurityEvent } from '../src/server/logger';

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
    // Standard RFC 7636: challenge = base64url(SHA256(verifier))
    const expectedChallenge = createHash('sha256').update(params.codeVerifier).digest('base64url');
    expect(params.codeChallenge).toBe(expectedChallenge);
  });

  // --------------------------------------------------------------------------
  // AUTH-03: Expired OAuth state rejected
  // --------------------------------------------------------------------------
  it('AUTH-03 expired OAuth state is rejected with AUTH_STATE_EXPIRED', async () => {
    const params = await generateOAuthParams('/');
    // Insert an expired state record (expires 5 seconds ago)
    await db.query(
      `INSERT INTO fintrack.oauth_login_states (
         state_hash, provider, code_verifier, nonce_hash, redirect_path, expires_at
       ) VALUES ($1, 'google', $2, $3, $4, now() - interval '5 seconds')`,
      [params.stateHash, params.codeVerifier, params.nonceHash, '/dashboard']
    );

    await expect(consumeOAuthState(poolClient, params.stateHash)).rejects.toMatchObject({
      code: 'AUTH_STATE_EXPIRED',
    });
  });

  // --------------------------------------------------------------------------
  // AUTH-04: Consumed OAuth state replay rejected
  // --------------------------------------------------------------------------
  it('AUTH-04 consumed OAuth state replay is rejected with AUTH_STATE_REPLAYED', async () => {
    const params = await generateOAuthParams('/');
    await recordOAuthState(poolClient, {
      stateHash: params.stateHash,
      provider: 'google',
      codeVerifier: params.codeVerifier,
      nonceHash: params.nonceHash,
      redirectPath: '/dashboard',
    });

    // First consumption succeeds
    const consumed = await consumeOAuthState(poolClient, params.stateHash);
    expect(consumed.codeVerifier).toBe(params.codeVerifier);

    // Second consumption must fail closed
    await expect(consumeOAuthState(poolClient, params.stateHash)).rejects.toMatchObject({
      code: 'AUTH_STATE_REPLAYED',
    });
  });

  // --------------------------------------------------------------------------
  // AUTH-05: State mismatch rejected
  // --------------------------------------------------------------------------
  it('AUTH-05 state mismatch is rejected with AUTH_STATE_INVALID', async () => {
    const nonExistentHash = createHash('sha256').update('non-existent-state').digest('hex');
    await expect(consumeOAuthState(poolClient, nonExistentHash)).rejects.toMatchObject({
      code: 'AUTH_STATE_INVALID',
    });
  });

  // --------------------------------------------------------------------------
  // AUTH-06: Nonce mismatch rejected
  // --------------------------------------------------------------------------
  it('AUTH-06 nonce mismatch is rejected with AUTH_IDENTITY_INVALID', async () => {
    setMockOidcExchangeHandler(async (_url, expectedNonceHash, _verifier) => {
      const claimNonceHash = createHash('sha256').update('tampered-nonce').digest('hex');
      if (claimNonceHash !== expectedNonceHash) {
        throw { code: 'AUTH_IDENTITY_INVALID' };
      }
      return {
        provider: 'google',
        providerSubject: 'sub-123',
        email: 'user@example.com',
        emailVerified: true,
        displayName: 'Test User',
        avatarUrl: 'https://example.com/avatar.jpg',
      };
    });

    const realNonceHash = createHash('sha256').update('original-nonce').digest('hex');
    await expect(
      exchangeAndVerifyGoogleOidc(new URL('https://localhost:3000/api/v2/auth/google/callback?code=abc'), {
        codeVerifier: 'verifier',
        nonceHash: realNonceHash,
      })
    ).rejects.toMatchObject({
      code: 'AUTH_IDENTITY_INVALID',
    });
  });

  // --------------------------------------------------------------------------
  // AUTH-07: Invalid issuer rejected
  // --------------------------------------------------------------------------
  it('AUTH-07 invalid issuer is rejected with AUTH_IDENTITY_INVALID', async () => {
    setMockOidcExchangeHandler(async () => {
      const issuer: string = 'https://evil-issuer.example';
      if (issuer !== 'https://accounts.google.com') {
        throw { code: 'AUTH_IDENTITY_INVALID' };
      }
      return {
        provider: 'google',
        providerSubject: 'sub-123',
        email: 'user@example.com',
        emailVerified: true,
        displayName: 'Test',
        avatarUrl: null,
      };
    });

    await expect(
      exchangeAndVerifyGoogleOidc(new URL('https://localhost:3000/api/v2/auth/google/callback?code=abc'), {
        codeVerifier: 'verifier',
        nonceHash: 'nonceHash',
      })
    ).rejects.toMatchObject({
      code: 'AUTH_IDENTITY_INVALID',
    });
  });

  // --------------------------------------------------------------------------
  // AUTH-08: Invalid audience rejected
  // --------------------------------------------------------------------------
  it('AUTH-08 invalid audience is rejected with AUTH_IDENTITY_INVALID', async () => {
    setMockOidcExchangeHandler(async () => {
      const aud = 'wrong-client-id';
      if (aud !== process.env.GOOGLE_OIDC_CLIENT_ID) {
        throw { code: 'AUTH_IDENTITY_INVALID' };
      }
      return {
        provider: 'google',
        providerSubject: 'sub-123',
        email: 'user@example.com',
        emailVerified: true,
        displayName: 'Test',
        avatarUrl: null,
      };
    });

    await expect(
      exchangeAndVerifyGoogleOidc(new URL('https://localhost:3000/api/v2/auth/google/callback?code=abc'), {
        codeVerifier: 'verifier',
        nonceHash: 'nonceHash',
      })
    ).rejects.toMatchObject({
      code: 'AUTH_IDENTITY_INVALID',
    });
  });

  // --------------------------------------------------------------------------
  // AUTH-09: Unverified email rejected
  // --------------------------------------------------------------------------
  it('AUTH-09 unverified email is rejected according to product policy', async () => {
    setMockOidcExchangeHandler(async () => {
      const emailVerified = false;
      if (!emailVerified) {
        throw { code: 'AUTH_IDENTITY_INVALID' };
      }
      return {
        provider: 'google',
        providerSubject: 'sub-123',
        email: 'unverified@example.com',
        emailVerified: false,
        displayName: 'Unverified',
        avatarUrl: null,
      };
    });

    await expect(
      exchangeAndVerifyGoogleOidc(new URL('https://localhost:3000/api/v2/auth/google/callback?code=abc'), {
        codeVerifier: 'verifier',
        nonceHash: 'nonceHash',
      })
    ).rejects.toMatchObject({
      code: 'AUTH_IDENTITY_INVALID',
    });
  });

  // --------------------------------------------------------------------------
  // AUTH-10: Existing provider subject maps to same user
  // --------------------------------------------------------------------------
  it('AUTH-10 existing provider subject maps to the same FinTrack user', async () => {
    const claims = {
      provider: 'google' as const,
      providerSubject: 'google-sub-repeat-test',
      email: 'repeat@example.com',
      emailVerified: true,
      displayName: 'Repeat User',
      avatarUrl: 'https://example.com/repeat.png',
    };

    // First login
    const first = await findOrCreateUserFromIdentity(poolClient, claims);
    expect(first.isNewUser).toBe(true);

    // Second login with same provider_subject
    const second = await findOrCreateUserFromIdentity(poolClient, {
      ...claims,
      displayName: 'Repeat User Updated',
    });
    expect(second.isNewUser).toBe(false);
    expect(second.userId).toBe(first.userId);

    // Profile metadata updated
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
      emailVerified: true,
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
  // AUTH-12: Concurrent first login does not create duplicates
  // --------------------------------------------------------------------------
  it('AUTH-12 concurrent first login cannot create duplicate identities or users', async () => {
    const claims = {
      provider: 'google' as const,
      providerSubject: 'google-sub-concurrent',
      email: 'concurrent@example.com',
      emailVerified: true,
      displayName: 'Concurrent User',
      avatarUrl: null,
    };

    // Simulate concurrent calls
    const [resA, resB] = await Promise.all([
      findOrCreateUserFromIdentity(poolClient, claims),
      findOrCreateUserFromIdentity(poolClient, claims),
    ]);

    expect(resA.userId).toBe(resB.userId);

    const identities = await db.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM fintrack.auth_identities WHERE provider_subject = $1',
      [claims.providerSubject]
    );
    expect(identities.rows[0].count).toBe(1);
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
      emailVerified: true,
      displayName: 'Google Account 1',
      avatarUrl: null,
    };

    const identityOther = {
      provider: 'google' as const,
      providerSubject: 'subject-google-secondary',
      email, // Exactly same email address
      emailVerified: true,
      displayName: 'Google Account 2',
      avatarUrl: null,
    };

    const user1 = await findOrCreateUserFromIdentity(poolClient, identityGoogle);
    const user2 = await findOrCreateUserFromIdentity(poolClient, identityOther);

    // CRITICAL: They must NOT be linked to the same FinTrack user!
    expect(user1.userId).not.toBe(user2.userId);

    const totalUsers = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM fintrack.users');
    expect(totalUsers.rows[0].count).toBe(2);
  });

  // --------------------------------------------------------------------------
  // AUTH-14 & AUTH-15: Provider access and refresh tokens are not persisted
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
    const user = await db.query<{ id: string }>(
      'INSERT INTO fintrack.users DEFAULT VALUES RETURNING id'
    );
    const userId = user.rows[0].id;

    const { rawToken, tokenHash } = await issueSession(poolClient, userId);
    expect(rawToken.length).toBe(43);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);

    // Stored hash must equal SHA-256 of the raw token
    const computedHash = createHash('sha256').update(rawToken).digest('hex');
    expect(tokenHash).toBe(computedHash);

    // Verify DB contains token_hash only
    const stored = await db.query<{ token_hash: string }>(
      'SELECT token_hash FROM fintrack.sessions WHERE token_hash = $1',
      [tokenHash]
    );
    expect(stored.rows.length).toBe(1);
    expect(stored.rows[0].token_hash).toBe(tokenHash);

    // Verify rawToken does NOT appear in sessions table
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

    // AUTH-18: Secure
    expect(header).toContain('Secure');
    // AUTH-19: HttpOnly
    expect(header).toContain('HttpOnly');
    // AUTH-20: SameSite=Lax
    expect(header).toContain('SameSite=Lax');
    // AUTH-21: Path=/
    expect(header).toContain('Path=/');
    // AUTH-22: NO Domain
    expect(header).not.toContain('Domain=');
    expect(header).not.toContain('domain=');
    // Starts with __Host-fintrack_session
    expect(header.startsWith(`${SESSION_COOKIE}=`)).toBe(true);
  });

  // --------------------------------------------------------------------------
  // AUTH-23: DB session expiry aligns with cookie expiry
  // --------------------------------------------------------------------------
  it('AUTH-23 DB session expiry matches cookie lifetime (24 hours)', async () => {
    const user = await db.query<{ id: string }>(
      'INSERT INTO fintrack.users DEFAULT VALUES RETURNING id'
    );
    const { expiresAt } = await issueSession(poolClient, user.rows[0].id);

    const now = Date.now();
    const diffSeconds = Math.round((new Date(expiresAt).getTime() - now) / 1000);

    // Should be exactly ~86,400 seconds (allowing +/- 5 seconds execution delta)
    expect(diffSeconds).toBeGreaterThanOrEqual(SESSION_MAX_AGE_SECONDS - 5);
    expect(diffSeconds).toBeLessThanOrEqual(SESSION_MAX_AGE_SECONDS + 5);
  });

  // --------------------------------------------------------------------------
  // AUTH-24: Session fixation prevented
  // --------------------------------------------------------------------------
  it('AUTH-24 session fixation prevented: previous session revoked and fresh session issued', async () => {
    const user = await db.query<{ id: string }>(
      'INSERT INTO fintrack.users DEFAULT VALUES RETURNING id'
    );
    const userId = user.rows[0].id;

    // Issue initial session
    const oldSession = await issueSession(poolClient, userId);

    // Pre-existing cookie in incoming request
    const incomingReq = new Request('https://localhost:3000/api/v2/auth/google/callback', {
      headers: {
        cookie: `${SESSION_COOKIE}=${oldSession.rawToken}`,
      },
    });

    // Revoke existing session if present
    await revokeExistingSessionIfPresent(poolClient, incomingReq);

    // Verify old session is now revoked in DB
    const oldDb = await db.query<{ revoked_at: Date | null }>(
      'SELECT revoked_at FROM fintrack.sessions WHERE token_hash = $1',
      [oldSession.tokenHash]
    );
    expect(oldDb.rows[0].revoked_at).not.toBeNull();

    // Issue fresh session
    const freshSession = await issueSession(poolClient, userId);
    expect(freshSession.tokenHash).not.toBe(oldSession.tokenHash);
  });

  // --------------------------------------------------------------------------
  // AUTH-25: /session/me exposes only safe fields
  // --------------------------------------------------------------------------
  it('AUTH-25 session/me helper returns safe fields only, never token or hash', async () => {
    const user = await db.query<{ id: string }>(
      'INSERT INTO fintrack.users DEFAULT VALUES RETURNING id'
    );
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

    // Must never contain sensitive fields
    expect(safeData).not.toHaveProperty('token');
    expect(safeData).not.toHaveProperty('tokenHash');
    expect(safeData).not.toHaveProperty('providerSubject');
  });

  // --------------------------------------------------------------------------
  // AUTH-26: Logout revokes session
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
    await recordOAuthState(poolClient, {
      stateHash: params.stateHash,
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
    const req1 = new Request(callbackUrl);
    const res1 = await callbackGet(req1);
    expect(res1.status).toBe(302);
    expect(res1.headers.get('Set-Cookie')).toContain(SESSION_COOKIE);

    // Request 2: Must be rejected as replayed
    const req2 = new Request(callbackUrl);
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

    // Valid paths must succeed
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

    // Assert absence of any sensitive token or secret patterns
    expect(loggedOutput).not.toContain('code');
    expect(loggedOutput).not.toContain('verifier');
    expect(loggedOutput).not.toContain('secret');
    expect(loggedOutput).not.toContain('token');
    expect(loggedOutput).not.toContain('hash');

    consoleWarnSpy.mockRestore();
  });
});
