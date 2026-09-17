import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { ApiError } from './errors';
export const SESSION_COOKIE = '__Host-fintrack_session';
export function sessionHash(req: Request) {
  const cookies = (req.headers.get('cookie') ?? '').split(';').map(v => v.trim()).filter(v => v.startsWith(SESSION_COOKIE + '='));
  if (cookies.length !== 1) throw new ApiError(401, 'UNAUTHENTICATED');
  const token = cookies[0].slice(SESSION_COOKIE.length + 1);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new ApiError(401, 'UNAUTHENTICATED');
  return createHash('sha256').update(token).digest('hex');
}
export async function authenticate(c: PoolClient, hash: string) {
  await c.query("SELECT set_config('app.session_hash',$1,true)", [hash]);
  const result = await c.query('SELECT user_id FROM fintrack.sessions WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now()', [hash]);
  if (result.rows.length !== 1) throw new ApiError(401, 'UNAUTHENTICATED');
  const userId: string = result.rows[0].user_id;
  await c.query("SELECT set_config('app.user_id',$1,true)", [userId]);
  return userId;
}
export function checkMutationOrigin(req: Request) {
  const configured = process.env.APP_ORIGIN;
  if (!configured) throw new ApiError(503, 'BACKEND_NOT_CONFIGURED');
  const origin = new URL(configured);
  if (origin.origin !== configured || (process.env.NODE_ENV === 'production' && origin.protocol !== 'https:')) throw new ApiError(503, 'INVALID_ORIGIN_CONFIG');
  if (req.headers.get('origin') !== configured) throw new ApiError(403, 'INVALID_ORIGIN');
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') throw new ApiError(403, 'CROSS_SITE_REQUEST');
  if (req.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new ApiError(415, 'JSON_REQUIRED');
}
