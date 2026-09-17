import 'server-only';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { ApiError } from './errors';
let pool: Pool | undefined;
export function database() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new ApiError(503, 'BACKEND_NOT_CONFIGURED');
    const url = new URL(connectionString);
    // URL SSL options can override pg's explicit TLS configuration. Reject them.
    if (['sslmode','sslcert','sslkey','sslrootcert'].some(k => url.searchParams.has(k))) throw new ApiError(503, 'INVALID_DATABASE_CONFIG');
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    pool = new Pool({ connectionString, max: 5, connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000, statement_timeout: 5000,
      ssl: local && process.env.NODE_ENV !== 'production' ? false : { rejectUnauthorized: true, ...(process.env.DATABASE_CA ? { ca: process.env.DATABASE_CA } : {}) } });
    pool.on('error', () => console.error('FinTrack database pool connection error'));
  }
  return pool;
}
export async function transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const c = await database().connect();
  let broken = false;
  try {
    await c.query('BEGIN');
    // Prevent a mistakenly configured elevated credential from silently bypassing RLS.
    const role = await c.query(`SELECT rolsuper, rolbypassrls, current_user AS name FROM pg_roles WHERE rolname=current_user`);
    if (role.rows[0]?.name !== 'fintrack_runtime' || role.rows[0]?.rolsuper || role.rows[0]?.rolbypassrls) throw new ApiError(503, 'UNSAFE_DATABASE_ROLE');
    await c.query("SET LOCAL lock_timeout = '3s'");
    const result = await run(c);
    await c.query('COMMIT');
    return result;
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch { broken = true; }
    throw e;
  } finally { c.release(broken); }
}
