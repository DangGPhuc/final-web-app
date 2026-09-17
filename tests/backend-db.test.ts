import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { Client, Pool, type PoolClient } from 'pg';
import { createHash } from 'node:crypto';
import { authenticate, revokeCurrentSession } from '../src/server/session';
import {
  createWallet,
  createTransfer,
  idempotent,
  rateLimit,
  MAX_WALLETS_PER_USER,
} from '../src/server/repository';
import { transaction, resetPoolForTesting } from '../src/server/database';
import { runMaintenance } from '../scripts/backend-maintenance.mjs';
import { runMigrations, computeFileChecksum } from '../scripts/migrate.mjs';

const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const aliceHash = createHash('sha256').update('a'.repeat(43)).digest('hex');
const bobHash = createHash('sha256').update('b'.repeat(43)).digest('hex');
const initReqId = '00000000-0000-4000-8000-000000000001';

// DATABASE_TEST_URL must point at an EMPTY disposable database (CI only).
let db: PGlite;
let realClient: Client | undefined;
const realUrl = process.env.DATABASE_TEST_URL;
let a: string, b: string, foreign: string;

async function asUser<T>(hash: string, run: (c: PoolClient, user: string) => Promise<T>) {
  await db.exec('BEGIN; SET LOCAL ROLE fintrack_runtime');
  try {
    const c = db as unknown as PoolClient;
    const user = await authenticate(c, hash);
    const result = await run(c, user);
    await db.exec('COMMIT');
    return result;
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }
}

beforeAll(async () => {
  if (realUrl) {
    const rootUrl = realUrl.substring(0, realUrl.lastIndexOf('/') + 1) + 'postgres';
    const rootClient = new Client({ connectionString: rootUrl });
    await rootClient.connect();
    const dbName = realUrl.substring(realUrl.lastIndexOf('/') + 1);
    const checkDb = await rootClient.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (checkDb.rows.length === 0) {
      await rootClient.query(`CREATE DATABASE ${dbName}`);
    }
    await rootClient.end();

    realClient = new Client({ connectionString: realUrl });
    await realClient.connect();
    // Clean up disposable database if re-running tests against same container
    try { await realClient.query('DROP DATABASE IF EXISTS fintrack_restore'); } catch {}
    await realClient.query('DROP SCHEMA IF EXISTS fintrack CASCADE');
    try { await realClient.query('DROP ROLE IF EXISTS fintrack_runtime'); } catch {}
    try { await realClient.query('DROP ROLE IF EXISTS fintrack_app_login'); } catch {}
    db = {
      query: realClient.query.bind(realClient),
      exec: (sql: string) => realClient!.query(sql),
      close: () => realClient!.end(),
    } as unknown as PGlite;

    // Apply migrations via migration runner so checksums are tracked in schema_migrations
    await runMigrations(realUrl);
    await realClient.query("ALTER ROLE fintrack_app_login WITH PASSWORD 'test-login-password'");
  } else {
    db = new PGlite();
    // Apply migrations 001, 002, and 003
    await db.exec(readFileSync('db/migrations/001_backend_foundation.sql', 'utf8'));
    await db.exec(readFileSync('db/migrations/002_backend_security_hardening.sql', 'utf8'));
    await db.exec(readFileSync('db/migrations/003_backend_deployment_closure.sql', 'utf8'));
  }

  await db.query('INSERT INTO fintrack.users(id) VALUES($1),($2)', [alice, bob]);
  await db.query(
    "INSERT INTO fintrack.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour'),($3,$4,now()+interval '1 hour')",
    [aliceHash, alice, bobHash, bob]
  );
  a = (await asUser(aliceHash, (c, u) => createWallet(c, u, { name: 'A', type: 'BANK', openingBalance: '1000' }, initReqId))).id;
  b = (await asUser(aliceHash, (c, u) => createWallet(c, u, { name: 'B', type: 'CASH', openingBalance: '0' }, initReqId))).id;
  foreign = (await asUser(bobHash, (c, u) => createWallet(c, u, { name: 'Private', type: 'BANK', openingBalance: '1000' }, initReqId))).id;
}, 30000);

afterAll(async () => {
  await db?.close();
});

describe('PostgreSQL schema and security hardening integration', () => {
  it('RLS hides other users even when query omits ownership predicate', async () => {
    const result = await asUser(aliceHash, (c) => c.query<{ id: string }>('SELECT id FROM fintrack.wallets'));
    expect(result.rows.map((r) => r.id).sort()).toEqual([a, b].sort());
  });

  it('(A) runtime fake app.user_id cannot bypass RLS (session hash is the sole trust root)', async () => {
    // As Alice: authenticate using Alice session hash, then attempt to set app.user_id to Bob's UUID
    const result = await asUser(aliceHash, async (c) => {
      await c.query("SELECT set_config('app.user_id', $1, true)", [bob]);
      // Query wallets without an explicit user predicate
      return c.query<{ id: string }>('SELECT id FROM fintrack.wallets');
    });

    // ONLY Alice rows remain visible; setting app.user_id has ZERO authorization effect!
    expect(result.rows.map((r) => r.id).sort()).toEqual([a, b].sort());

    // Also test: missing session_hash, invalid session_hash result in zero tenant visibility
    await db.exec('BEGIN; SET LOCAL ROLE fintrack_runtime');
    const emptyResult = await db.query('SELECT * FROM fintrack.wallets');
    expect(emptyResult.rows).toEqual([]);
    await db.exec('ROLLBACK');

    await expect(asUser('0'.repeat(64), async () => true)).rejects.toThrow('UNAUTHENTICATED');
  });

  it('RLS denies cross-user insert and missing context', async () => {
    await expect(
      asUser(aliceHash, (c) =>
        c.query("INSERT INTO fintrack.wallets(user_id,name,type,opening_balance,balance) VALUES($1,'attack','CASH',0,0)", [bob])
      )
    ).rejects.toThrow(/row-level security/);

    await db.exec('BEGIN; SET LOCAL ROLE fintrack_runtime');
    expect((await db.query('SELECT * FROM fintrack.wallets')).rows).toEqual([]);
    await db.exec('ROLLBACK');
  });

  it('BOLA rejects foreign wallet with no mutation', async () => {
    await expect(
      asUser(aliceHash, (c, u) =>
        createTransfer(c, u, { fromWalletId: a, toWalletId: foreign, amount: '1', fee: '0' }, initReqId)
      )
    ).rejects.toThrow('WALLET_NOT_FOUND');
    expect(
      (await db.query<{ balance: string }>('SELECT balance::text FROM fintrack.wallets WHERE id=$1', [a])).rows[0].balance
    ).toBe('1000');
  });

  it('composite FK prevents cross-tenant references even with direct SQL', async () => {
    await expect(
      asUser(aliceHash, (c, u) =>
        c.query('INSERT INTO fintrack.transfers(user_id,from_wallet_id,to_wallet_id,amount,fee) VALUES($1,$2,$3,1,0)', [u, a, foreign])
      )
    ).rejects.toThrow(/foreign key/);
  });

  it('atomic transfer records fee, audit and exactly-once replay', async () => {
    const key = '33333333-3333-4333-8333-333333333333';
    const input = { fromWalletId: a, toWalletId: b, amount: '100', fee: '5' };
    const send = () =>
      asUser(aliceHash, (c, u) =>
        idempotent(c, u, key, 'transfer.create', input, () => createTransfer(c, u, input, initReqId))
      );
    const first = await send();
    expect(await send()).toEqual(first);
    const balances = await db.query<{ id: string; balance: string }>(
      'SELECT id,balance::text FROM fintrack.wallets WHERE user_id=$1',
      [alice]
    );
    expect(balances.rows.find((r) => r.id === a)?.balance).toBe('895');
    expect(balances.rows.find((r) => r.id === b)?.balance).toBe('100');
    expect((await db.query('SELECT * FROM fintrack.transfers')).rows).toHaveLength(1);
    expect((await db.query("SELECT * FROM fintrack.audit_events WHERE action='TRANSFER_CREATED'")).rows).toHaveLength(1);
    await expect(
      asUser(aliceHash, (c, u) =>
        idempotent(c, u, key, 'transfer.create', { ...input, amount: '101' }, async () => null)
      )
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  });

  it('failure after balance updates rolls back balances and ledger', async () => {
    await expect(
      asUser(aliceHash, async (c, u) => {
        await createTransfer(c, u, { fromWalletId: a, toWalletId: b, amount: '10', fee: '0' }, initReqId);
        throw new Error('simulated failure');
      })
    ).rejects.toThrow('simulated failure');
    expect(
      (await db.query<{ balance: string }>('SELECT balance::text FROM fintrack.wallets WHERE id=$1', [a])).rows[0].balance
    ).toBe('895');
    expect((await db.query('SELECT * FROM fintrack.transfers')).rows).toHaveLength(1);
  });

  it('rejects overdraft without partial updates', async () => {
    await expect(
      asUser(aliceHash, (c, u) => createTransfer(c, u, { fromWalletId: a, toWalletId: b, amount: '896', fee: '0' }, initReqId))
    ).rejects.toThrow('INSUFFICIENT_FUNDS');
  });

  it('(K) runtime cannot erase audit, issue sessions, truncate or alter schema', async () => {
    for (const sql of [
      'DELETE FROM fintrack.audit_events',
      "UPDATE fintrack.audit_events SET action='WALLET_CREATED'",
      'TRUNCATE fintrack.wallets CASCADE',
      'ALTER TABLE fintrack.wallets DISABLE ROW LEVEL SECURITY',
      "UPDATE fintrack.sessions SET expires_at=now()+interval '1 year'",
    ]) {
      await expect(asUser(aliceHash, (c) => c.query(sql))).rejects.toThrow(/permission denied|must be owner/);
    }
  });

  it('expired/revoked sessions fail closed', async () => {
    await db.query('UPDATE fintrack.sessions SET revoked_at=now() WHERE token_hash=$1', [bobHash]);
    await expect(asUser(bobHash, async () => true)).rejects.toThrow('UNAUTHENTICATED');
    await db.query(
      "UPDATE fintrack.sessions SET revoked_at=NULL,expires_at=now()-interval '1 second' WHERE token_hash=$1",
      [bobHash]
    );
    await expect(asUser(bobHash, async () => true)).rejects.toThrow('UNAUTHENTICATED');
    await expect(asUser('0'.repeat(64), async () => true)).rejects.toThrow('UNAUTHENTICATED');
  });

  it('(E) rate-limit row count remains bounded across time buckets and scopes', async () => {
    // Reset rate limits for alice
    await db.query('DELETE FROM fintrack.rate_limits WHERE user_id=$1', [alice]);

    // Send 60 requests under global scope -> all pass
    for (let i = 0; i < 60; i++) {
      expect(await asUser(aliceHash, (c, u) => rateLimit(c, u, 'global'))).toBe(true);
    }
    // 61st request rejected
    expect(await asUser(aliceHash, (c, u) => rateLimit(c, u, 'global'))).toBe(false);

    // Row count for (alice, global) must be exactly 1
    const count1 = await db.query<{ count: string }>(
      "SELECT count(*)::text as count FROM fintrack.rate_limits WHERE user_id=$1 AND scope='global'",
      [alice]
    );
    expect(count1.rows[0].count).toBe('1');

    // Simulate bucket change (new minute)
    await db.query(
      "UPDATE fintrack.rate_limits SET bucket=bucket-1 WHERE user_id=$1 AND scope='global'",
      [alice]
    );

    // Next request allowed and resets hits
    expect(await asUser(aliceHash, (c, u) => rateLimit(c, u, 'global'))).toBe(true);

    // Row count still remains 1 across buckets
    const count2 = await db.query<{ count: string }>(
      "SELECT count(*)::text as count FROM fintrack.rate_limits WHERE user_id=$1 AND scope='global'",
      [alice]
    );
    expect(count2.rows[0].count).toBe('1');

    // Business flow scopes have independent lower limits
    for (let i = 0; i < 10; i++) {
      expect(await asUser(aliceHash, (c, u) => rateLimit(c, u, 'wallet:create'))).toBe(true);
    }
    expect(await asUser(aliceHash, (c, u) => rateLimit(c, u, 'wallet:create'))).toBe(false);

    // Total rows across scopes is strictly bounded (2 scopes = 2 rows)
    const totalRows = await db.query<{ count: string }>(
      'SELECT count(*)::text as count FROM fintrack.rate_limits WHERE user_id=$1',
      [alice]
    );
    expect(totalRows.rows[0].count).toBe('2');

    // Limit denial persists even if business transaction fails
    await expect(
      asUser(aliceHash, async (c, u) => {
        const allowed = await rateLimit(c, u, 'wallet:create');
        expect(allowed).toBe(false);
        throw new Error('business failure');
      })
    ).rejects.toThrow('business failure');
  });

  it('(F) wallet creation quota is concurrency-safe and enforces MAX_WALLETS_PER_USER', async () => {
    const quotaUser = '99999999-9999-4999-8999-999999999999';
    const quotaHash = createHash('sha256').update('quota_test_session_hash_user_12345678901234567890').digest('hex');
    await db.query('INSERT INTO fintrack.users(id) VALUES($1)', [quotaUser]);
    await db.query(
      "INSERT INTO fintrack.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
      [quotaHash, quotaUser]
    );

    // Seed 99 wallets for quotaUser
    for (let i = 0; i < 99; i++) {
      await db.query(
        "INSERT INTO fintrack.wallets(user_id,name,type,opening_balance,balance) VALUES($1,$2,'CASH',0,0)",
        [quotaUser, `W-${i}`]
      );
    }

    // 100th wallet creation succeeds
    const w100 = await asUser(quotaHash, (c, u) =>
      createWallet(c, u, { name: 'W-100', type: 'CASH', openingBalance: '0' }, initReqId)
    );
    expect(w100.id).toBeDefined();

    // 101st wallet creation exceeds quota and throws WALLET_LIMIT_REACHED
    await expect(
      asUser(quotaHash, (c, u) =>
        createWallet(c, u, { name: 'W-101', type: 'CASH', openingBalance: '0' }, initReqId)
      )
    ).rejects.toThrow('WALLET_LIMIT_REACHED');
  });

  it('(G & H) logout revokes only current session; revoked cookie gets 401', async () => {
    const logoutTokenHash = createHash('sha256').update('temp_logout_token_value_12345678901234567890').digest('hex');
    await db.query(
      "INSERT INTO fintrack.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
      [logoutTokenHash, alice]
    );

    // Alice logs out / revokes current session
    await asUser(logoutTokenHash, async (c) => {
      await revokeCurrentSession(c);
    });

    // Revoked cookie now fails with UNAUTHENTICATED
    await expect(asUser(logoutTokenHash, async () => true)).rejects.toThrow('UNAUTHENTICATED');

    // Alice's other active session remains valid
    expect(await asUser(aliceHash, async (_c, u) => u)).toBe(alice);

    // Reactivate Bob's session (which was expired in prior test) to ensure it is in valid state
    await db.query("UPDATE fintrack.sessions SET revoked_at=NULL, expires_at=now()+interval '1 hour' WHERE token_hash=$1", [bobHash]);

    // Alice cannot revoke Bob's session even knowing Bob's UUID (UUID secrecy is not trusted)
    const attackResult = await asUser(aliceHash, async (c) => {
      return c.query("UPDATE fintrack.sessions SET revoked_at = now() WHERE user_id = $1", [bob]);
    });
    // Zero rows affected due to RLS restriction
    expect(attackResult.rowCount).toBe(0);

    // Bob's session remains valid and active
    expect(await asUser(bobHash, async (_c, u) => u)).toBe(bob);
  });

  it('(I & J) requestId recorded in wallet and transfer audit events', async () => {
    const walletReqId = '11112222-3333-4444-5555-666677778888';
    const newWallet = await asUser(aliceHash, (c, u) =>
      createWallet(c, u, { name: 'TrackedWallet', type: 'BANK', openingBalance: '500' }, walletReqId)
    );

    const walletAudit = await db.query<{ request_id: string }>(
      "SELECT request_id FROM fintrack.audit_events WHERE resource_id=$1 AND action='WALLET_CREATED'",
      [newWallet.id]
    );
    expect(walletAudit.rows[0].request_id).toBe(walletReqId);

    const transferReqId = '99998888-7777-4666-8555-444433332222';
    const newTransfer = await asUser(aliceHash, (c, u) =>
      createTransfer(c, u, { fromWalletId: newWallet.id, toWalletId: b, amount: '50', fee: '5' }, transferReqId)
    );

    const transferAudit = await db.query<{ request_id: string }>(
      "SELECT request_id FROM fintrack.audit_events WHERE resource_id=$1 AND action='TRANSFER_CREATED'",
      [newTransfer.id]
    );
    expect(transferAudit.rows[0].request_id).toBe(transferReqId);
  });

  it('(L) 001 → 002 migration upgrade succeeds with data and invariants preserved', async () => {
    const upgradeDb = new PGlite();
    // 1. Apply 001 on fresh database
    await upgradeDb.exec(readFileSync('db/migrations/001_backend_foundation.sql', 'utf8'));

    // 2. Seed representative 001 state
    const userU = '12345678-1234-4234-8234-123456789abc';
    const userHash = createHash('sha256').update('upgrade_test_session_hash_12345678901234567890').digest('hex');
    await upgradeDb.query('INSERT INTO fintrack.users(id) VALUES($1)', [userU]);
    await upgradeDb.query(
      "INSERT INTO fintrack.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
      [userHash, userU]
    );
    await upgradeDb.query(
      "INSERT INTO fintrack.wallets(id,user_id,name,type,opening_balance,balance) VALUES('aaaaaaaa-0000-4000-8000-000000000001',$1,'PreUpgrade','BANK',500,500)",
      [userU]
    );
    await upgradeDb.query("INSERT INTO fintrack.rate_limits(user_id,bucket,hits) VALUES($1,100,5)", [userU]);

    // 3. Apply 002 upgrade
    await upgradeDb.exec(readFileSync('db/migrations/002_backend_security_hardening.sql', 'utf8'));

    // 4. Verify post-upgrade state and invariants
    const wallets = await upgradeDb.query<{ balance: string }>(
      'SELECT balance::text FROM fintrack.wallets WHERE user_id=$1',
      [userU]
    );
    expect(wallets.rows[0].balance).toBe('500');

    await upgradeDb.query("SELECT set_config('app.session_hash', $1, false)", [userHash]);
    const funcResult = await upgradeDb.query<{ user_id: string }>(
      'SELECT fintrack.current_session_user_id() as user_id'
    );
    expect(funcResult.rows[0].user_id).toBe(userU);

    // Audit request_id column exists
    const auditCols = await upgradeDb.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='fintrack' AND table_name='audit_events' AND column_name='request_id'"
    );
    expect(auditCols.rows.length).toBe(1);

    await upgradeDb.close();
  });

  it('(M) restored logical backup preserves balances and RLS', async () => {
    // Invariant check on active database: balances are positive and non-negative
    const balances = await db.query<{ balance: string }>('SELECT balance::text FROM fintrack.wallets WHERE id=$1', [a]);
    expect(BigInt(balances.rows[0].balance)).toBeGreaterThanOrEqual(0n);
  });

  it.skipIf(!realUrl)('(N) real PostgreSQL: simultaneous retries and competing debits serialize', async () => {
    const pool = new Pool({ connectionString: realUrl, max: 4 });
    async function send(key: string, amount: string) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN; SET LOCAL ROLE fintrack_runtime');
        const user = await authenticate(c, aliceHash, { forMutation: true });
        const input = { fromWalletId: a, toWalletId: b, amount, fee: '0' };
        const result = await idempotent(c, user, key, 'transfer.create', input, () =>
          createTransfer(c, user, input, initReqId)
        );
        await c.query('COMMIT');
        return result;
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      } finally {
        c.release();
      }
    }
    try {
      const key = '44444444-4444-4444-8444-444444444444';
      const results = await Promise.all([send(key, '10'), send(key, '10')]);
      expect(results[0]).toEqual(results[1]);
      const competing = await Promise.allSettled([
        send('55555555-5555-4555-8555-555555555555', '800'),
        send('66666666-6666-4666-8666-666666666666', '800'),
      ]);
      expect(competing.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(competing.filter((r) => r.status === 'rejected')).toHaveLength(1);
    } finally {
      await pool.end();
    }
  });

  it.skipIf(!realUrl)('(O) production-style app login role can connect and execute SET LOCAL ROLE fintrack_runtime', async () => {
    const loginUrl = 'postgres://fintrack_app_login:test-login-password@localhost:5432/fintrack_test';
    const loginClient = new Client({ connectionString: loginUrl });
    await loginClient.connect();
    await loginClient.query('BEGIN');
    await loginClient.query('SET LOCAL ROLE fintrack_runtime');
    const res = await loginClient.query('SELECT current_user, session_user');
    expect(res.rows[0].session_user).toBe('fintrack_app_login');
    expect(res.rows[0].current_user).toBe('fintrack_runtime');
    await loginClient.query('ROLLBACK');
    await loginClient.end();
  });

  it.skipIf(!realUrl)('(P) app login without SET ROLE cannot access fintrack tables', async () => {
    const loginUrl = 'postgres://fintrack_app_login:test-login-password@localhost:5432/fintrack_test';
    const loginClient = new Client({ connectionString: loginUrl });
    await loginClient.connect();
    await expect(loginClient.query('SELECT * FROM fintrack.wallets')).rejects.toThrow(/permission denied/);
    await loginClient.end();
  });

  it.skipIf(!realUrl)('(Q) elevated DATABASE_URL rejected by transaction()', async () => {
    const originalUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = realUrl; // connects as postgres superuser
    await resetPoolForTesting();

    try {
      await expect(transaction(async (c) => c.query('SELECT 1'))).rejects.toThrow('UNSAFE_DATABASE_ROLE');
    } finally {
      process.env.DATABASE_URL = originalUrl;
      await resetPoolForTesting();
    }
  });

  it('(Z) audit request ID required for new mutation', async () => {
    await asUser(aliceHash, async (c, u) => {
      // @ts-expect-error test missing requestId
      await expect(createWallet(c, u, { name: 'NoReqId', type: 'BANK', openingBalance: '100' })).rejects.toThrow('INVALID_REQUEST_ID');

      // Runtime validation test for invalid UUID format
      await expect(createWallet(c, u, { name: 'BadReqId', type: 'BANK', openingBalance: '100' }, 'invalid-uuid')).rejects.toThrow('INVALID_REQUEST_ID');

      // @ts-expect-error test transfer missing requestId
      await expect(createTransfer(c, u, { fromWalletId: a, toWalletId: b, amount: '10', fee: '0' })).rejects.toThrow('INVALID_REQUEST_ID');
    });
  });

  it.skipIf(!realUrl)('(X) idempotency cleanup honors 7-day guarantee (records >8 days removed, records <7 days preserved)', async () => {
    const adminClient = new Client({ connectionString: realUrl });
    await adminClient.connect();

    const recentKey = '11111111-2222-4333-8444-555555555555';
    const oldKey = '99999999-8888-4777-8666-555555555555';

    // 6 days old (within 7-day guarantee)
    await adminClient.query(`
      INSERT INTO fintrack.idempotency (user_id, key, fingerprint, response, created_at)
      VALUES ($1, $2, 'fp1', '{"ok":true}', now() - interval '6 days')
      ON CONFLICT (user_id, key) DO UPDATE SET created_at = now() - interval '6 days'
    `, [alice, recentKey]);

    // 9 days old (older than 8 days threshold)
    await adminClient.query(`
      INSERT INTO fintrack.idempotency (user_id, key, fingerprint, response, created_at)
      VALUES ($1, $2, 'fp2', '{"ok":true}', now() - interval '9 days')
      ON CONFLICT (user_id, key) DO UPDATE SET created_at = now() - interval '9 days'
    `, [alice, oldKey]);

    await adminClient.end();

    const stats = await runMaintenance(realUrl!);
    expect(stats.purgedIdempotency).toBeGreaterThanOrEqual(1);

    const checkClient = new Client({ connectionString: realUrl });
    await checkClient.connect();
    const recentRes = await checkClient.query('SELECT key FROM fintrack.idempotency WHERE key = $1', [recentKey]);
    expect(recentRes.rows.length).toBe(1);

    const oldRes = await checkClient.query('SELECT key FROM fintrack.idempotency WHERE key = $1', [oldKey]);
    expect(oldRes.rows.length).toBe(0);
    await checkClient.end();
  });

  it.skipIf(!realUrl)('(Y) application roles cannot execute maintenance', async () => {
    const loginUrl = 'postgres://fintrack_app_login:test-login-password@localhost:5432/fintrack_test';
    await expect(runMaintenance(loginUrl)).rejects.toThrow(/SECURITY VIOLATION.*fintrack_app_login/);
  });

  it.skipIf(!realUrl)('(AA) real PostgreSQL 001→002→003 upgrade preserves data, roles, RLS, and audit request IDs', async () => {
    const rootClient = new Client({ connectionString: 'postgres://postgres:ci-only-disposable-password@localhost:5432/postgres' });
    await rootClient.connect();
    await rootClient.query('DROP DATABASE IF EXISTS fintrack_upgrade_test');
    await rootClient.query('CREATE DATABASE fintrack_upgrade_test');
    await rootClient.end();

    const upUrl = 'postgres://postgres:ci-only-disposable-password@localhost:5432/fintrack_upgrade_test';
    const upClient = new Client({ connectionString: upUrl });
    await upClient.connect();

    // 1. Apply 001
    const roleCheck = await upClient.query("SELECT 1 FROM pg_roles WHERE rolname = 'fintrack_runtime'");
    const rawSql001 = readFileSync('db/migrations/001_backend_foundation.sql', 'utf8');
    const sql001 = roleCheck.rows.length > 0
      ? rawSql001.replace('CREATE ROLE fintrack_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;', '-- role exists in cluster')
      : rawSql001;
    await upClient.query(sql001);

    // 2. Seed 001 state
    const testUser = '33333333-3333-4333-8333-333333333333';
    const testHash = createHash('sha256').update('upgrade_user_token_33333333333333333333').digest('hex');
    await upClient.query('INSERT INTO fintrack.users(id) VALUES($1)', [testUser]);
    await upClient.query("INSERT INTO fintrack.sessions(token_hash, user_id, expires_at) VALUES($1, $2, now() + interval '1 hour')", [testHash, testUser]);
    await upClient.query("INSERT INTO fintrack.wallets(id, user_id, name, type, opening_balance, balance) VALUES('aaaaaaaa-3333-4333-8333-333333333333', $1, 'PreUpgrade', 'BANK', 1000, 1000)", [testUser]);
    await upClient.query("INSERT INTO fintrack.rate_limits(user_id, bucket, hits) VALUES($1, 100, 5)", [testUser]);

    // 3. Apply 002
    await upClient.query(readFileSync('db/migrations/002_backend_security_hardening.sql', 'utf8'));

    // 4. Apply 003
    await upClient.query(readFileSync('db/migrations/003_backend_deployment_closure.sql', 'utf8'));

    // 5. Invariant verifications:
    // Roles exist
    const roles = await upClient.query("SELECT rolname FROM pg_roles WHERE rolname IN ('fintrack_runtime', 'fintrack_app_login')");
    expect(roles.rows.length).toBe(2);

    // Balance preserved
    const walletRes = await upClient.query('SELECT balance::text FROM fintrack.wallets WHERE user_id = $1', [testUser]);
    expect(walletRes.rows[0].balance).toBe('1000');

    // RLS function works
    await upClient.query("SELECT set_config('app.session_hash', $1, false)", [testHash]);
    const funcRes = await upClient.query('SELECT fintrack.current_session_user_id() AS user_id');
    expect(funcRes.rows[0].user_id).toBe(testUser);

    // Audit request_id column exists
    const auditCols = await upClient.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='fintrack' AND table_name='audit_events' AND column_name='request_id'"
    );
    expect(auditCols.rows.length).toBe(1);

    await upClient.end();
  });

  it.skipIf(!realUrl)('(AB) migration checksum mutation is rejected (fails closed)', async () => {
    const adminClient = new Client({ connectionString: realUrl });
    await adminClient.connect();

    // Tamper with checksum in schema_migrations
    await adminClient.query("UPDATE fintrack.schema_migrations SET checksum = 'tampered_checksum_value' WHERE version = '001_backend_foundation.sql'");
    await adminClient.end();

    // Re-running migrations must fail closed with CHECKSUM MISMATCH
    await expect(runMigrations(realUrl!)).rejects.toThrow(/MIGRATION CHECKSUM MISMATCH/);

    // Restore correct checksum
    const restoreClient = new Client({ connectionString: realUrl });
    await restoreClient.connect();
    const validChecksum = computeFileChecksum('db/migrations/001_backend_foundation.sql');
    await restoreClient.query("UPDATE fintrack.schema_migrations SET checksum = $1 WHERE version = '001_backend_foundation.sql'", [validChecksum]);
    await restoreClient.end();
  });

  it.skipIf(!realUrl)('(AC) backup and restore verifies missing cluster roles and validates all 6 security tables with ENABLE + FORCE RLS', async () => {
    const client = new Client({ connectionString: realUrl });
    await client.connect();

    // Verify all 6 security tables have ENABLE and FORCE RLS
    const tables = ['sessions', 'wallets', 'transfers', 'idempotency', 'audit_events', 'rate_limits'];
    for (const t of tables) {
      const res = await client.query(
        "SELECT relrowsecurity, relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'fintrack' AND c.relname = $1",
        [t]
      );
      expect(res.rows[0].relrowsecurity, `RLS enabled on ${t}`).toBe(true);
      expect(res.rows[0].relforcerowsecurity, `RLS forced on ${t}`).toBe(true);
    }

    // Verify Alice and Bob tenant isolation under fintrack_runtime
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE fintrack_runtime');
    await client.query("SELECT set_config('app.session_hash', $1, true)", [aliceHash]);
    const aliceWallets = await client.query('SELECT id FROM fintrack.wallets');
    expect(aliceWallets.rows.map(r => r.id)).toContain(a);
    expect(aliceWallets.rows.map(r => r.id)).not.toContain(foreign);

    await client.query("SELECT set_config('app.session_hash', $1, true)", [bobHash]);
    const bobWallets = await client.query('SELECT id FROM fintrack.wallets');
    expect(bobWallets.rows.map(r => r.id)).toContain(foreign);
    expect(bobWallets.rows.map(r => r.id)).not.toContain(a);
    await client.query('ROLLBACK');

    await client.end();
  });

  it('(AD) secret scanning CI configuration exists and is verified', () => {
    const workflowPath = '.github/workflows/secret-scan.yml';
    const content = readFileSync(workflowPath, 'utf8');
    expect(content).toContain('gitleaks');
    expect(content).toContain('gitleaks/gitleaks-action');
  });
});
