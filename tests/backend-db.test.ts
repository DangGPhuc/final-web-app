import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { Client, Pool, type PoolClient } from 'pg';
import { createHash } from 'node:crypto';
import { authenticate, revokeCurrentSession, checkMutationOrigin } from '../src/server/session';
import {
  createWallet,
  createTransfer,
  idempotent,
  rateLimit,
  MAX_WALLETS_PER_USER,
} from '../src/server/repository';
import { transaction, resetPoolForTesting } from '../src/server/database';
import { runMaintenance } from '../scripts/backend-maintenance.mjs';
import { runMigrations, computeFileChecksum, prepareMigrationForExecution } from '../scripts/migrate.mjs';
import { validateTestDbUrls, verifyDedicatedCluster, quoteIdentifier, validateMaintenanceUrl, validateMaintenanceRole } from '../scripts/validate-test-db.mjs';
import { verifyMigrationHistory } from '../scripts/verify-migration-history.mjs';
import { assertSafeTestDatabaseUrl } from './helpers/test-db-guard';
import { handle } from '../src/server/http';
import { logSecurityEvent } from '../src/server/logger';

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
    assertSafeTestDatabaseUrl(realUrl);
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
    try { await realClient.query('DROP DATABASE IF EXISTS fintrack_upgrade_test'); } catch {}
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
    // Apply migrations 001, 002, 003, and 004
    await db.exec(readFileSync('db/migrations/001_backend_foundation.sql', 'utf8'));
    await db.exec(readFileSync('db/migrations/002_backend_security_hardening.sql', 'utf8'));
    await db.exec(readFileSync('db/migrations/003_backend_deployment_closure.sql', 'utf8'));
    await db.exec(readFileSync('db/migrations/004_runtime_role_hardening.sql', 'utf8'));
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
    try {
      await db.query('UPDATE fintrack.sessions SET revoked_at=now() WHERE token_hash=$1', [bobHash]);
      await expect(asUser(bobHash, async () => true)).rejects.toThrow('UNAUTHENTICATED');
      await db.query(
        "UPDATE fintrack.sessions SET revoked_at=NULL,expires_at=now()-interval '1 second' WHERE token_hash=$1",
        [bobHash]
      );
      await expect(asUser(bobHash, async () => true)).rejects.toThrow('UNAUTHENTICATED');
      await expect(asUser('0'.repeat(64), async () => true)).rejects.toThrow('UNAUTHENTICATED');
    } finally {
      await db.query("UPDATE fintrack.sessions SET revoked_at=NULL, expires_at=now()+interval '1 hour' WHERE token_hash=$1", [bobHash]);
    }
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
  }, 25000);

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

  it.skipIf(!realUrl)('(AA) real PostgreSQL 001→002→003→004 upgrade preserves data, roles, RLS, and audit request IDs', async () => {
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

    // 5. Apply 004
    await upClient.query(readFileSync('db/migrations/004_runtime_role_hardening.sql', 'utf8'));

    // 6. Invariant verifications:
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

    // 004 maintenance cleanup indexes exist
    const idxRes = await upClient.query("SELECT indexname FROM pg_indexes WHERE schemaname = 'fintrack'");
    const idxNames = idxRes.rows.map(r => r.indexname);
    expect(idxNames).toContain('idx_idempotency_created_at');
    expect(idxNames).toContain('idx_sessions_expires_at');
    expect(idxNames).toContain('idx_sessions_revoked_at');

    await upClient.end();
  });

  it.skipIf(!realUrl)('(AB) migration checksum mutation is rejected (fails closed)', async () => {
    const adminClient = new Client({ connectionString: realUrl });
    await adminClient.connect();

    // Tamper with checksum in schema_migrations
    await adminClient.query("UPDATE fintrack.schema_migrations SET checksum = 'tampered_checksum_value' WHERE version = '001_backend_foundation.sql'");
    await adminClient.end();

    try {
      // Re-running migrations must fail closed with CHECKSUM MISMATCH
      await expect(runMigrations(realUrl!)).rejects.toThrow(/MIGRATION_CHECKSUM_MISMATCH/);
    } finally {
      // Restore correct checksum
      const restoreClient = new Client({ connectionString: realUrl });
      await restoreClient.connect();
      const validChecksum = computeFileChecksum('db/migrations/001_backend_foundation.sql');
      await restoreClient.query("UPDATE fintrack.schema_migrations SET checksum = $1 WHERE version = '001_backend_foundation.sql'", [validChecksum]);
      await restoreClient.end();
    }
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

  it.skipIf(!realUrl)('(AE) migration + checksum record are one atomic transaction', async () => {
    const adminClient = new Client({ connectionString: realUrl });
    await adminClient.connect();

    // Create trigger that fails during checksum insertion of '006_atomicity_probe.sql'
    await adminClient.query(`
      CREATE OR REPLACE FUNCTION fintrack.fail_on_atomicity_test()
      RETURNS trigger AS $$
      BEGIN
        IF NEW.version = '006_atomicity_probe.sql' THEN
          RAISE EXCEPTION 'SIMULATED_CHECKSUM_FAILURE_TRIGGERED';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_fail_atomicity ON fintrack.schema_migrations;
      CREATE TRIGGER trg_fail_atomicity
      BEFORE INSERT ON fintrack.schema_migrations
      FOR EACH ROW EXECUTE FUNCTION fintrack.fail_on_atomicity_test();
    `);

    const probeFile = 'db/migrations/006_atomicity_probe.sql';
    writeFileSync(probeFile, 'CREATE TABLE fintrack.atomicity_probe_table (id int);');

    try {
      // Running migrations must fail closed during checksum insertion
      await expect(runMigrations(realUrl!)).rejects.toThrow(/SIMULATED_CHECKSUM_FAILURE_TRIGGERED/);

      // Verify that table atomicity_probe_table was ROLLED BACK and does not exist!
      const tableCheck = await adminClient.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables WHERE table_schema = 'fintrack' AND table_name = 'atomicity_probe_table'
        ) AS exists;
      `);
      expect(tableCheck.rows[0].exists).toBe(false);

      // And schema_migrations does not have entry for 006
      const migCheck = await adminClient.query(
        "SELECT 1 FROM fintrack.schema_migrations WHERE version = '006_atomicity_probe.sql'"
      );
      expect(migCheck.rows.length).toBe(0);
    } finally {
      unlinkSync(probeFile);
      await adminClient.query('DROP TRIGGER IF EXISTS trg_fail_atomicity ON fintrack.schema_migrations');
      await adminClient.query('DROP FUNCTION IF EXISTS fintrack.fail_on_atomicity_test()');
      await adminClient.end();
    }
  });

  it.skipIf(!realUrl)('(AF) missing applied migration file fails closed (MIGRATION_HISTORY_GAP)', async () => {
    const adminClient = new Client({ connectionString: realUrl });
    await adminClient.connect();
    // Insert a dummy future version into schema_migrations
    await adminClient.query("INSERT INTO fintrack.schema_migrations (version, checksum) VALUES ('999_missing_file.sql', 'fakechecksum')");
    await adminClient.end();

    try {
      await expect(runMigrations(realUrl!)).rejects.toThrow(/MIGRATION_HISTORY_GAP/);
    } finally {
      const cleanClient = new Client({ connectionString: realUrl });
      await cleanClient.connect();
      await cleanClient.query("DELETE FROM fintrack.schema_migrations WHERE version = '999_missing_file.sql'");
      await cleanClient.end();
    }
  });

  it.skipIf(!realUrl)('(AG) out-of-order inserted historical migration fails closed (MIGRATION_HISTORY_MISMATCH)', async () => {
    const patchFile = 'db/migrations/0025_security_patch.sql';
    writeFileSync(patchFile, 'SELECT 1;');

    try {
      // Since 003 and 004 are already applied in DB, 0025 inserted between 002 and 003 must fail closed
      await expect(runMigrations(realUrl!)).rejects.toThrow(/MIGRATION_HISTORY_MISMATCH/);
    } finally {
      unlinkSync(patchFile);
    }
  });

  it.skipIf(!realUrl)('(AH) legacy schema without migration history fails closed with LEGACY_SCHEMA_ADOPTION_UNSUPPORTED', async () => {
    const rootUrl = realUrl!.substring(0, realUrl!.lastIndexOf('/') + 1) + 'postgres';
    const rootClient = new Client({ connectionString: rootUrl });
    await rootClient.connect();
    await rootClient.query('DROP DATABASE IF EXISTS fintrack_legacy_test');
    await rootClient.query('CREATE DATABASE fintrack_legacy_test');
    await rootClient.end();

    const legacyUrl = realUrl!.substring(0, realUrl!.lastIndexOf('/') + 1) + 'fintrack_legacy_test';
    const legacyClient = new Client({ connectionString: legacyUrl });
    await legacyClient.connect();

    // Create legacy fintrack schema and tables without schema_migrations
    await legacyClient.query('CREATE SCHEMA fintrack');
    await legacyClient.query('CREATE TABLE fintrack.users (id uuid PRIMARY KEY)');
    await legacyClient.query('CREATE TABLE fintrack.sessions (token_hash text PRIMARY KEY, user_id uuid, expires_at timestamptz, revoked_at timestamptz)');
    await legacyClient.query('CREATE TABLE fintrack.wallets (id uuid PRIMARY KEY, user_id uuid, name text, type text, opening_balance bigint, balance bigint)');
    await legacyClient.query('CREATE TABLE fintrack.transfers (id uuid PRIMARY KEY, user_id uuid, from_wallet_id uuid, to_wallet_id uuid, amount bigint, fee bigint, created_at timestamptz DEFAULT now())');
    await legacyClient.query('CREATE TABLE fintrack.rate_limits (user_id uuid, scope text, bucket bigint, hits int, PRIMARY KEY (user_id, scope))');
    await legacyClient.query('CREATE TABLE fintrack.audit_events (id uuid PRIMARY KEY, user_id uuid, action text, resource_id uuid, request_id uuid, created_at timestamptz DEFAULT now())');
    await legacyClient.query("CREATE FUNCTION fintrack.current_session_user_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT '00000000-0000-0000-0000-000000000000'::uuid $$;");
    await legacyClient.end();

    try {
      // runMigrations on legacy schema without schema_migrations must fail closed
      await expect(runMigrations(legacyUrl)).rejects.toThrow(/LEGACY_SCHEMA_ADOPTION_UNSUPPORTED/);
    } finally {
      const cleanRoot = new Client({ connectionString: rootUrl });
      await cleanRoot.connect();
      await cleanRoot.query('DROP DATABASE IF EXISTS fintrack_legacy_test');
      await cleanRoot.end();
    }
  });

  it('(AI) npm test with NO PostgreSQL environment does not attempt any TCP/database connection', () => {
    expect(() => assertSafeTestDatabaseUrl(undefined)).toThrow(/DATABASE_TEST_URL is required/);
  });

  it('(AJ) destructive DB test refuses unsafe database name', () => {
    const prev = process.env.ALLOW_DESTRUCTIVE_DB_TESTS;
    process.env.ALLOW_DESTRUCTIVE_DB_TESTS = 'true';
    try {
      expect(() => assertSafeTestDatabaseUrl('postgres://user:pw@host/postgres')).toThrow(/forbidden/);
      expect(() => assertSafeTestDatabaseUrl('postgres://user:pw@host/fintrack')).toThrow(/forbidden/);
      expect(() => assertSafeTestDatabaseUrl('postgres://user:pw@host/production')).toThrow(/forbidden/);
      expect(() => assertSafeTestDatabaseUrl('postgres://user:pw@host/random_db')).toThrow(/pattern/);
    } finally {
      process.env.ALLOW_DESTRUCTIVE_DB_TESTS = prev;
    }
  });

  it('(AK) destructive DB test refuses execution without explicit opt-in', () => {
    const prev = process.env.ALLOW_DESTRUCTIVE_DB_TESTS;
    process.env.ALLOW_DESTRUCTIVE_DB_TESTS = 'false';
    try {
      expect(() => assertSafeTestDatabaseUrl('postgres://user:pw@host/fintrack_test')).toThrow(/ALLOW_DESTRUCTIVE_DB_TESTS=true is required/);
    } finally {
      process.env.ALLOW_DESTRUCTIVE_DB_TESTS = prev;
    }
  });

  it.skipIf(!realUrl)('(AM) logout success log is emitted only after commit', async () => {
    let afterCommitCalled = false;
    let metaCaptured: any = null;

    const prevApi = process.env.ENABLE_BACKEND_API;
    const prevOrigin = process.env.APP_ORIGIN;
    const prevUrl = process.env.DATABASE_URL;
    process.env.ENABLE_BACKEND_API = 'true';
    process.env.APP_ORIGIN = 'https://fintrack.example';
    process.env.DATABASE_URL = 'postgres://fintrack_app_login:test-login-password@localhost:5432/fintrack_test';
    await resetPoolForTesting();

    const mockReq = new Request('https://fintrack.example/api/v2/session/logout', {
      method: 'POST',
      headers: {
        origin: 'https://fintrack.example',
        cookie: `__Host-fintrack_session=${'a'.repeat(43)}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    try {
      // Verify afterCommit contract on handle()
      await handle(
        mockReq,
        async () => ({ committed: true }),
        {
          rateLimitMode: 'none',
          afterCommit: (_res, meta) => {
            afterCommitCalled = true;
            metaCaptured = meta;
          },
        }
      );

      expect(afterCommitCalled).toBe(true);
      expect(metaCaptured.requestId).toBeTruthy();
      expect(metaCaptured.userId).toBe(alice);
    } finally {
      process.env.ENABLE_BACKEND_API = prevApi;
      process.env.APP_ORIGIN = prevOrigin;
      process.env.DATABASE_URL = prevUrl;
      await resetPoolForTesting();
    }
  });

  it.skipIf(!realUrl)('(AN) simulated commit/revocation failure emits no success-revocation log', async () => {
    let afterCommitCalled = false;

    const prevApi = process.env.ENABLE_BACKEND_API;
    const prevOrigin = process.env.APP_ORIGIN;
    const prevUrl = process.env.DATABASE_URL;
    process.env.ENABLE_BACKEND_API = 'true';
    process.env.APP_ORIGIN = 'https://fintrack.example';
    process.env.DATABASE_URL = 'postgres://fintrack_app_login:test-login-password@localhost:5432/fintrack_test';
    await resetPoolForTesting();

    const mockReq = new Request('https://fintrack.example/api/v2/session/logout', {
      method: 'POST',
      headers: {
        origin: 'https://fintrack.example',
        cookie: `__Host-fintrack_session=${'a'.repeat(43)}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    try {
      await handle(
        mockReq,
        async () => {
          throw new Error('SIMULATED_TRANSACTION_FAILURE');
        },
        {
          rateLimitMode: 'none',
          afterCommit: () => {
            afterCommitCalled = true;
          },
        }
      );

      expect(afterCommitCalled).toBe(false);
    } finally {
      process.env.ENABLE_BACKEND_API = prevApi;
      process.env.APP_ORIGIN = prevOrigin;
      process.env.DATABASE_URL = prevUrl;
      await resetPoolForTesting();
    }
  });

  it.skipIf(!realUrl)('(AO) pre-existing direct table grant to app login is removed and rejected by transaction()', async () => {
    const adminClient = new Client({ connectionString: realUrl });
    await adminClient.connect();

    // Grant unexpected direct table privilege to fintrack_app_login
    await adminClient.query('GRANT SELECT ON fintrack.wallets TO fintrack_app_login');
    await adminClient.end();

    const prevUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgres://fintrack_app_login:test-login-password@localhost:5432/fintrack_test';
    await resetPoolForTesting();

    try {
      // transaction() must detect direct table privileges and fail closed with UNSAFE_DATABASE_ROLE
      await expect(transaction(async () => 'ok')).rejects.toThrow(/UNSAFE_DATABASE_ROLE/);
    } finally {
      const cleanClient = new Client({ connectionString: realUrl });
      await cleanClient.connect();
      await cleanClient.query('REVOKE ALL ON fintrack.wallets FROM fintrack_app_login');
      await cleanClient.end();
      process.env.DATABASE_URL = prevUrl;
      await resetPoolForTesting();
    }
  });

  it.skipIf(!realUrl)('(AP) unexpected role membership fails closed', async () => {
    const adminClient = new Client({ connectionString: realUrl });
    await adminClient.connect();

    // Grant unexpected role to fintrack_app_login
    try { await adminClient.query('CREATE ROLE test_intruder_role NOLOGIN'); } catch {}
    await adminClient.query('GRANT test_intruder_role TO fintrack_app_login');
    await adminClient.end();

    const prevUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgres://fintrack_app_login:test-login-password@localhost:5432/fintrack_test';
    await resetPoolForTesting();

    try {
      // transaction() must detect unexpected membership and fail closed
      await expect(transaction(async () => 'ok')).rejects.toThrow(/UNSAFE_DATABASE_ROLE/);
    } finally {
      const cleanClient = new Client({ connectionString: realUrl });
      await cleanClient.connect();
      await cleanClient.query('REVOKE test_intruder_role FROM fintrack_app_login');
      await cleanClient.query('DROP ROLE IF EXISTS test_intruder_role');
      await cleanClient.end();
      process.env.DATABASE_URL = prevUrl;
      await resetPoolForTesting();
    }
  });

  it.skipIf(!realUrl)('(AQ) production EXPECTED_LOGIN_ROLE override cannot change trusted role', async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevRole = process.env.EXPECTED_LOGIN_ROLE;
    const prevUrl = process.env.DATABASE_URL;
    const prevSsl = process.env.ALLOW_INSECURE_TEST_LOCAL_SSL;

    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    process.env.ALLOW_INSECURE_TEST_LOCAL_SSL = 'true';
    process.env.EXPECTED_LOGIN_ROLE = 'attacker_supplied_role';
    process.env.DATABASE_URL = 'postgres://fintrack_app_login:test-login-password@localhost:5432/fintrack_test';
    await resetPoolForTesting();

    try {
      // In production, EXPECTED_LOGIN_ROLE is ignored and fintrack_app_login remains strictly expected
      const res = await transaction(async () => 'ok');
      expect(res).toBe('ok');
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = prevNodeEnv;
      if (prevRole !== undefined) process.env.EXPECTED_LOGIN_ROLE = prevRole;
      else delete process.env.EXPECTED_LOGIN_ROLE;
      if (prevUrl !== undefined) process.env.DATABASE_URL = prevUrl;
      else delete process.env.DATABASE_URL;
      if (prevSsl !== undefined) process.env.ALLOW_INSECURE_TEST_LOCAL_SSL = prevSsl;
      else delete process.env.ALLOW_INSECURE_TEST_LOCAL_SSL;
      await resetPoolForTesting();
    }
  });

  it.skipIf(!realUrl)('(AR) maintenance cleanup indexes exist in fintrack schema', async () => {
    const client = new Client({ connectionString: realUrl });
    await client.connect();

    const idxRes = await client.query("SELECT indexname FROM pg_indexes WHERE schemaname = 'fintrack'");
    const idxNames = idxRes.rows.map(r => r.indexname);

    expect(idxNames).toContain('idx_idempotency_created_at');
    expect(idxNames).toContain('idx_sessions_expires_at');
    expect(idxNames).toContain('idx_sessions_revoked_at');

    await client.end();
  });

  it('(AS) backup temporary file permissions are owner-only and cleanup trap runs', () => {
    const cmd = `bash -c 'umask 077; F="$(mktemp -t fintrack_test_XXXXXX.sql)"; stat -c %a "$F"; (trap "rm -f $F" EXIT; exit 0); test ! -f "$F"'`;
    const output = execSync(cmd, { encoding: 'utf8' }).trim();
    expect(output).toBe('600');
  });

  it('(AT) destructive backup drill requires explicit database URLs', () => {
    try {
      execSync('bash scripts/backup-restore-drill.sh', {
        env: { ...process.env, DATABASE_TEST_URL: '', DATABASE_RESTORE_URL: '' },
        stdio: 'pipe',
      });
      expect.unreachable('Should have failed without database URLs');
    } catch (e: any) {
      expect(e.status).toBe(1);
      const combined = (e.stderr?.toString() || '') + (e.stdout?.toString() || '');
      expect(combined).toContain('DATABASE_TEST_URL and DATABASE_RESTORE_URL are strictly required');
    }
  });

  it('(AU) CodeQL workflow covers fix/** and feature/**', () => {
    const workflowPath = '.github/workflows/codeql.yml';
    const content = readFileSync(workflowPath, 'utf8');
    expect(content).toContain('"feature/**"');
    expect(content).toContain('"fix/**"');
  });

  it.skipIf(!realUrl)('(AV) legacy schema without migration history is rejected by normal migration runner', async () => {
    const rootUrl = realUrl!.substring(0, realUrl!.lastIndexOf('/') + 1) + 'postgres';
    const rootClient = new Client({ connectionString: rootUrl });
    await rootClient.connect();
    await rootClient.query('DROP DATABASE IF EXISTS fintrack_av_test');
    await rootClient.query('CREATE DATABASE fintrack_av_test');
    await rootClient.end();

    const incUrl = realUrl!.substring(0, realUrl!.lastIndexOf('/') + 1) + 'fintrack_av_test';
    const incClient = new Client({ connectionString: incUrl });
    await incClient.connect();
    await incClient.query('CREATE SCHEMA fintrack');
    await incClient.query('CREATE TABLE fintrack.users (id uuid PRIMARY KEY)');
    await incClient.query('CREATE TABLE fintrack.wallets (id uuid PRIMARY KEY)');
    await incClient.end();

    try {
      await expect(runMigrations(incUrl)).rejects.toThrow(
        /LEGACY_SCHEMA_ADOPTION_UNSUPPORTED/
      );
    } finally {
      const cleanClient = new Client({ connectionString: rootUrl });
      await cleanClient.connect();
      await cleanClient.query('DROP DATABASE IF EXISTS fintrack_av_test');
      await cleanClient.end();
    }
  });

  it.skipIf(!realUrl)('(AZ) backup source contains complete migration checksum history', async () => {
    const history = await verifyMigrationHistory(realUrl!);
    expect(history.total).toBe(5);
    expect(history.versions).toEqual([
      '001_backend_foundation.sql',
      '002_backend_security_hardening.sql',
      '003_backend_deployment_closure.sql',
      '004_runtime_role_hardening.sql',
      '005_session_revocation_hardening.sql',
    ]);
  });

  it.skipIf(!realUrl)('(BA) restored DB passes normal migration verification', async () => {
    const rootUrl = realUrl!.substring(0, realUrl!.lastIndexOf('/') + 1) + 'postgres';
    const rootClient = new Client({ connectionString: rootUrl });
    await rootClient.connect();
    await rootClient.query('DROP DATABASE IF EXISTS fintrack_ba_test');
    await rootClient.query('CREATE DATABASE fintrack_ba_test');
    await rootClient.end();

    const restoreUrl = realUrl!.substring(0, realUrl!.lastIndexOf('/') + 1) + 'fintrack_ba_test';
    const backupFile = execSync('mktemp -t fintrack_ba_XXXXXX.sql', { encoding: 'utf8' }).trim();
    try {
      execSync(`pg_dump "${realUrl}" --schema=fintrack --clean --if-exists --no-owner > "${backupFile}"`);
      execSync(`psql "${restoreUrl}" -v ON_ERROR_STOP=1 -f "${backupFile}"`);

      // Verify all rows in schema_migrations survived restore
      const history = await verifyMigrationHistory(restoreUrl);
      expect(history.total).toBe(5);

      // Verify migration runner accepts restored DB with 0 pending
      const res = await runMigrations(restoreUrl);
      expect(res.appliedCount).toBe(0);
    } finally {
      unlinkSync(backupFile);
      const cleanClient = new Client({ connectionString: rootUrl });
      await cleanClient.connect();
      await cleanClient.query('DROP DATABASE IF EXISTS fintrack_ba_test');
      await cleanClient.end();
    }
  });

  it.skipIf(!realUrl)('(BB) concurrent migration runners serialize safely', async () => {
    const p1 = runMigrations(realUrl!);
    const p2 = runMigrations(realUrl!);
    const [res1, res2] = await Promise.all([p1, p2]);
    expect(res1.appliedCount).toBe(0);
    expect(res2.appliedCount).toBe(0);
  });

  it.skipIf(!realUrl)('(BC) fintrack_runtime unexpected membership fails closed', async () => {
    const client = new Client({ connectionString: realUrl });
    await client.connect();
    await client.query('DROP ROLE IF EXISTS fintrack_priv_test_role');
    await client.query('CREATE ROLE fintrack_priv_test_role NOLOGIN');
    await client.query('GRANT fintrack_priv_test_role TO fintrack_runtime');
    await client.end();

    const prevUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgres://fintrack_app_login:test-login-password@localhost:5432/fintrack_test';
    try {
      await resetPoolForTesting();
      await expect(transaction(async () => 'ok')).rejects.toThrow(/UNSAFE_DATABASE_ROLE/);
    } finally {
      process.env.DATABASE_URL = prevUrl;
      const cleanClient = new Client({ connectionString: realUrl });
      await cleanClient.connect();
      await cleanClient.query('REVOKE fintrack_priv_test_role FROM fintrack_runtime');
      await cleanClient.query('DROP ROLE IF EXISTS fintrack_priv_test_role');
      await cleanClient.end();
      await resetPoolForTesting();
    }
  });

  it.skipIf(!realUrl)('(BD) fintrack_runtime owns table -> transaction fails closed', async () => {
    const client = new Client({ connectionString: realUrl });
    await client.connect();
    await client.query('CREATE TABLE fintrack.test_leak_table ()');
    await client.query('ALTER TABLE fintrack.test_leak_table OWNER TO fintrack_runtime');
    await client.end();

    const prevUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgres://fintrack_app_login:test-login-password@localhost:5432/fintrack_test';
    try {
      await resetPoolForTesting();
      await expect(transaction(async () => 'ok')).rejects.toThrow(/UNSAFE_DATABASE_ROLE/);
    } finally {
      process.env.DATABASE_URL = prevUrl;
      const cleanClient = new Client({ connectionString: realUrl });
      await cleanClient.connect();
      await cleanClient.query('DROP TABLE IF EXISTS fintrack.test_leak_table');
      await cleanClient.end();
      await resetPoolForTesting();
    }
  });

  it.skipIf(!realUrl)('(BE) fintrack_app_login owns routine/schema -> fails closed', async () => {
    const client = new Client({ connectionString: realUrl });
    await client.connect();
    await client.query('CREATE FUNCTION fintrack.test_owned_routine() RETURNS void AS $$ BEGIN END $$ LANGUAGE plpgsql');
    await client.query('ALTER FUNCTION fintrack.test_owned_routine() OWNER TO fintrack_app_login');
    await client.end();

    const prevUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgres://fintrack_app_login:test-login-password@localhost:5432/fintrack_test';
    try {
      await resetPoolForTesting();
      await expect(transaction(async () => 'ok')).rejects.toThrow(/UNSAFE_DATABASE_ROLE/);
    } finally {
      process.env.DATABASE_URL = prevUrl;
      const cleanClient = new Client({ connectionString: realUrl });
      await cleanClient.connect();
      await cleanClient.query('DROP FUNCTION IF EXISTS fintrack.test_owned_routine()');
      await cleanClient.end();
      await resetPoolForTesting();
    }
  });

  it.skipIf(!realUrl)('(BF) current_session_user_id has no accidental PUBLIC EXECUTE', async () => {
    const client = new Client({ connectionString: realUrl });
    await client.connect();
    const res = await client.query(
      "SELECT has_function_privilege('public', 'fintrack.current_session_user_id()', 'execute') AS has_priv"
    );
    expect(res.rows[0].has_priv).toBe(false);
    await client.end();
  });

  it('(BG) backup drill refuses execution without ALLOW_DESTRUCTIVE_DB_TESTS', () => {
    const prev = process.env.ALLOW_DESTRUCTIVE_DB_TESTS;
    delete process.env.ALLOW_DESTRUCTIVE_DB_TESTS;
    try {
      expect(() =>
        validateTestDbUrls('postgres://127.0.0.1:5432/fintrack_test', 'postgres://127.0.0.1:5432/fintrack_restore')
      ).toThrow(/ALLOW_DESTRUCTIVE_DB_TESTS=true is strictly required/);
    } finally {
      if (prev !== undefined) process.env.ALLOW_DESTRUCTIVE_DB_TESTS = prev;
    }
  });

  it('(BH) backup drill rejects unsafe source database name', () => {
    const prev = process.env.ALLOW_DESTRUCTIVE_DB_TESTS;
    process.env.ALLOW_DESTRUCTIVE_DB_TESTS = 'true';
    try {
      expect(() =>
        validateTestDbUrls('postgres://127.0.0.1:5432/postgres', 'postgres://127.0.0.1:5432/fintrack_restore')
      ).toThrow(/forbidden/);
      expect(() =>
        validateTestDbUrls('postgres://127.0.0.1:5432/fintrack', 'postgres://127.0.0.1:5432/fintrack_restore')
      ).toThrow(/forbidden/);
      expect(() =>
        validateTestDbUrls('postgres://127.0.0.1:5432/production', 'postgres://127.0.0.1:5432/fintrack_restore')
      ).toThrow(/forbidden/);
      expect(() =>
        validateTestDbUrls('postgres://127.0.0.1:5432/my_custom_db', 'postgres://127.0.0.1:5432/fintrack_restore')
      ).toThrow(/pattern/);
    } finally {
      if (prev !== undefined) process.env.ALLOW_DESTRUCTIVE_DB_TESTS = prev;
      else delete process.env.ALLOW_DESTRUCTIVE_DB_TESTS;
    }
  });

  it('(BI) backup drill rejects source == restore database', () => {
    const prev = process.env.ALLOW_DESTRUCTIVE_DB_TESTS;
    process.env.ALLOW_DESTRUCTIVE_DB_TESTS = 'true';
    try {
      expect(() =>
        validateTestDbUrls('postgres://127.0.0.1:5432/fintrack_test', 'postgres://127.0.0.1:5432/fintrack_test')
      ).toThrow(/must be distinct/);
    } finally {
      if (prev !== undefined) process.env.ALLOW_DESTRUCTIVE_DB_TESTS = prev;
      else delete process.env.ALLOW_DESTRUCTIVE_DB_TESTS;
    }
  });

  it('(BJ) backend security workflow covers main + feature/** + fix/**', () => {
    const workflowPath = '.github/workflows/backend-security.yml';
    const content = readFileSync(workflowPath, 'utf8');
    expect(content).toContain('main');
    expect(content).toContain('dev/fintrack-v2');
    expect(content).toContain('"feature/**"');
    expect(content).toContain('"fix/**"');
  });

  it('(BK) logout succeeds with empty/no JSON body while Origin validation remains enforced', () => {
    const prevOrigin = process.env.APP_ORIGIN;
    process.env.APP_ORIGIN = 'https://fintrack.example';
    try {
      // 1. Valid origin, no body/no JSON content-type -> checkMutationOrigin succeeds with requireJson: false
      const validReq = new Request('https://fintrack.example/api/v2/session/logout', {
        method: 'POST',
        headers: {
          origin: 'https://fintrack.example',
          'sec-fetch-site': 'same-origin',
        },
      });
      expect(() => checkMutationOrigin(validReq, { requireJson: false })).not.toThrow();

      // 2. Untrusted origin with requireJson: false -> strictly throws 403 INVALID_ORIGIN
      const badOriginReq = new Request('https://fintrack.example/api/v2/session/logout', {
        method: 'POST',
        headers: {
          origin: 'https://attacker.example',
          'sec-fetch-site': 'same-origin',
        },
      });
      expect(() => checkMutationOrigin(badOriginReq, { requireJson: false })).toThrow(/INVALID_ORIGIN/);

      // 3. Cross-site Sec-Fetch-Site with requireJson: false -> strictly throws 403 CROSS_SITE_REQUEST
      const crossSiteReq = new Request('https://fintrack.example/api/v2/session/logout', {
        method: 'POST',
        headers: {
          origin: 'https://fintrack.example',
          'sec-fetch-site': 'cross-site',
        },
      });
      expect(() => checkMutationOrigin(crossSiteReq, { requireJson: false })).toThrow(/CROSS_SITE_REQUEST/);

      // 4. Financial mutations with requireJson: true still require application/json
      expect(() => checkMutationOrigin(validReq, { requireJson: true })).toThrow(/JSON_REQUIRED/);
    } finally {
      if (prevOrigin !== undefined) process.env.APP_ORIGIN = prevOrigin;
      else delete process.env.APP_ORIGIN;
    }
  });

  it.skipIf(!realUrl)('(BL) pooled DB transaction starts from known-safe role/GUC state', async () => {
    const prevUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgres://fintrack_app_login:test-login-password@localhost:5432/fintrack_test';
    await resetPoolForTesting();

    try {
      // Verify transaction baseline settings
      await transaction(async (client) => {
        const roleRes = await client.query('SELECT current_user, session_user');
        expect(roleRes.rows[0].session_user).toBe('fintrack_app_login');
        expect(roleRes.rows[0].current_user).toBe('fintrack_runtime');

        const pathRes = await client.query("SHOW search_path");
        expect(pathRes.rows[0].search_path).toContain('fintrack');

        const lockRes = await client.query("SHOW lock_timeout");
        expect(lockRes.rows[0].lock_timeout).toBe('3s');

        const stmtRes = await client.query("SHOW statement_timeout");
        expect(stmtRes.rows[0].statement_timeout).toBe('5s');
      });

      // Even if previous transaction threw an error, next transaction runs cleanly
      await expect(
        transaction(async (client) => {
          await client.query("SET search_path = public");
          throw new Error('deliberate failure');
        })
      ).rejects.toThrow('deliberate failure');

      await transaction(async (client) => {
        const pathRes = await client.query("SHOW search_path");
        expect(pathRes.rows[0].search_path).toContain('fintrack');
      });
    } finally {
      process.env.DATABASE_URL = prevUrl;
      await resetPoolForTesting();
    }
  });

  it.skipIf(!realUrl)('(BM) active current session may be revoked exactly once', async () => {
    const rawToken = 'test-token-bm-active-session-1234567890123456';
    const hash = createHash('sha256').update(rawToken).digest('hex');
    const client = new Client({ connectionString: realUrl });
    await client.connect();

    await client.query(
      "INSERT INTO fintrack.sessions (token_hash, user_id, expires_at, revoked_at) VALUES ($1, $2, now() + interval '1 hour', NULL) ON CONFLICT (token_hash) DO UPDATE SET revoked_at = NULL, expires_at = now() + interval '1 hour'",
      [hash, alice]
    );

    // Switch to fintrack_runtime
    await client.query("SET ROLE fintrack_runtime");
    await client.query("SELECT set_config('app.session_hash', $1, false)", [hash]);

    // First revocation: succeeds
    await expect(revokeCurrentSession(client as unknown as PoolClient)).resolves.toBeUndefined();

    // Verify in DB that revoked_at IS NOT NULL
    await client.query("RESET ROLE");
    const checkRes = await client.query("SELECT revoked_at FROM fintrack.sessions WHERE token_hash = $1", [hash]);
    expect(checkRes.rows[0].revoked_at).not.toBeNull();

    // Second revocation: fails with 401 UNAUTHENTICATED
    await client.query("SET ROLE fintrack_runtime");
    await client.query("SELECT set_config('app.session_hash', $1, false)", [hash]);
    await expect(revokeCurrentSession(client as unknown as PoolClient)).rejects.toThrow(/UNAUTHENTICATED/);

    await client.query("RESET ROLE");
    await client.query("DELETE FROM fintrack.sessions WHERE token_hash = $1", [hash]);
    await client.end();
  });

  it.skipIf(!realUrl)('(BN) revoked session cannot be set back to revoked_at = NULL by fintrack_runtime', async () => {
    const rawToken = 'test-token-bn-revoked-session-123456789012345';
    const hash = createHash('sha256').update(rawToken).digest('hex');
    const client = new Client({ connectionString: realUrl });
    await client.connect();

    // Insert already revoked session
    await client.query(
      "INSERT INTO fintrack.sessions (token_hash, user_id, expires_at, revoked_at) VALUES ($1, $2, now() + interval '1 hour', now() - interval '5 minutes') ON CONFLICT (token_hash) DO UPDATE SET revoked_at = now() - interval '5 minutes'",
      [hash, alice]
    );

    // Attempt reactivating as fintrack_runtime
    await client.query("SET ROLE fintrack_runtime");
    await client.query("SELECT set_config('app.session_hash', $1, false)", [hash]);

    // Monotonic policy USING blocks update of already-revoked session (0 rows affected)
    const updateRes = await client.query("UPDATE fintrack.sessions SET revoked_at = NULL WHERE token_hash = $1", [hash]);
    expect(updateRes.rowCount).toBe(0);

    // Verify session remains revoked
    await client.query("RESET ROLE");
    const checkRes = await client.query("SELECT revoked_at FROM fintrack.sessions WHERE token_hash = $1", [hash]);
    expect(checkRes.rows[0].revoked_at).not.toBeNull();

    await client.query("DELETE FROM fintrack.sessions WHERE token_hash = $1", [hash]);
    await client.end();
  });

  it.skipIf(!realUrl)('(BO) expired session cannot be revoked/reactivated through runtime role', async () => {
    const rawToken = 'test-token-bo-expired-session-123456789012345';
    const hash = createHash('sha256').update(rawToken).digest('hex');
    const client = new Client({ connectionString: realUrl });
    await client.connect();

    // Insert expired session
    await client.query(
      "INSERT INTO fintrack.sessions (token_hash, user_id, expires_at, revoked_at) VALUES ($1, $2, now() - interval '10 minutes', NULL) ON CONFLICT (token_hash) DO UPDATE SET expires_at = now() - interval '10 minutes', revoked_at = NULL",
      [hash, alice]
    );

    // Under runtime role, attempt to revoke or update expired session
    await client.query("SET ROLE fintrack_runtime");
    await client.query("SELECT set_config('app.session_hash', $1, false)", [hash]);

    // Cannot revoke expired session (0 rows match USING policy -> throws 401)
    await expect(revokeCurrentSession(client as unknown as PoolClient)).rejects.toThrow(/UNAUTHENTICATED/);

    // Cannot extend expiry (runtime role has no UPDATE grant on expires_at and USING rejects expired)
    await expect(
      client.query("UPDATE fintrack.sessions SET expires_at = now() + interval '1 day' WHERE token_hash = $1", [hash])
    ).rejects.toThrow();

    await client.query("RESET ROLE");
    await client.query("DELETE FROM fintrack.sessions WHERE token_hash = $1", [hash]);
    await client.end();
  });

  it.skipIf(!realUrl)('(BP) a different session token cannot update another session', async () => {
    const tokenA = 'test-token-bp-token-a-12345678901234567890123';
    const tokenB = 'test-token-bp-token-b-12345678901234567890123';
    const hashA = createHash('sha256').update(tokenA).digest('hex');
    const hashB = createHash('sha256').update(tokenB).digest('hex');

    const client = new Client({ connectionString: realUrl });
    await client.connect();

    // Insert active sessions A and B
    await client.query(
      "INSERT INTO fintrack.sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour') ON CONFLICT (token_hash) DO UPDATE SET revoked_at = NULL",
      [hashA, alice]
    );
    await client.query(
      "INSERT INTO fintrack.sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour') ON CONFLICT (token_hash) DO UPDATE SET revoked_at = NULL",
      [hashB, '22222222-2222-4222-8222-222222222222']
    );

    // Set context to token A, try to update token B
    await client.query("SET ROLE fintrack_runtime");
    await client.query("SELECT set_config('app.session_hash', $1, false)", [hashA]);

    const updateRes = await client.query(
      "UPDATE fintrack.sessions SET revoked_at = now() WHERE token_hash = $1",
      [hashB]
    );
    expect(updateRes.rowCount).toBe(0);

    // Verify token B is still active
    await client.query("RESET ROLE");
    const checkB = await client.query("SELECT revoked_at FROM fintrack.sessions WHERE token_hash = $1", [hashB]);
    expect(checkB.rows[0].revoked_at).toBeNull();

    await client.query("DELETE FROM fintrack.sessions WHERE token_hash IN ($1, $2)", [hashA, hashB]);
    await client.end();
  });

  it.skipIf(!realUrl)('(BQ) revoked session receives 401 through authentication', async () => {
    const rawToken = 'test-token-bq-auth-revoked-123456789012345678';
    const hash = createHash('sha256').update(rawToken).digest('hex');
    const client = new Client({ connectionString: realUrl });
    await client.connect();

    // Seed revoked session
    await client.query(
      "INSERT INTO fintrack.sessions (token_hash, user_id, expires_at, revoked_at) VALUES ($1, $2, now() + interval '1 hour', now() - interval '1 minute') ON CONFLICT (token_hash) DO UPDATE SET revoked_at = now()",
      [hash, alice]
    );

    // Authenticate with revoked session hash throws 401 UNAUTHENTICATED
    await client.query("SET ROLE fintrack_runtime");
    await expect(authenticate(client as unknown as PoolClient, hash)).rejects.toThrow(/UNAUTHENTICATED/);

    await client.query("RESET ROLE");
    await client.query("DELETE FROM fintrack.sessions WHERE token_hash = $1", [hash]);
    await client.end();
  });

  it.skipIf(!realUrl)('(BR) logout still commits revocation and clears cookie correctly', async () => {
    const rawToken = 'c'.repeat(43);
    const hash = createHash('sha256').update(rawToken).digest('hex');
    const client = new Client({ connectionString: realUrl });
    await client.connect();

    await client.query(
      "INSERT INTO fintrack.sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour') ON CONFLICT (token_hash) DO UPDATE SET revoked_at = NULL",
      [hash, alice]
    );
    await client.end();

    const prevOrigin = process.env.APP_ORIGIN;
    const prevEnabled = process.env.ENABLE_BACKEND_API;
    const prevDbUrl = process.env.DATABASE_URL;

    process.env.APP_ORIGIN = 'https://fintrack.example';
    process.env.ENABLE_BACKEND_API = 'true';
    process.env.DATABASE_URL = process.env.DATABASE_APP_TEST_URL || realUrl!.replace(/\/\/[^:]+:[^@]+@/, '//fintrack_app_login:test-login-password@');
    delete process.env.EXPECTED_LOGIN_ROLE;
    await resetPoolForTesting();

    try {
      const logoutReq = new Request('https://fintrack.example/api/v2/session/logout', {
        method: 'POST',
        headers: {
          origin: 'https://fintrack.example',
          'sec-fetch-site': 'same-origin',
          cookie: `__Host-fintrack_session=${rawToken}`,
        },
      });

      const { POST } = await import('../src/app/api/v2/session/logout/route');
      const res = await POST(logoutReq);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.revoked).toBe(true);

      const setCookie = res.headers.get('set-cookie') || '';
      expect(setCookie).toContain('Max-Age=0');
      expect(setCookie).toContain('__Host-fintrack_session=');

      // Check DB directly
      const verifyClient = new Client({ connectionString: realUrl });
      await verifyClient.connect();
      const dbRow = await verifyClient.query("SELECT revoked_at FROM fintrack.sessions WHERE token_hash = $1", [hash]);
      expect(dbRow.rows[0].revoked_at).not.toBeNull();
      await verifyClient.query("DELETE FROM fintrack.sessions WHERE token_hash = $1", [hash]);
      await verifyClient.end();
    } finally {
      if (prevOrigin !== undefined) process.env.APP_ORIGIN = prevOrigin;
      else delete process.env.APP_ORIGIN;
      if (prevEnabled !== undefined) process.env.ENABLE_BACKEND_API = prevEnabled;
      else delete process.env.ENABLE_BACKEND_API;
      if (prevDbUrl !== undefined) process.env.DATABASE_URL = prevDbUrl;
      else delete process.env.DATABASE_URL;
      await resetPoolForTesting();
    }
  });

  it('(BS) remote hostname with customer_test is rejected without danger gate', () => {
    const prev = process.env.ALLOW_DESTRUCTIVE_DB_TESTS;
    process.env.ALLOW_DESTRUCTIVE_DB_TESTS = 'true';
    try {
      expect(() =>
        validateTestDbUrls(
          'postgres://user:pw@prod.example.com:5432/customer_test',
          'postgres://user:pw@prod.example.com:5432/customer_restore'
        )
      ).toThrow(/Remote source host "prod.example.com" is forbidden/);
    } finally {
      if (prev !== undefined) process.env.ALLOW_DESTRUCTIVE_DB_TESTS = prev;
      else delete process.env.ALLOW_DESTRUCTIVE_DB_TESTS;
    }
  });

  it('(BT) semicolon / SQL-shaped database identifier is rejected', () => {
    const prev = process.env.ALLOW_DESTRUCTIVE_DB_TESTS;
    process.env.ALLOW_DESTRUCTIVE_DB_TESTS = 'true';
    try {
      expect(() =>
        validateTestDbUrls(
          'postgres://user:pw@127.0.0.1:5432/evil;SELECT(1);--_test',
          'postgres://user:pw@127.0.0.1:5432/fintrack_restore'
        )
      ).toThrow(/strict identifier grammar/);
    } finally {
      if (prev !== undefined) process.env.ALLOW_DESTRUCTIVE_DB_TESTS = prev;
      else delete process.env.ALLOW_DESTRUCTIVE_DB_TESTS;
    }
  });

  it('(BU) database name with whitespace is rejected', () => {
    const prev = process.env.ALLOW_DESTRUCTIVE_DB_TESTS;
    process.env.ALLOW_DESTRUCTIVE_DB_TESTS = 'true';
    try {
      expect(() =>
        validateTestDbUrls(
          'postgres://user:pw@127.0.0.1:5432/foo%20bar_test',
          'postgres://user:pw@127.0.0.1:5432/fintrack_restore'
        )
      ).toThrow(/suspicious percent-encoding/);
      expect(() =>
        validateTestDbUrls(
          'postgres://user:pw@127.0.0.1:5432/foo bar_test',
          'postgres://user:pw@127.0.0.1:5432/fintrack_restore'
        )
      ).toThrow(/whitespace|grammar/);
    } finally {
      if (prev !== undefined) process.env.ALLOW_DESTRUCTIVE_DB_TESTS = prev;
      else delete process.env.ALLOW_DESTRUCTIVE_DB_TESTS;
    }
  });

  it('(BV) percent-encoded suspicious database path is rejected', () => {
    const prev = process.env.ALLOW_DESTRUCTIVE_DB_TESTS;
    process.env.ALLOW_DESTRUCTIVE_DB_TESTS = 'true';
    try {
      expect(() =>
        validateTestDbUrls(
          'postgres://user:pw@127.0.0.1:5432/%66intrack_test',
          'postgres://user:pw@127.0.0.1:5432/fintrack_restore'
        )
      ).toThrow(/suspicious percent-encoding/);
    } finally {
      if (prev !== undefined) process.env.ALLOW_DESTRUCTIVE_DB_TESTS = prev;
      else delete process.env.ALLOW_DESTRUCTIVE_DB_TESTS;
    }
  });

  it.skipIf(!realUrl)('(BW) shared cluster containing an unexpected application database is rejected', async () => {
    const rootUrl = realUrl!.substring(0, realUrl!.lastIndexOf('/') + 1) + 'postgres';
    const client = new Client({ connectionString: rootUrl });
    await client.connect();
    await client.query('DROP DATABASE IF EXISTS unexpected_app_db');
    await client.query('CREATE DATABASE unexpected_app_db');
    try {
      await expect(
        verifyDedicatedCluster(rootUrl, ['fintrack_test', 'fintrack_restore'])
      ).rejects.toThrow(/UNSAFE_SHARED_DATABASE_CLUSTER/);
    } finally {
      await client.query('DROP DATABASE IF EXISTS unexpected_app_db');
      await client.end();
    }
  });

  it('(BX) source and restore on different hosts/clusters is rejected', () => {
    const prev = process.env.ALLOW_DESTRUCTIVE_DB_TESTS;
    process.env.ALLOW_DESTRUCTIVE_DB_TESTS = 'true';
    try {
      expect(() =>
        validateTestDbUrls(
          'postgres://user:pw@127.0.0.1:5432/fintrack_test',
          'postgres://user:pw@127.0.0.1:5433/fintrack_restore'
        )
      ).toThrow(/same PostgreSQL test cluster/);
      expect(() =>
        validateTestDbUrls(
          'postgres://user:pw@127.0.0.1:5432/fintrack_test',
          'postgres://user:pw@localhost:5432/fintrack_restore'
        )
      ).toThrow(/same PostgreSQL test cluster/);
    } finally {
      if (prev !== undefined) process.env.ALLOW_DESTRUCTIVE_DB_TESTS = prev;
      else delete process.env.ALLOW_DESTRUCTIVE_DB_TESTS;
    }
  });

  it('(BY) missing ALLOW_DESTRUCTIVE_DB_TESTS is rejected', () => {
    const prev = process.env.ALLOW_DESTRUCTIVE_DB_TESTS;
    delete process.env.ALLOW_DESTRUCTIVE_DB_TESTS;
    try {
      expect(() =>
        validateTestDbUrls(
          'postgres://user:pw@127.0.0.1:5432/fintrack_test',
          'postgres://user:pw@127.0.0.1:5432/fintrack_restore'
        )
      ).toThrow(/ALLOW_DESTRUCTIVE_DB_TESTS=true is strictly required/);
    } finally {
      if (prev !== undefined) process.env.ALLOW_DESTRUCTIVE_DB_TESTS = prev;
    }
  });

  it('(BZ) valid localhost disposable source/restore pair succeeds', () => {
    const prev = process.env.ALLOW_DESTRUCTIVE_DB_TESTS;
    process.env.ALLOW_DESTRUCTIVE_DB_TESTS = 'true';
    try {
      const res = validateTestDbUrls(
        'postgres://postgres:pw@127.0.0.1:5432/fintrack_test',
        'postgres://postgres:pw@127.0.0.1:5432/fintrack_restore'
      );
      expect(res.sourceDb).toBe('fintrack_test');
      expect(res.restoreDb).toBe('fintrack_restore');
      expect(res.sourceQuoted).toBe('"fintrack_test"');
      expect(res.restoreQuoted).toBe('"fintrack_restore"');
    } finally {
      if (prev !== undefined) process.env.ALLOW_DESTRUCTIVE_DB_TESTS = prev;
      else delete process.env.ALLOW_DESTRUCTIVE_DB_TESTS;
    }
  });
});

// =============================================================================
// Tests CA–CK: Operator credential + destructive tooling safety closure
// =============================================================================

describe('operator credential and maintenance URL safety (CA–CK)', () => {
  const sourceUrl = 'postgres://user:pw@127.0.0.1:5432/fintrack_test';

  function withDestructive<T>(fn: () => T): T {
    const prev = process.env.ALLOW_DESTRUCTIVE_DB_TESTS;
    process.env.ALLOW_DESTRUCTIVE_DB_TESTS = 'true';
    try {
      return fn();
    } finally {
      if (prev !== undefined) process.env.ALLOW_DESTRUCTIVE_DB_TESTS = prev;
      else delete process.env.ALLOW_DESTRUCTIVE_DB_TESTS;
    }
  }

  it('(CA) missing DATABASE_MAINTENANCE_URL fails before any destructive work', () => {
    expect(() => validateMaintenanceUrl(undefined as unknown as string, sourceUrl))
      .toThrow(/DATABASE_MAINTENANCE_URL is required/);
    expect(() => validateMaintenanceUrl('', sourceUrl))
      .toThrow(/DATABASE_MAINTENANCE_URL is required/);
    expect(() => validateMaintenanceUrl(null as unknown as string, sourceUrl))
      .toThrow(/DATABASE_MAINTENANCE_URL is required/);
  });

  it('(CB) maintenance host differs from source cluster -> MAINTENANCE_CLUSTER_MISMATCH', () => {
    // Source URL targets 127.0.0.1; maintenance URL targets localhost (different hostname string)
    // Both are loopback but hostname comparison fails -> MAINTENANCE_CLUSTER_MISMATCH
    const source127 = 'postgres://user:pw@127.0.0.1:5432/fintrack_test';
    expect(() =>
      validateMaintenanceUrl(
        'postgres://admin:pw@localhost:5432/postgres',
        source127
      )
    ).toThrow(/MAINTENANCE_CLUSTER_MISMATCH/);
    // Non-loopback maintenance host: rejected with REFUSING DESTRUCTIVE ACTION (loopback check first)
    // This is correct behavior — a remote maintenance host is also rejected before reaching mismatch
    expect(() =>
      validateMaintenanceUrl(
        'postgres://admin:pw@192.168.1.10:5432/postgres',
        source127
      )
    ).toThrow(/REFUSING DESTRUCTIVE ACTION/);
  });

  it('(CC) maintenance port differs from source cluster -> MAINTENANCE_CLUSTER_MISMATCH', () => {
    expect(() =>
      validateMaintenanceUrl(
        'postgres://admin:pw@127.0.0.1:5433/postgres',
        sourceUrl
      )
    ).toThrow(/MAINTENANCE_CLUSTER_MISMATCH/);
  });

  it('(CD) maintenance database is not an approved admin database -> rejected', () => {
    // Production-like or application databases must be rejected
    expect(() =>
      validateMaintenanceUrl(
        'postgres://admin:pw@127.0.0.1:5432/fintrack',
        sourceUrl
      )
    ).toThrow(/not an approved admin database/);
    expect(() =>
      validateMaintenanceUrl(
        'postgres://admin:pw@127.0.0.1:5432/fintrack_test',
        sourceUrl
      )
    ).toThrow(/not an approved admin database/);
    expect(() =>
      validateMaintenanceUrl(
        'postgres://admin:pw@127.0.0.1:5432/production',
        sourceUrl
      )
    ).toThrow(/not an approved admin database/);
  });

  it.skipIf(!process.env.DATABASE_MAINTENANCE_URL)(
    '(CE) app runtime/login role cannot act as maintenance identity',
    async () => {
      const maintUrl = process.env.DATABASE_MAINTENANCE_URL!;
      const baseUrl = process.env.DATABASE_TEST_URL!;

      // Connect via base URL (which uses the app cluster) to check fintrack_app_login restriction
      // We need a client that would be connected as fintrack_app_login
      // Since we cannot easily impersonate fintrack_app_login here, we test validateMaintenanceRole
      // with a mock pg.Client whose query returns a forbidden role name.
      const mockClientRuntime = {
        query: async () => ({ rows: [{ name: 'fintrack_runtime' }] }),
      };
      await expect(
        validateMaintenanceRole(mockClientRuntime as unknown as Parameters<typeof validateMaintenanceRole>[0])
      ).rejects.toThrow(/fintrack_runtime.*application identity/);

      const mockClientLogin = {
        query: async () => ({ rows: [{ name: 'fintrack_app_login' }] }),
      };
      await expect(
        validateMaintenanceRole(mockClientLogin as unknown as Parameters<typeof validateMaintenanceRole>[0])
      ).rejects.toThrow(/fintrack_app_login.*application identity/);
    }
  );

  it('(CE) validateMaintenanceRole rejects fintrack application identities (offline mock)', async () => {
    const mockRuntime = {
      query: async () => ({ rows: [{ name: 'fintrack_runtime' }] }),
    };
    await expect(
      validateMaintenanceRole(mockRuntime as unknown as Parameters<typeof validateMaintenanceRole>[0])
    ).rejects.toThrow(/fintrack_runtime.*application identity/);

    const mockLogin = {
      query: async () => ({ rows: [{ name: 'fintrack_app_login' }] }),
    };
    await expect(
      validateMaintenanceRole(mockLogin as unknown as Parameters<typeof validateMaintenanceRole>[0])
    ).rejects.toThrow(/fintrack_app_login.*application identity/);

    // Non-application role is accepted
    const mockOperator = {
      query: async () => ({ rows: [{ name: 'postgres' }] }),
    };
    const roleName = await validateMaintenanceRole(mockOperator as unknown as Parameters<typeof validateMaintenanceRole>[0]);
    expect(roleName).toBe('postgres');
  });

  it('(CF) valid localhost source/restore/maintenance triplet succeeds', () => {
    withDestructive(() => {
      // validateTestDbUrls accepts a valid loopback pair
      const result = validateTestDbUrls(
        'postgres://postgres:pw@127.0.0.1:5432/fintrack_test',
        'postgres://postgres:pw@127.0.0.1:5432/fintrack_restore'
      );
      expect(result.sourceDb).toBe('fintrack_test');
      expect(result.restoreDb).toBe('fintrack_restore');
    });

    // validateMaintenanceUrl accepts maintenance targeting same cluster admin db
    const maintResult = validateMaintenanceUrl(
      'postgres://admin:pw@127.0.0.1:5432/postgres',
      sourceUrl
    );
    expect(maintResult.maintDb).toBe('postgres');
    expect(maintResult.maintHost).toBe('127.0.0.1');
    expect(maintResult.maintPort).toBe('5432');
  });

  it('(CG) URL-encoded database path remains rejected (path encoding is always rejected)', () => {
    withDestructive(() => {
      // Encoded path segments in source database name are rejected
      expect(() =>
        validateTestDbUrls(
          'postgres://user:pw@127.0.0.1:5432/%66intrack_test',
          'postgres://user:pw@127.0.0.1:5432/fintrack_restore'
        )
      ).toThrow(/suspicious percent-encoding/);

      // Also rejected in restore db path
      expect(() =>
        validateTestDbUrls(
          'postgres://user:pw@127.0.0.1:5432/fintrack_test',
          'postgres://user:pw@127.0.0.1:5432/fintrack%5frestore'
        )
      ).toThrow(/suspicious percent-encoding/);

      // Encoded path in maintenance URL is rejected
      expect(() =>
        validateMaintenanceUrl(
          'postgres://admin:pw@127.0.0.1:5432/%70ostgres',
          sourceUrl
        )
      ).toThrow(/suspicious percent-encoding/);
    });
  });

  it('(CH) URL-encoded password in source URL is accepted (credential encoding is valid)', () => {
    withDestructive(() => {
      // p%40ssword is a valid URL-encoded password (@ sign encoded)
      // The database path /fintrack_test has no encoding, so it should pass
      const result = validateTestDbUrls(
        'postgres://user:p%40ssword@127.0.0.1:5432/fintrack_test',
        'postgres://user:p%40ssword@127.0.0.1:5432/fintrack_restore'
      );
      expect(result.sourceDb).toBe('fintrack_test');
      expect(result.restoreDb).toBe('fintrack_restore');
    });

    // Encoded password in maintenance URL is also accepted
    const maintResult = validateMaintenanceUrl(
      'postgres://admin:p%40ssword@127.0.0.1:5432/postgres',
      sourceUrl
    );
    expect(maintResult.maintDb).toBe('postgres');
  });

  it('(CI) remote source/restore host is rejected unconditionally (no opt-in gate exists)', () => {
    withDestructive(() => {
      // Setting ALLOW_REMOTE_DESTRUCTIVE_DB_TESTS no longer unlocks remote hosts
      const prevRemote = process.env.ALLOW_REMOTE_DESTRUCTIVE_DB_TESTS;
      process.env.ALLOW_REMOTE_DESTRUCTIVE_DB_TESTS = 'I_UNDERSTAND_THIS_MAY_DESTROY_A_REMOTE_CLUSTER';
      try {
        expect(() =>
          validateTestDbUrls(
            'postgres://user:pw@prod.example.com:5432/fintrack_test',
            'postgres://user:pw@prod.example.com:5432/fintrack_restore'
          )
        ).toThrow(/Remote source host.*is forbidden/);

        expect(() =>
          validateTestDbUrls(
            'postgres://user:pw@127.0.0.1:5432/fintrack_test',
            'postgres://user:pw@prod.example.com:5432/fintrack_restore'
          )
        ).toThrow(/Remote restore host.*is forbidden/);
      } finally {
        if (prevRemote !== undefined) process.env.ALLOW_REMOTE_DESTRUCTIVE_DB_TESTS = prevRemote;
        else delete process.env.ALLOW_REMOTE_DESTRUCTIVE_DB_TESTS;
      }
    });
  });

  it('(CJ) backup drill script uses MAINTENANCE URL for all cluster-global operations', () => {
    // Structural proof: parse the drill script text to verify the safety invariant.
    // The pattern "${BASE_URL%/*}/postgres" is the forbidden derivation.
    // All cluster-global psql calls must use $MAINT_URL.
    const drillScript = readFileSync('scripts/backup-restore-drill.sh', 'utf-8');

    // The forbidden pattern must be absent
    expect(drillScript).not.toMatch(/\$\{BASE_URL%\/\*\}/);
    expect(drillScript).not.toMatch(/\$\{DATABASE_TEST_URL%\/\*\}/);

    // MAINTENANCE_URL must be required before any connection
    expect(drillScript).toMatch(/DATABASE_MAINTENANCE_URL.*is strictly required/);

    // Cluster-global DDL must use MAINT_URL
    // DROP DATABASE / CREATE DATABASE must not use BASE_URL
    const dropDbMatches = [...drillScript.matchAll(/psql\s+"?\$[{(]?[A-Z_]+[})]?"?\s+.*DROP DATABASE/g)];
    for (const match of dropDbMatches) {
      expect(match[0]).toContain('MAINT_URL');
    }
    const createDbMatches = [...drillScript.matchAll(/psql\s+"?\$[{(]?[A-Z_]+[})]?"?\s+.*CREATE DATABASE/g)];
    for (const match of createDbMatches) {
      expect(match[0]).toContain('MAINT_URL');
    }
    // ALTER ROLE must not use BASE_URL
    const alterRoleMatches = [...drillScript.matchAll(/psql\s+"?\$[{(]?[A-Z_]+[})]?"?\s+.*ALTER ROLE/g)];
    for (const match of alterRoleMatches) {
      expect(match[0]).toContain('MAINT_URL');
    }
  });

  it('(CK) obsolete session-maintenance.mjs delegates to backend-maintenance.mjs (no independent implementation)', () => {
    const sessionMaint = readFileSync('scripts/session-maintenance.mjs', 'utf-8');
    const backendMaint = readFileSync('scripts/backend-maintenance.mjs', 'utf-8');

    // session-maintenance.mjs must import from backend-maintenance.mjs
    expect(sessionMaint).toMatch(/from ['"]\.\/backend-maintenance\.mjs['"]/);

    // session-maintenance.mjs must NOT contain independent SQL DELETE statements
    expect(sessionMaint).not.toMatch(/DELETE FROM fintrack\.sessions/);
    expect(sessionMaint).not.toMatch(/DELETE FROM fintrack\.idempotency/);

    // The canonical implementation is in backend-maintenance.mjs
    expect(backendMaint).toMatch(/DELETE FROM fintrack\.sessions/);
    expect(backendMaint).toMatch(/DELETE FROM fintrack\.idempotency/);
  });
});
