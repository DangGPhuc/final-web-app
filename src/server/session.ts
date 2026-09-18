import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { ApiError } from './errors';

export const SESSION_COOKIE = '__Host-fintrack_session';

export function sessionHash(req: Request): string {
  const cookies = (req.headers.get('cookie') ?? '')
    .split(';')
    .map(v => v.trim())
    .filter(v => v.startsWith(SESSION_COOKIE + '='));
  if (cookies.length !== 1) throw new ApiError(401, 'UNAUTHENTICATED');
  const token = cookies[0].slice(SESSION_COOKIE.length + 1);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new ApiError(401, 'UNAUTHENTICATED');
  return createHash('sha256').update(token).digest('hex');
}

export async function authenticate(c: PoolClient, hash: string, options?: { forMutation?: boolean }): Promise<string> {
  // Authorization context: Set ONLY high-entropy session hash.
  // app.user_id is NEVER set; tenant RLS derives identity exclusively from fintrack.current_session_user_id().
  await c.query("SELECT set_config('app.session_hash', $1, true)", [hash]);

  // When authenticating for a mutation, hold a FOR SHARE lock on the active session row
  // so that logout/revocation conflicts with concurrent mutations.
  const lockClause = options?.forMutation ? ' FOR SHARE' : '';
  const result = await c.query(
    `SELECT user_id FROM fintrack.sessions WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()${lockClause}`,
    [hash]
  );
  if (result.rows.length !== 1) throw new ApiError(401, 'UNAUTHENTICATED');
  return result.rows[0].user_id;
}

export async function revokeCurrentSession(c: PoolClient): Promise<void> {
  // Runtime role is granted UPDATE(revoked_at) and restricted by monotonic RLS to only its own active session
  const result = await c.query(
    "UPDATE fintrack.sessions SET revoked_at = now() WHERE token_hash = nullif(current_setting('app.session_hash', true), '') AND revoked_at IS NULL"
  );
  if (result.rowCount !== 1) {
    throw new ApiError(401, 'UNAUTHENTICATED');
  }
}

export function clearSessionCookieHeader(): string {
  // Clears cookie across all paths without setting Domain attribute
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export function checkMutationOrigin(req: Request, options?: { requireJson?: boolean }): void {
  const configured = process.env.APP_ORIGIN;
  if (!configured) throw new ApiError(503, 'BACKEND_NOT_CONFIGURED');
  const origin = new URL(configured);
  if (origin.origin !== configured || (process.env.NODE_ENV === 'production' && origin.protocol !== 'https:')) {
    throw new ApiError(503, 'INVALID_ORIGIN_CONFIG');
  }
  if (req.headers.get('origin') !== configured) throw new ApiError(403, 'INVALID_ORIGIN');
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') throw new ApiError(403, 'CROSS_SITE_REQUEST');
  if (options?.requireJson !== false) {
    if (req.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      throw new ApiError(415, 'JSON_REQUIRED');
    }
  }
}
