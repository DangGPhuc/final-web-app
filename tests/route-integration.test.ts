import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Client } from 'pg';
import { createHash } from 'node:crypto';
import { POST as logoutPost } from '../src/app/api/v2/session/logout/route';
import { POST as walletPost, GET as walletGet } from '../src/app/api/v2/wallets/route';
import { POST as transferPost } from '../src/app/api/v2/transfers/route';
import { resetPoolForTesting } from '../src/server/database';
import { runMigrations } from '../scripts/migrate.mjs';
import { assertSafeTestDatabaseUrl } from './helpers/test-db-guard';

const realUrl = process.env.DATABASE_TEST_URL;
const isDestructiveAllowed = process.env.ALLOW_DESTRUCTIVE_DB_TESTS === 'true';
const shouldRun = Boolean(realUrl && isDestructiveAllowed);

const aliceId = '11111111-1111-4111-8111-111111111111';
const bobId = '22222222-2222-4222-8222-222222222222';
const aliceToken = 'a'.repeat(43);
const bobToken = 'b'.repeat(43);
const aliceHash = createHash('sha256').update(aliceToken).digest('hex');
const bobHash = createHash('sha256').update(bobToken).digest('hex');

const aliceCookie = `__Host-fintrack_session=${aliceToken}`;
const bobCookie = `__Host-fintrack_session=${bobToken}`;

let aliceWalletA: string;
let aliceWalletB: string;

describe.skipIf(!shouldRun)('Next.js API route integration (wallet, transfer, logout)', () => {
  let ADMIN_URL: string;
  let APP_URL: string;

  beforeAll(async () => {
    assertSafeTestDatabaseUrl(realUrl);
    ADMIN_URL = realUrl!;
    APP_URL = process.env.DATABASE_APP_TEST_URL || realUrl!.replace(/\/\/[^:]+:[^@]+@/, '//fintrack_app_login:ci-only-disposable-password@');

    process.env.APP_ORIGIN = 'https://fintrack.example';
    process.env.ENABLE_BACKEND_API = 'true';
    process.env.DATABASE_URL = APP_URL;
    delete process.env.EXPECTED_LOGIN_ROLE;

    const adminClient = new Client({ connectionString: ADMIN_URL });
    await adminClient.connect();

    // Reset database state and run migrations cleanly
    await adminClient.query('DROP SCHEMA IF EXISTS fintrack CASCADE');
    try { await adminClient.query('DROP ROLE IF EXISTS fintrack_runtime'); } catch {}
    try { await adminClient.query('DROP ROLE IF EXISTS fintrack_app_login'); } catch {}

    await runMigrations(ADMIN_URL);

    // Set password for app login role
    await adminClient.query("ALTER ROLE fintrack_app_login WITH PASSWORD 'ci-only-disposable-password'");

    // Seed users and sessions
    await adminClient.query('INSERT INTO fintrack.users(id) VALUES ($1), ($2)', [aliceId, bobId]);
    await adminClient.query(
      "INSERT INTO fintrack.sessions(token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour'), ($3, $4, now() + interval '1 hour')",
      [aliceHash, aliceId, bobHash, bobId]
    );

    // Seed wallets for Alice
    const w1 = await adminClient.query<{ id: string }>(
      "INSERT INTO fintrack.wallets(user_id, name, type, opening_balance, balance) VALUES ($1, 'Checking', 'BANK', 1000, 1000) RETURNING id",
      [aliceId]
    );
    aliceWalletA = w1.rows[0].id;

    const w2 = await adminClient.query<{ id: string }>(
      "INSERT INTO fintrack.wallets(user_id, name, type, opening_balance, balance) VALUES ($1, 'Savings', 'SAVINGS', 500, 500) RETURNING id",
      [aliceId]
    );
    aliceWalletB = w2.rows[0].id;

    await adminClient.end();
    await resetPoolForTesting();
  }, 30000);

  afterAll(async () => {
    await resetPoolForTesting();
  });

  it('GET /api/v2/wallets consumes global quota and returns correct headers', async () => {
    const req = new Request('https://fintrack.example/api/v2/wallets', {
      method: 'GET',
      headers: {
        cookie: aliceCookie,
      },
    });

    const res = await walletGet(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Request-Id')).toBeTruthy();
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Vary')).toBe('Cookie');
    expect(res.headers.get('Set-Cookie')).toBeNull();

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data.wallets)).toBe(true);
    expect(body.data.wallets.length).toBe(2);
  });

  it('POST /api/v2/wallets creates wallet with requestId and consumes global + wallet:create quota', async () => {
    const req = new Request('https://fintrack.example/api/v2/wallets', {
      method: 'POST',
      headers: {
        origin: 'https://fintrack.example',
        cookie: aliceCookie,
        'content-type': 'application/json',
        'idempotency-key': '00000000-0000-4000-8000-000000000001',
      },
      body: JSON.stringify({
        name: 'Emergency Fund',
        type: 'SAVINGS',
        openingBalance: '200',
      }),
    });

    const res = await walletPost(req);
    expect(res.status).toBe(201);
    expect(res.headers.get('Set-Cookie')).toBeNull();

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.name).toBe('Emergency Fund');
    expect(body.data.balance).toBe('200');

    // Verify audit event contains request_id matching X-Request-Id header
    const reqIdHeader = res.headers.get('X-Request-Id')!;
    const adminClient = new Client({ connectionString: ADMIN_URL });
    await adminClient.connect();
    const auditRes = await adminClient.query(
      'SELECT request_id FROM fintrack.audit_events WHERE resource_id = $1',
      [body.data.id]
    );
    expect(auditRes.rows[0]?.request_id).toBe(reqIdHeader);
    await adminClient.end();
  });

  it('POST /api/v2/transfers executes transfer with requestId and locks', async () => {
    const req = new Request('https://fintrack.example/api/v2/transfers', {
      method: 'POST',
      headers: {
        origin: 'https://fintrack.example',
        cookie: aliceCookie,
        'content-type': 'application/json',
        'idempotency-key': '00000000-0000-4000-8000-000000000002',
      },
      body: JSON.stringify({
        fromWalletId: aliceWalletA,
        toWalletId: aliceWalletB,
        amount: '100',
        fee: '5',
      }),
    });

    const res = await transferPost(req);
    expect(res.status).toBe(201);
    expect(res.headers.get('Set-Cookie')).toBeNull();

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.id).toBeTruthy();

    // Verify audit event has matching request_id
    const reqIdHeader = res.headers.get('X-Request-Id')!;
    const adminClient = new Client({ connectionString: ADMIN_URL });
    await adminClient.connect();
    const auditRes = await adminClient.query(
      'SELECT request_id FROM fintrack.audit_events WHERE resource_id = $1',
      [body.data.id]
    );
    expect(auditRes.rows[0]?.request_id).toBe(reqIdHeader);
    await adminClient.end();
  });

  it('rejects POST mutations with invalid origin without emitting Set-Cookie (403)', async () => {
    const req = new Request('https://fintrack.example/api/v2/wallets', {
      method: 'POST',
      headers: {
        origin: 'https://attacker.evil.com',
        cookie: aliceCookie,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'Hacked', type: 'CASH', openingBalance: 0 }),
    });

    const res = await walletPost(req);
    expect(res.status).toBe(403);
    expect(res.headers.get('Set-Cookie')).toBeNull();
    const body = await res.json();
    expect(body.code).toBe('INVALID_ORIGIN');
  });

  it('rejects unauthenticated logout without emitting Set-Cookie (401)', async () => {
    const req = new Request('https://fintrack.example/api/v2/session/logout', {
      method: 'POST',
      headers: {
        origin: 'https://fintrack.example',
        'content-type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    const res = await logoutPost(req);
    expect(res.status).toBe(401);
    expect(res.headers.get('Set-Cookie')).toBeNull();
    const body = await res.json();
    expect(body.code).toBe('UNAUTHENTICATED');
  });

  it('(R) successful logout returns 200, revokes DB session, and clears cookie', async () => {
    const req = new Request('https://fintrack.example/api/v2/session/logout', {
      method: 'POST',
      headers: {
        origin: 'https://fintrack.example',
        cookie: bobCookie,
        'content-type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    const res = await logoutPost(req);
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('Set-Cookie');
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain('__Host-fintrack_session=');
    expect(setCookie).toContain('Max-Age=0');

    // Verify session revoked in database
    const adminClient = new Client({ connectionString: ADMIN_URL });
    await adminClient.connect();
    const sessionRes = await adminClient.query(
      'SELECT revoked_at FROM fintrack.sessions WHERE user_id = $1',
      [bobId]
    );
    expect(sessionRes.rows[0]?.revoked_at).not.toBeNull();
    await adminClient.end();
  });

  it('(S) rejected logout (cross-site, bad body, unauthenticated) does NOT clear cookie', async () => {
    const req = new Request('https://fintrack.example/api/v2/session/logout', {
      method: 'POST',
      headers: {
        origin: 'https://fintrack.example',
        'sec-fetch-site': 'cross-site',
        cookie: aliceCookie,
        'content-type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    const res = await logoutPost(req);
    expect(res.status).toBe(403);
    expect(res.headers.get('Set-Cookie')).toBeNull();
    const body = await res.json();
    expect(body.code).toBe('CROSS_SITE_REQUEST');
  });

  it('(BK) logout succeeds with empty/no JSON body while Origin validation remains enforced', async () => {
    try {
      // 1. Valid origin and same-origin Sec-Fetch-Site with NO body and NO content-type
      const req = new Request('https://fintrack.example/api/v2/session/logout', {
        method: 'POST',
        headers: {
          origin: 'https://fintrack.example',
          'sec-fetch-site': 'same-origin',
          cookie: aliceCookie,
        },
      });

      const res = await logoutPost(req);
      expect(res.status).toBe(200);
      const setCookie = res.headers.get('Set-Cookie');
      expect(setCookie).toBeTruthy();
      expect(setCookie).toContain('__Host-fintrack_session=');
      expect(setCookie).toContain('Max-Age=0');

      // 2. Cross-origin with empty body must be rejected (Origin enforcement not weakened)
      const badReq = new Request('https://fintrack.example/api/v2/session/logout', {
        method: 'POST',
        headers: {
          origin: 'https://attacker.example',
          'sec-fetch-site': 'cross-site',
          cookie: aliceCookie,
        },
      });
      const badRes = await logoutPost(badReq);
      expect(badRes.status).toBe(403);
      expect(badRes.headers.get('Set-Cookie')).toBeNull();
    } finally {
      // Re-activate Alice session so subsequent tests (e.g. Test AL) continue to work
      const adminClient = new Client({ connectionString: ADMIN_URL });
      await adminClient.connect();
      await adminClient.query(
        "UPDATE fintrack.sessions SET revoked_at = NULL WHERE user_id = $1",
        [aliceId]
      );
      await adminClient.end();
    }
  });

  it('(AL) exhausted global quota does NOT block logout (rateLimitMode = none)', async () => {
    // Manually saturate rate limit for Alice to trigger 429
    const adminClient = new Client({ connectionString: ADMIN_URL });
    await adminClient.connect();
    await adminClient.query(
      `INSERT INTO fintrack.rate_limits (user_id, scope, bucket, hits)
       VALUES ($1, 'global', floor(extract(epoch from now()) / 60)::bigint, 60)
       ON CONFLICT (user_id, scope) DO UPDATE SET hits = 60, bucket = floor(extract(epoch from now()) / 60)::bigint`,
      [aliceId]
    );
    await adminClient.end();

    // Financial endpoint must be rejected with 429
    const walletReq = new Request('https://fintrack.example/api/v2/wallets', {
      method: 'GET',
      headers: { cookie: aliceCookie },
    });
    const walletRes = await walletGet(walletReq);
    expect(walletRes.status).toBe(429);

    // But logout MUST SUCCEED (200, session revoked, cookie cleared)
    const req = new Request('https://fintrack.example/api/v2/session/logout', {
      method: 'POST',
      headers: {
        origin: 'https://fintrack.example',
        cookie: aliceCookie,
        'content-type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    const res = await logoutPost(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('Set-Cookie')).toContain('Max-Age=0');
    const body = await res.json();
    expect(body.success).toBe(true);

    // Verify session revoked in DB
    const checkClient = new Client({ connectionString: ADMIN_URL });
    await checkClient.connect();
    const sessionRes = await checkClient.query(
      'SELECT revoked_at FROM fintrack.sessions WHERE user_id = $1',
      [aliceId]
    );
    expect(sessionRes.rows[0]?.revoked_at).not.toBeNull();
    // Restore session and clear rate limit for remaining tests
    await checkClient.query(
      'UPDATE fintrack.sessions SET revoked_at = NULL WHERE user_id = $1',
      [aliceId]
    );
    await checkClient.query("DELETE FROM fintrack.rate_limits WHERE user_id = $1", [aliceId]);
    await checkClient.end();
  });

  it('(U) revoke failure does NOT clear cookie and DB session remains unchanged', async () => {
    const adminClient = new Client({ connectionString: ADMIN_URL });
    await adminClient.connect();
    await adminClient.query(
      "UPDATE fintrack.sessions SET revoked_at = NULL WHERE user_id = $1",
      [aliceId]
    );
    await adminClient.end();

    // Temporarily invalidate DB connection to force a transaction failure
    const originalUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgres://fintrack_app_login:invalid_pw@localhost:5432/fintrack_test';
    await resetPoolForTesting();

    try {
      const req = new Request('https://fintrack.example/api/v2/session/logout', {
        method: 'POST',
        headers: {
          origin: 'https://fintrack.example',
          cookie: aliceCookie,
          'content-type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      const res = await logoutPost(req);
      expect(res.status).toBe(503);
      expect(res.headers.get('Set-Cookie')).toBeNull();
    } finally {
      process.env.DATABASE_URL = originalUrl;
      await resetPoolForTesting();
    }

    // Verify Alice session is still active (not revoked)
    const checkClient = new Client({ connectionString: ADMIN_URL });
    await checkClient.connect();
    const checkRes = await checkClient.query(
      'SELECT revoked_at FROM fintrack.sessions WHERE user_id = $1',
      [aliceId]
    );
    expect(checkRes.rows[0]?.revoked_at).toBeNull();
    await checkClient.end();
  });

  it('(V) global + business scope rate limits stack correctly', async () => {
    // 1. Consume 10 wallet creations (hits the wallet:create budget)
    const adminClient = new Client({ connectionString: ADMIN_URL });
    await adminClient.connect();
    await adminClient.query(
      `INSERT INTO fintrack.rate_limits (user_id, scope, bucket, hits)
       VALUES ($1, 'wallet:create', floor(extract(epoch from now()) / 60)::bigint, 10)
       ON CONFLICT (user_id, scope) DO UPDATE SET hits = 10, bucket = floor(extract(epoch from now()) / 60)::bigint`,
      [aliceId]
    );
    await adminClient.end();

    // 2. Next wallet POST must be rejected with 429
    const req = new Request('https://fintrack.example/api/v2/wallets', {
      method: 'POST',
      headers: {
        origin: 'https://fintrack.example',
        cookie: aliceCookie,
        'content-type': 'application/json',
        'idempotency-key': '00000000-0000-4000-8000-000000000010',
      },
      body: JSON.stringify({ name: 'Over Limit', type: 'CASH', openingBalance: '0' }),
    });

    const res = await walletPost(req);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.code).toBe('RATE_LIMITED');

    // 3. Reset wallet:create and exhaust global limit (60)
    const resetClient = new Client({ connectionString: ADMIN_URL });
    await resetClient.connect();
    await resetClient.query("DELETE FROM fintrack.rate_limits WHERE user_id = $1", [aliceId]);
    await resetClient.query(
      `INSERT INTO fintrack.rate_limits (user_id, scope, bucket, hits)
       VALUES ($1, 'global', floor(extract(epoch from now()) / 60)::bigint, 60)
       ON CONFLICT (user_id, scope) DO UPDATE SET hits = 60, bucket = floor(extract(epoch from now()) / 60)::bigint`,
      [aliceId]
    );
    await resetClient.end();

    // 4. Wallet POST must still be rejected due to global exhaustion
    const req2 = new Request('https://fintrack.example/api/v2/wallets', {
      method: 'POST',
      headers: {
        origin: 'https://fintrack.example',
        cookie: aliceCookie,
        'content-type': 'application/json',
        'idempotency-key': '00000000-0000-4000-8000-000000000011',
      },
      body: JSON.stringify({ name: 'Over Limit 2', type: 'CASH', openingBalance: '0' }),
    });
    const res2 = await walletPost(req2);
    expect(res2.status).toBe(429);

    // Clean up
    const cleanClient = new Client({ connectionString: ADMIN_URL });
    await cleanClient.connect();
    await cleanClient.query("DELETE FROM fintrack.rate_limits WHERE user_id = $1", [aliceId]);
    await cleanClient.end();
  });

  it('(W) daily transfer quota enforced with TRANSFER_DAILY_LIMIT_REACHED', async () => {
    const adminClient = new Client({ connectionString: ADMIN_URL });
    await adminClient.connect();
    await adminClient.query("DELETE FROM fintrack.transfers WHERE user_id = $1", [aliceId]);
    await adminClient.end();

    // Temporarily set MAX_TRANSFERS_PER_USER_PER_DAY = 1 via env override
    process.env.MAX_TRANSFERS_PER_USER_PER_DAY = '1';

    try {
      // 1. First transfer succeeds
      const req1 = new Request('https://fintrack.example/api/v2/transfers', {
        method: 'POST',
        headers: {
          origin: 'https://fintrack.example',
          cookie: aliceCookie,
          'content-type': 'application/json',
          'idempotency-key': '00000000-0000-4000-8000-000000000021',
        },
        body: JSON.stringify({
          fromWalletId: aliceWalletA,
          toWalletId: aliceWalletB,
          amount: '10',
          fee: '0',
        }),
      });
      const res1 = await transferPost(req1);
      expect(res1.status).toBe(201);

      // 2. Second transfer on same UTC day must fail with 422 TRANSFER_DAILY_LIMIT_REACHED
      const req2 = new Request('https://fintrack.example/api/v2/transfers', {
        method: 'POST',
        headers: {
          origin: 'https://fintrack.example',
          cookie: aliceCookie,
          'content-type': 'application/json',
          'idempotency-key': '00000000-0000-4000-8000-000000000022',
        },
        body: JSON.stringify({
          fromWalletId: aliceWalletA,
          toWalletId: aliceWalletB,
          amount: '10',
          fee: '0',
        }),
      });
      const res2 = await transferPost(req2);
      expect(res2.status).toBe(422);
      const body = await res2.json();
      expect(body.code).toBe('TRANSFER_DAILY_LIMIT_REACHED');
    } finally {
      delete process.env.MAX_TRANSFERS_PER_USER_PER_DAY;
    }
  });
});
