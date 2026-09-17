import { describe, it, expect, afterEach, vi } from 'vitest';
import { money, parseWallet, parseTransfer, transferBalances } from '../src/server/domain';
import { checkMutationOrigin, sessionHash, clearSessionCookieHeader } from '../src/server/session';
import { readBoundedJsonBody, isDemoApiEnabled } from '../src/lib/api-guard';
import { logSecurityEvent } from '../src/server/logger';
import { POST as whatIfPost } from '../src/app/api/simulation/what-if/route';
import { GET as walletsGet, POST as walletsPost } from '../src/app/api/wallets/route';
import { GET as transactionsGet, POST as transactionsPost } from '../src/app/api/transactions/route';
import { GET as billsGet } from '../src/app/api/bills/route';
import { GET as budgetsGet } from '../src/app/api/budgets/route';
import { GET as goalsGet } from '../src/app/api/goals/route';
import { GET as summaryGet } from '../src/app/api/summary/route';

const id = '11111111-1111-4111-8111-111111111111';
const originalOrigin = process.env.APP_ORIGIN;
const originalNodeEnv = process.env.NODE_ENV;
const originalEnableDemo = process.env.ENABLE_DEMO_API;

afterEach(() => {
  if (originalOrigin === undefined) delete process.env.APP_ORIGIN;
  else process.env.APP_ORIGIN = originalOrigin;

  if (originalNodeEnv === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV;
  else (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv;

  if (originalEnableDemo === undefined) delete process.env.ENABLE_DEMO_API;
  else process.env.ENABLE_DEMO_API = originalEnableDemo;
});

describe('server trust boundary', () => {
  it('rejects imprecise numeric JSON, exponent/fraction/negative/oversized money', () => {
    for (const v of [1, '1.5', '1e3', '-1', '01', '9000000000000001', null]) {
      expect(() => money(v)).toThrow('INVALID_MONEY');
    }
    expect(money('9000000000000000')).toBe(9000000000000000n);
  });

  it('rejects mass-assignment and unsupported credit wallets', () => {
    expect(() => parseWallet({ name: 'Bank', type: 'BANK', openingBalance: '0', userId: id })).toThrow(
      'UNKNOWN_FIELD'
    );
    expect(() => parseWallet({ name: 'Card', type: 'CREDIT', openingBalance: '0' })).toThrow(
      'UNSUPPORTED_WALLET_TYPE'
    );
  });

  it('rejects self transfer and never rounds a balance', () => {
    expect(() => parseTransfer({ fromWalletId: id, toWalletId: id, amount: '1' })).toThrow('SAME_WALLET');
    expect(transferBalances('9000000000000000', '0', '1', '1')).toEqual({
      from: '8999999999999998',
      to: '1',
    });
    expect(() => transferBalances('1', '0', '1', '1')).toThrow('INSUFFICIENT_FUNDS');
    expect(() => transferBalances('10', '9000000000000000', '1', '0')).toThrow('BALANCE_LIMIT');
  });

  it('fails closed for absent, foreign, or same-site sibling origins', () => {
    process.env.APP_ORIGIN = 'https://fintrack.example';
    for (const o of [undefined, 'https://evil.example', 'https://sub.fintrack.example']) {
      expect(() =>
        checkMutationOrigin(
          new Request('https://fintrack.example/api/v2/wallets', {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...(o ? { origin: o } : {}) },
          })
        )
      ).toThrow('INVALID_ORIGIN');
    }
    expect(() =>
      checkMutationOrigin(
        new Request('https://fintrack.example', {
          method: 'POST',
          headers: {
            origin: 'https://fintrack.example',
            'content-type': 'application/json',
            'sec-fetch-site': 'same-origin',
          },
        })
      )
    ).not.toThrow();
  });

  it('rejects ambiguous cookies and never accepts user identity headers', () => {
    expect(() => sessionHash(new Request('https://test', { headers: { 'x-user-id': id } }))).toThrow(
      'UNAUTHENTICATED'
    );
    const cookie = '__Host-fintrack_session=' + 'a'.repeat(43);
    expect(sessionHash(new Request('https://test', { headers: { cookie } }))).toMatch(/^[a-f0-9]{64}$/);
    expect(() => sessionHash(new Request('https://test', { headers: { cookie: cookie + '; ' + cookie } }))).toThrow(
      'UNAUTHENTICATED'
    );
  });

  it('cancels oversized streams without buffering the remaining body', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        c.enqueue(new Uint8Array(1024));
      },
      cancel() {
        cancelled = true;
      },
    });
    const req = new Request('https://test', { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
    expect(await readBoundedJsonBody(req, 1500)).toMatchObject({ ok: false, status: 413 });
    expect(cancelled).toBe(true);
  });

  it('rejects invalid UTF-8 and counts multibyte bodies', async () => {
    expect(
      await readBoundedJsonBody(new Request('https://test', { method: 'POST', body: new Uint8Array([255]) }))
    ).toMatchObject({ status: 400 });
    expect(
      await readBoundedJsonBody(
        new Request('https://test', {
          method: 'POST',
          body: JSON.stringify({ a: 'ệ'.repeat(10) }),
        }),
        20
      )
    ).toMatchObject({ status: 413 });
  });

  it('clears session cookie correctly without setting Domain', () => {
    const cookieHeader = clearSessionCookieHeader();
    expect(cookieHeader).toContain('__Host-fintrack_session=');
    expect(cookieHeader).toContain('Path=/');
    expect(cookieHeader).toContain('Max-Age=0');
    expect(cookieHeader).toContain('HttpOnly');
    expect(cookieHeader).toContain('Secure');
    expect(cookieHeader).toContain('SameSite=Lax');
    expect(cookieHeader).not.toContain('Domain=');
  });
});

describe('legacy demo routes production shutdown policy (B, C, D)', () => {
  it('(B) legacy what-if POST disabled in production (returns 404)', async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    const req = new Request('https://fintrack.example/api/simulation/what-if', {
      method: 'POST',
      body: JSON.stringify({ reducePercent: 10 }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await whatIfPost(req);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body._code).toBe('LEGACY_DEMO_DISABLED');
  });

  it('(C) all legacy demo GET routes disabled in production (return 404)', async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    const req = new Request('https://fintrack.example/api/transactions');

    const responses = await Promise.all([
      walletsGet(),
      transactionsGet(req),
      billsGet(),
      budgetsGet(),
      goalsGet(),
      summaryGet(),
    ]);

    for (const res of responses) {
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data._code).toBe('LEGACY_DEMO_DISABLED');
    }
  });

  it('(D) ENABLE_DEMO_API=true CANNOT re-enable legacy API in production', async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    process.env.ENABLE_DEMO_API = 'true';

    expect(isDemoApiEnabled()).toBe(false);

    const postRes = await walletsPost(
      new Request('https://fintrack.example/api/wallets', {
        method: 'POST',
        body: JSON.stringify({ name: 'Demo', type: 'CASH', balance: 100 }),
        headers: { 'content-type': 'application/json' },
      })
    );
    expect(postRes.status).toBe(404);

    const getRes = await walletsGet();
    expect(getRes.status).toBe(404);

    const whatIfRes = await whatIfPost(
      new Request('https://fintrack.example/api/simulation/what-if', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'content-type': 'application/json' },
      })
    );
    expect(whatIfRes.status).toBe(404);
  });

  it('development/test may explicitly enable demo routes', async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
    process.env.ENABLE_DEMO_API = 'true';
    expect(isDemoApiEnabled()).toBe(true);

    const getRes = await walletsGet();
    expect(getRes.status).toBe(200);
    const data = await getRes.json();
    expect(data._demo).toBe(true);
  });
});

describe('structured security logging', () => {
  it('logs security events in safe JSON without leaking secrets', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      logSecurityEvent({
        event: 'SECURITY_RATE_LIMITED',
        requestId: '12345678-1234-4234-8234-123456789abc',
        errorCode: 'RATE_LIMITED',
        timestamp: '2026-09-18T00:00:00.000Z',
        userId: '11111111-1111-4111-8111-111111111111',
      });

      expect(warnSpy).toHaveBeenCalledTimes(1);
      const logged = JSON.parse(warnSpy.mock.calls[0][0]);
      expect(logged.event).toBe('SECURITY_RATE_LIMITED');
      expect(logged.requestId).toBe('12345678-1234-4234-8234-123456789abc');
      expect(logged.errorCode).toBe('RATE_LIMITED');
      expect(logged.userId).toBe('11111111-1111-4111-8111-111111111111');
      // Verify no sensitive keys exist
      expect(logged.cookie).toBeUndefined();
      expect(logged.token).toBeUndefined();
      expect(logged.hash).toBeUndefined();
      expect(logged.sql).toBeUndefined();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
