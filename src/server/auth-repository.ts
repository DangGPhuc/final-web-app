import 'server-only';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { ApiError } from './errors';
import type { VerifiedIdentityClaims } from './oidc';

export const MAX_OUTSTANDING_OAUTH_STATES = 1000;

export async function recordOAuthState(
  c: PoolClient,
  params: {
    stateHash: string;
    browserBindHash: string;
    provider: string;
    codeVerifier: string;
    nonceHash: string;
    redirectPath: string;
  }
): Promise<void> {
  // Pre-auth rate limit / bound outstanding active states globally (circuit breaker)
  const activeCountRes = await c.query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM fintrack.oauth_login_states
     WHERE consumed_at IS NULL AND expires_at > now()`
  );
  const activeCount = parseInt(activeCountRes.rows[0]?.count ?? '0', 10);
  if (activeCount >= MAX_OUTSTANDING_OAUTH_STATES) {
    throw new ApiError(429, 'AUTH_RATE_LIMITED');
  }

  // Enforce 1 active OAuth login attempt per browser binder:
  // Invalidate any previous active attempt for the same browser binder.
  await c.query(
    `UPDATE fintrack.oauth_login_states
     SET consumed_at = now()
     WHERE browser_bind_hash = $1 AND consumed_at IS NULL`,
    [params.browserBindHash]
  );

  await c.query(
    `INSERT INTO fintrack.oauth_login_states (
       state_hash, browser_bind_hash, provider, code_verifier, nonce_hash, redirect_path, expires_at
     ) VALUES ($1, $2, $3, $4, $5, $6, now() + interval '10 minutes')`,
    [
      params.stateHash,
      params.browserBindHash,
      params.provider,
      params.codeVerifier,
      params.nonceHash,
      params.redirectPath,
    ]
  );
}

export async function consumeOAuthState(
  c: PoolClient,
  stateHash: string,
  browserBindHash: string
): Promise<{
  provider: string;
  codeVerifier: string;
  nonceHash: string;
  redirectPath: string;
}> {
  const res = await c.query<{
    state_hash: string;
    browser_bind_hash: string;
    provider: string;
    code_verifier: string;
    nonce_hash: string;
    redirect_path: string;
    expires_at: Date;
    consumed_at: Date | null;
  }>(
    `SELECT state_hash, browser_bind_hash, provider, code_verifier, nonce_hash, redirect_path, expires_at, consumed_at
     FROM fintrack.oauth_login_states
     WHERE state_hash = $1
     FOR UPDATE`,
    [stateHash]
  );

  if (res.rows.length === 0) {
    throw new ApiError(400, 'AUTH_STATE_INVALID');
  }

  const record = res.rows[0];

  // Callback must validate that both state and browser binder match the same row
  if (record.browser_bind_hash !== browserBindHash) {
    throw new ApiError(400, 'AUTH_STATE_INVALID');
  }

  if (record.consumed_at !== null) {
    throw new ApiError(400, 'AUTH_STATE_REPLAYED');
  }

  const now = new Date();
  if (new Date(record.expires_at) <= now) {
    throw new ApiError(400, 'AUTH_STATE_EXPIRED');
  }

  await c.query(
    `UPDATE fintrack.oauth_login_states
     SET consumed_at = now()
     WHERE state_hash = $1`,
    [stateHash]
  );

  return {
    provider: record.provider,
    codeVerifier: record.code_verifier,
    nonceHash: record.nonce_hash,
    redirectPath: record.redirect_path,
  };
}

export async function findOrCreateUserFromIdentity(
  c: PoolClient,
  claims: VerifiedIdentityClaims
): Promise<{ userId: string; isNewUser: boolean }> {
  // 1. Transaction-scoped PostgreSQL advisory lock before lookup/create.
  // Namespace: auth-identity:<provider>:<providerSubject>
  const identityKey = `auth-identity:${claims.provider}:${claims.providerSubject}`;
  await c.query(
    `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
    [identityKey]
  );

  // 2. Look up existing identity strictly by (provider, provider_subject)
  // Invariant: Email alone NEVER auto-links accounts
  const existingRes = await c.query<{ user_id: string }>(
    `SELECT user_id
     FROM fintrack.auth_identities
     WHERE provider = $1 AND provider_subject = $2
     FOR UPDATE`,
    [claims.provider, claims.providerSubject]
  );

  if (existingRes.rows.length > 0) {
    const userId = existingRes.rows[0].user_id;
    // Update profile metadata and last_login_at
    await c.query(
      `UPDATE fintrack.auth_identities
       SET last_login_at = now(),
           email = $1,
           email_verified = $2,
           display_name = $3,
           avatar_url = $4
       WHERE provider = $5 AND provider_subject = $6`,
      [
        claims.email,
        claims.emailVerified,
        claims.displayName,
        claims.avatarUrl,
        claims.provider,
        claims.providerSubject,
      ]
    );
    return { userId, isNewUser: false };
  }

  // 3. New identity: Generate UUID in trusted server code (no SELECT/RETURNING privileges needed on users table)
  const newUserId = randomUUID();
  await c.query(
    `INSERT INTO fintrack.users (id) VALUES ($1)`,
    [newUserId]
  );

  // 4. Atomically attach identity; handle concurrent creation race condition gracefully (defense-in-depth)
  const identityRes = await c.query<{ user_id: string }>(
    `INSERT INTO fintrack.auth_identities (
       user_id, provider, provider_subject, email, email_verified, display_name, avatar_url, last_login_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (provider, provider_subject) DO UPDATE
     SET last_login_at = now(),
         email = EXCLUDED.email,
         email_verified = EXCLUDED.email_verified,
         display_name = EXCLUDED.display_name,
         avatar_url = EXCLUDED.avatar_url
     RETURNING user_id`,
    [
      newUserId,
      claims.provider,
      claims.providerSubject,
      claims.email,
      claims.emailVerified,
      claims.displayName,
      claims.avatarUrl,
    ]
  );

  const resolvedUserId = identityRes.rows[0].user_id;
  return { userId: resolvedUserId, isNewUser: resolvedUserId === newUserId };
}

export async function getSafeUserIdentity(
  c: PoolClient,
  userId: string
): Promise<{
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  email: string | null;
}> {
  const res = await c.query<{
    user_id: string;
    display_name: string | null;
    avatar_url: string | null;
    email: string | null;
  }>(
    `SELECT user_id, display_name, avatar_url, email
     FROM fintrack.auth_identities
     WHERE user_id = $1
     ORDER BY last_login_at DESC
     LIMIT 1`,
    [userId]
  );

  if (res.rows.length === 0) {
    return {
      userId,
      displayName: null,
      avatarUrl: null,
      email: null,
    };
  }

  const row = res.rows[0];
  return {
    userId: row.user_id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    email: row.email,
  };
}
