import 'server-only';
import { Pool, type PoolClient } from 'pg';
import { ApiError } from './errors';

let authPool: Pool | undefined;
let testClientOverride: PoolClient | undefined;

export function setTestAuthClientOverride(client: PoolClient | undefined): void {
  testClientOverride = client;
}

export function authDatabase(): Pool {
  if (!authPool) {
    const connectionString = process.env.AUTH_DATABASE_URL;
    if (!connectionString) throw new ApiError(503, 'AUTH_BACKEND_NOT_CONFIGURED');
    const url = new URL(connectionString);
    // URL SSL options can override pg's explicit TLS configuration. Reject them.
    if (['sslmode', 'sslcert', 'sslkey', 'sslrootcert'].some((k) => url.searchParams.has(k))) {
      throw new ApiError(503, 'INVALID_DATABASE_CONFIG');
    }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    const allowInsecureLocal =
      local &&
      (process.env.NODE_ENV !== 'production' || process.env.ALLOW_INSECURE_TEST_LOCAL_SSL === 'true');
    authPool = new Pool({
      connectionString,
      max: 5,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      statement_timeout: 5000,
      ssl: allowInsecureLocal
        ? false
        : {
            rejectUnauthorized: true,
            ...(process.env.DATABASE_CA ? { ca: process.env.DATABASE_CA } : {}),
          },
    });
    authPool.on('error', () => console.error('FinTrack auth database pool connection error'));
  }
  return authPool;
}

export async function resetAuthPoolForTesting(): Promise<void> {
  testClientOverride = undefined;
  if (authPool) {
    const p = authPool;
    authPool = undefined;
    await p.end();
  }
}

export async function authTransaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  if (testClientOverride) {
    return run(testClientOverride);
  }

  const c = await authDatabase().connect();
  let broken = false;
  try {
    // Reset connection state at checkout to prevent session-state poisoning
    await c.query('RESET ROLE');
    await c.query('BEGIN');
    await c.query("SET LOCAL search_path = fintrack, pg_temp");
    await c.query("SET LOCAL lock_timeout = '3s'");
    await c.query("SET LOCAL statement_timeout = '5s'");
    await c.query("SET LOCAL idle_in_transaction_session_timeout = '5s'");
    await c.query('SET LOCAL ROLE fintrack_auth_runtime');

    const expectedLoginRole =
      process.env.NODE_ENV === 'test' && process.env.EXPECTED_AUTH_LOGIN_ROLE
        ? process.env.EXPECTED_AUTH_LOGIN_ROLE
        : 'fintrack_auth_login';

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
      r.current_name !== 'fintrack_auth_runtime' ||
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
    const privRes = await c.query<{ count: string }>(
      `
      SELECT count(*)::text AS count
      FROM pg_class tbl
      JOIN pg_namespace n ON n.oid = tbl.relnamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(tbl.relacl, acldefault('r', tbl.relowner))) a
      WHERE n.nspname = 'fintrack' AND a.grantee = $1::regrole
        AND a.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
    `,
      [r.session_name]
    );
    if (parseInt(privRes.rows[0]?.count ?? '0', 10) > 0) {
      throw new ApiError(503, 'UNSAFE_DATABASE_ROLE');
    }

    // Assert session role has only expected role membership (fintrack_auth_runtime) with NO admin option
    const membershipRes = await c.query<{ rolname: string; admin_option: boolean }>(
      `
      SELECT r.rolname, m.admin_option
      FROM pg_auth_members m
      JOIN pg_roles r ON r.oid = m.roleid
      JOIN pg_roles u ON u.oid = m.member
      WHERE u.rolname = $1
    `,
      [r.session_name]
    );
    const allowedMemberships = ['fintrack_auth_runtime'];
    for (const row of membershipRes.rows) {
      if (!allowedMemberships.includes(row.rolname) || row.admin_option) {
        throw new ApiError(503, 'UNSAFE_DATABASE_ROLE');
      }
    }

    // Assert fintrack_auth_runtime is a member of ZERO other roles
    const runtimeMembershipRes = await c.query<{ count: string }>(`
      SELECT count(*)::text AS count
      FROM pg_auth_members m
      JOIN pg_roles u ON u.oid = m.member
      WHERE u.rolname = 'fintrack_auth_runtime'
    `);
    if (parseInt(runtimeMembershipRes.rows[0]?.count ?? '0', 10) > 0) {
      throw new ApiError(503, 'UNSAFE_DATABASE_ROLE');
    }

    // Assert fintrack_auth_runtime has ZERO DML privileges on financial tables
    const financialPrivRes = await c.query<{ count: string }>(`
      SELECT count(*)::text AS count
      FROM pg_class tbl
      JOIN pg_namespace n ON n.oid = tbl.relnamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(tbl.relacl, acldefault('r', tbl.relowner))) a
      WHERE n.nspname = 'fintrack' AND a.grantee = 'fintrack_auth_runtime'::regrole
        AND tbl.relname IN ('wallets', 'transfers', 'idempotency', 'rate_limits')
    `);
    if (parseInt(financialPrivRes.rows[0]?.count ?? '0', 10) > 0) {
      throw new ApiError(503, 'UNSAFE_DATABASE_ROLE');
    }

    // Assert BOTH auth roles own ZERO tables, sequences, functions, or schemas
    const authRoles = [r.session_name, 'fintrack_auth_runtime'];

    const classOwnerRes = await c.query<{ count: string }>(
      `
      SELECT count(*)::text AS count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_roles r ON r.oid = c.relowner
      WHERE n.nspname = 'fintrack' AND r.rolname = ANY($1::text[])
    `,
      [authRoles]
    );
    if (parseInt(classOwnerRes.rows[0]?.count ?? '0', 10) > 0) {
      throw new ApiError(503, 'UNSAFE_DATABASE_ROLE');
    }

    const procOwnerRes = await c.query<{ count: string }>(
      `
      SELECT count(*)::text AS count
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_roles r ON r.oid = p.proowner
      WHERE n.nspname = 'fintrack' AND r.rolname = ANY($1::text[])
    `,
      [authRoles]
    );
    if (parseInt(procOwnerRes.rows[0]?.count ?? '0', 10) > 0) {
      throw new ApiError(503, 'UNSAFE_DATABASE_ROLE');
    }

    const nspOwnerRes = await c.query<{ count: string }>(
      `
      SELECT count(*)::text AS count
      FROM pg_namespace n
      JOIN pg_roles r ON r.oid = n.nspowner
      WHERE n.nspname = 'fintrack' AND r.rolname = ANY($1::text[])
    `,
      [authRoles]
    );
    if (parseInt(nspOwnerRes.rows[0]?.count ?? '0', 10) > 0) {
      throw new ApiError(503, 'UNSAFE_DATABASE_ROLE');
    }

    const result = await run(c);
    await c.query('COMMIT');
    return result;
  } catch (e) {
    try {
      await c.query('ROLLBACK');
    } catch {
      broken = true;
    }
    try {
      await c.query('RESET ROLE');
    } catch {}
    throw e;
  } finally {
    c.release(broken);
  }
}
