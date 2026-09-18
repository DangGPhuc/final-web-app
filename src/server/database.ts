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
    const allowInsecureLocal = local && (process.env.NODE_ENV !== 'production' || process.env.ALLOW_INSECURE_TEST_LOCAL_SSL === 'true');
    pool = new Pool({ connectionString, max: 5, connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000, statement_timeout: 5000,
      ssl: allowInsecureLocal ? false : { rejectUnauthorized: true, ...(process.env.DATABASE_CA ? { ca: process.env.DATABASE_CA } : {}) } });
    pool.on('error', () => console.error('FinTrack database pool connection error'));
  }
  return pool;
}
export async function resetPoolForTesting(): Promise<void> {
  if (pool) {
    const p = pool;
    pool = undefined;
    await p.end();
  }
}

export async function transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const c = await database().connect();
  let broken = false;
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE fintrack_runtime');

    const expectedLoginRole = process.env.NODE_ENV === 'test' && process.env.EXPECTED_LOGIN_ROLE
      ? process.env.EXPECTED_LOGIN_ROLE
      : 'fintrack_app_login';

    const roleRes = await c.query(`
      SELECT
        s.rolname AS session_name,
        s.rolsuper AS session_super,
        s.rolbypassrls AS session_bypassrls,
        s.rolcreatedb AS session_createdb,
        s.rolcreaterole AS session_createrole,
        s.rolinherit AS session_inherit,
        s.rolcanlogin AS session_canlogin,
        u.rolname AS current_name,
        u.rolsuper AS current_super,
        u.rolbypassrls AS current_bypassrls,
        u.rolcreatedb AS current_createdb,
        u.rolcreaterole AS current_createrole,
        u.rolcanlogin AS current_canlogin
      FROM pg_roles s, pg_roles u
      WHERE s.rolname = session_user AND u.rolname = current_user
    `);
    const r = roleRes.rows[0];
    if (
      !r ||
      r.session_name !== expectedLoginRole ||
      r.current_name !== 'fintrack_runtime' ||
      r.session_super ||
      r.session_bypassrls ||
      r.session_createdb ||
      r.session_createrole ||
      r.session_inherit ||
      !r.session_canlogin ||
      r.current_super ||
      r.current_bypassrls ||
      r.current_createdb ||
      r.current_createrole ||
      r.current_canlogin
    ) {
      throw new ApiError(503, 'UNSAFE_DATABASE_ROLE');
    }

    // Assert session role has NO direct table DML grants on fintrack schema
    const privRes = await c.query<{ count: string }>(`
      SELECT count(*)::text AS count
      FROM pg_class tbl
      JOIN pg_namespace n ON n.oid = tbl.relnamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(tbl.relacl, acldefault('r', tbl.relowner))) a
      WHERE n.nspname = 'fintrack' AND a.grantee = $1::regrole
        AND a.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
    `, [r.session_name]);
    if (parseInt(privRes.rows[0]?.count ?? '0', 10) > 0) {
      throw new ApiError(503, 'UNSAFE_DATABASE_ROLE');
    }

    // Assert session role has only expected role membership (fintrack_runtime)
    const membershipRes = await c.query<{ rolname: string }>(`
      SELECT r.rolname
      FROM pg_auth_members m
      JOIN pg_roles r ON r.oid = m.roleid
      JOIN pg_roles u ON u.oid = m.member
      WHERE u.rolname = $1
    `, [r.session_name]);
    const allowedMemberships = ['fintrack_runtime'];
    for (const row of membershipRes.rows) {
      if (!allowedMemberships.includes(row.rolname)) {
        throw new ApiError(503, 'UNSAFE_DATABASE_ROLE');
      }
    }

    const tableOwnerRes = await c.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM pg_tables WHERE schemaname = 'fintrack' AND tableowner = $1`,
      [r.session_name]
    );
    if (parseInt(tableOwnerRes.rows[0]?.count ?? '0', 10) > 0) {
      throw new ApiError(503, 'UNSAFE_DATABASE_ROLE');
    }

    await c.query("SET LOCAL lock_timeout = '3s'");
    const result = await run(c);
    await c.query('COMMIT');
    return result;
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch { broken = true; }
    throw e;
  } finally { c.release(broken); }
}
