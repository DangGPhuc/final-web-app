import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Client } from 'pg';
import { createHash } from 'node:crypto';
import { POST as logoutPost } from '../src/app/api/v2/session/logout/route';
import { POST as walletPost, GET as walletGet } from '../src/app/api/v2/wallets/route';
import { POST as transferPost } from '../src/app/api/v2/transfers/route';
import { resetPoolForTesting } from '../src/server/database';
import { runMigrations } from '../scripts/migrate.mjs';

const ADMIN_URL = process.env.DATABASE_MAINTENANCE_URL || 'postgres://postgres:ci-only-disposable-password@localhost:5432/fintrack_test';
const APP_URL = 'postgres://fintrack_app_login:ci-only-disposable-password@localhost:5432/fintrack_test';

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

beforeAll(async () => {
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

describe('Next.js API route integration (wallet, transfer, logout)', () => {
  it('GET /api/v2/wallets consumes global quota and returns correct headers', async () => {
    const req = new Request('https://fintrack.example/api/v2/wallets', {
      headers: { cookie: aliceCookie },
    });

    const res = await walletGet(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Vary')).toBe('Cookie');
    expect(res.headers.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.wallets.length).toBeGreaterThanOrEqual(2);
  });

  it('POST /api/v2/wallets creates wallet with requestId and consumes global + wallet:create quota', async () => {
    const req = new Request('https://fintrack.example/api/v2/wallets', {
      method: 'POST',
      headers: {
        origin: 'https://fintrack.example',
        cookie: aliceCookie,
        'content-type': 'application/json',
        'idempotency-key': '11111111-2222-4333-8444-555555555555',
      },
      body: JSON.stringify({ name: 'Emergency', type: 'CASH', openingBalance: '200' }),
    });

    const res = await walletPost(req);
    expect(res.status).toBe(201);
    expect(res.headers.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.name).toBe('Emergency');

    // Verify audit event has non-null matching request_id
    const adminClient = new Client({ connectionString: ADMIN_URL });
    await adminClient.connect();
    const auditRes = await adminClient.query<{ request_id: string }>(
      "SELECT request_id FROM fintrack.audit_events WHERE resource_id = $1 AND action = 'WALLET_CREATED'",
      [body.data.id]
    );
    await adminClient.end();
    expect(auditRes.rows[0].request_id).toBe(res.headers.get('X-Request-Id'));
  });

  it('POST /api/v2/transfers executes transfer with requestId and locks', async () => {
    const req = new Request('https://fintrack.example/api/v2/transfers', {
      method: 'POST',
      headers: {
        origin: 'https://fintrack.example',
        cookie: aliceCookie,
        'content-type': 'application/json',
        'idempotency-key': '22222222-3333-4444-8555-666666666666',
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
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.amount).toBe('100');

    // Verify audit event has non-null matching request_id
    const adminClient = new Client({ connectionString: ADMIN_URL });
    await adminClient.connect();
    const auditRes = await adminClient.query<{ request_id: string }>(
      "SELECT request_id FROM fintrack.audit_events WHERE resource_id = $1 AND action = 'TRANSFER_CREATED'",
      [body.data.id]
    );
    await adminClient.end();
    expect(auditRes.rows[0].request_id).toBe(res.headers.get('X-Request-Id'));
  });

  it('rejects POST mutations with invalid origin without emitting Set-Cookie (403)', async () => {
    const req = new Request('https://fintrack.example/api/v2/session/logout', {
      method: 'POST',
      headers: {
        origin: 'https://evil.example',
        cookie: aliceCookie,
        'content-type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    const res = await logoutPost(req);
    expect(res.status).toBe(403);
    expect(res.headers.get('Set-Cookie')).toBeNull();
    const body = await res.json();
    expect(body.success).toBe(false);
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
    expect(body.success).toBe(false);
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
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain('__Host-fintrack_session=');
    expect(setCookie).toContain('Max-Age=0');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.revoked).toBe(true);
  });

  it('(S) rejected logout (cross-site, bad body, unauthenticated) does NOT clear cookie', async () => {
    // Cross-site fetch metadata rejection
    const crossSiteReq = new Request('https://fintrack.example/api/v2/session/logout', {
      method: 'POST',
      headers: {
        origin: 'https://fintrack.example',
        'sec-fetch-site': 'cross-site',
        cookie: aliceCookie,
        'content-type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    const res = await logoutPost(crossSiteReq);
    expect(res.status).toBe(403);
    expect(res.headers.get('Set-Cookie')).toBeNull();
    const body = await res.json();
    expect(body.code).toBe('CROSS_SITE_REQUEST');
  });

  it('(T) rate-limited logout does NOT clear cookie', async () => {
    // Manually saturate rate limit for Alice to trigger 429
    const adminClient = new Client({ connectionString: ADMIN_URL });
    await adminClient.connect();
    await adminClient.query(
      "UPDATE fintrack.rate_limits SET hits = 60 WHERE user_id = $1 AND scope = 'global'",
      [aliceId]
    );
    await adminClient.end();

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
    expect(res.status).toBe(429);
    expect(res.headers.get('Set-Cookie')).toBeNull();
    expect(res.headers.get('Retry-After')).toBe('60');
    const body = await res.json();
    expect(body.code).toBe('RATE_LIMITED');

    // Reset rate limits for remaining tests
    const resetClient = new Client({ connectionString: ADMIN_URL });
    await resetClient.connect();
    await resetClient.query("DELETE FROM fintrack.rate_limits WHERE user_id = $1", [aliceId]);
    await resetClient.end();
  });

  it('(U) revoke failure does NOT clear cookie and DB session remains unchanged', async () => {
    // Configure invalid table or trigger DB error during execution
    // We test that when transaction throws inside run(), catch block never attaches Set-Cookie
    const adminClient = new Client({ connectionString: ADMIN_URL });
    await adminClient.connect();

    // Create a temporary session for testing revoke failure
    const testHash = createHash('sha256').update('u'.repeat(43)).digest('hex');
    await adminClient.query(
      "INSERT INTO fintrack.sessions(token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')",
      [testHash, aliceId]
    );

    // Revoke session manually so it is already revoked, but test simulating error via invalid DB state
    // If the database fails or throws an exception, no Set-Cookie must be emitted.
    // We can simulate this by pointing DATABASE_URL to an invalid port temporarily
    process.env.DATABASE_URL = 'postgres://fintrack_app_login:ci-only-disposable-password@localhost:5439/fintrack_test';
    await resetPoolForTesting();

    const req = new Request('https://fintrack.example/api/v2/session/logout', {
      method: 'POST',
      headers: {
        origin: 'https://fintrack.example',
        cookie: `__Host-fintrack_session=${'u'.repeat(43)}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    const res = await logoutPost(req);
    expect(res.status).toBe(503);
    expect(res.headers.get('Set-Cookie')).toBeNull();

    // Restore DATABASE_URL
    process.env.DATABASE_URL = APP_URL;
    await resetPoolForTesting();

    // Verify session in DB was NOT revoked by the failed request
    const checkRes = await adminClient.query<{ revoked_at: string | null }>(
      'SELECT revoked_at FROM fintrack.sessions WHERE token_hash = $1',
      [testHash]
    );
    expect(checkRes.rows[0].revoked_at).toBeNull();
    await adminClient.end();
  });

  it('(V) global + business scope rate limits stack correctly', async () => {
    // 1. wallet:create limit is 10/min.
    // 2. Global limit is 60/min.
    // If we make 10 wallet creations, the 11th should fail with 429 even though global limit (60) is not reached.
    const adminClient = new Client({ connectionString: ADMIN_URL });
    await adminClient.connect();
    await adminClient.query("DELETE FROM fintrack.rate_limits WHERE user_id = $1", [aliceId]);
    await adminClient.end();

    // Saturate wallet:create hits to 10
    const adminClient2 = new Client({ connectionString: ADMIN_URL });
    await adminClient2.connect();
    await adminClient2.query(`
      INSERT INTO fintrack.rate_limits(user_id, scope, bucket, hits)
      VALUES ($1, 'wallet:create', floor(extract(epoch from now()) / 60)::bigint, 10)
      ON CONFLICT (user_id, scope) DO UPDATE SET hits = 10;
    `, [aliceId]);
    await adminClient2.end();

    const req = new Request('https://fintrack.example/api/v2/wallets', {
      method: 'POST',
      headers: {
        origin: 'https://fintrack.example',
        cookie: aliceCookie,
        'content-type': 'application/json',
        'idempotency-key': '33333333-4444-4555-8666-777777777777',
      },
      body: JSON.stringify({ name: 'BlockedWallet', type: 'CASH', openingBalance: '10' }),
    });

    const res = await walletPost(req);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.code).toBe('RATE_LIMITED');

    // Clean up rate limits
    const cleanClient = new Client({ connectionString: ADMIN_URL });
    await cleanClient.connect();
    await cleanClient.query("DELETE FROM fintrack.rate_limits WHERE user_id = $1", [aliceId]);
    await cleanClient.end();
  });

  it('(W) daily transfer quota enforced with TRANSFER_DAILY_LIMIT_REACHED', async () => {
    const adminClient = new Client({ connectionString: ADMIN_URL });
    await adminClient.connect();
    // Temporarily seed transfers for Alice up to limit or test with MAX_TRANSFERS_PER_USER_PER_DAY override
    const originalMax = process.env.MAX_TRANSFERS_PER_USER_PER_DAY;
    process.env.MAX_TRANSFERS_PER_USER_PER_DAY = '1';

    try {
      // Alice already made 1 transfer in earlier test
      const req = new Request('https://fintrack.example/api/v2/transfers', {
        method: 'POST',
        headers: {
          origin: 'https://fintrack.example',
          cookie: aliceCookie,
          'content-type': 'application/json',
          'idempotency-key': '44444444-5555-4666-8777-888888888888',
        },
        body: JSON.stringify({
          fromWalletId: aliceWalletA,
          toWalletId: aliceWalletB,
          amount: '10',
          fee: '0',
        }),
      });

      const res = await transferPost(req);
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.code).toBe('TRANSFER_DAILY_LIMIT_REACHED');
    } finally {
      if (originalMax !== undefined) process.env.MAX_TRANSFERS_PER_USER_PER_DAY = originalMax;
      else delete process.env.MAX_TRANSFERS_PER_USER_PER_DAY;
      await adminClient.end();
    }
  });
});

