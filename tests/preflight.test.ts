import { describe, it, expect } from 'vitest';
import { runPreflightChecks } from '../scripts/preflight-real-env.mjs';
import { parseBankNotification, type RawEmailData } from '../src/lib/email/bank-parsers';
import { buildBankSearchQuery } from '../src/lib/email/gmail-client';

describe('Phase 5 Real Environment Preflight Checks', () => {
  const createMockEnv = (overrides: Record<string, string | undefined> = {}) => {
    const base: Record<string, string | undefined> = {
      POSTGRES_USER: 'fintrack',
      POSTGRES_PASSWORD: 'secure_random_hex_password_24chars',
      POSTGRES_DB: 'personal_finance',
      POSTGRES_PORT: '5432',
      DATABASE_URL: 'postgresql://fintrack:secure_random_hex_password_24chars@127.0.0.1:5432/personal_finance',
      TOKEN_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      OWNER_SECRET_KEY: 'this-is-a-very-strong-owner-secret-key-meeting-requirements',
      APP_ORIGIN: 'http://localhost:3000',
      GOOGLE_CLIENT_ID: '1234567890-testclient.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'GOCSPX-real-secret-test-dummy',
      GOOGLE_REDIRECT_URI: 'http://localhost:3000/api/google/callback',
      ALLOW_DEMO_DATA: 'false',
      ALLOW_MOCK_OAUTH: 'false',
      NODE_ENV: 'test',
    };
    const merged = { ...base, ...overrides };
    return (key: string) => merged[key];
  };

  it('passes completely when all required variables are validly configured and aligned', () => {
    const envGetter = createMockEnv();
    const result = runPreflightChecks(envGetter);

    expect(result.isAllConfigured).toBe(true);
    expect(result.missingCount).toBe(0);
    expect(result.invalidCount).toBe(0);

    for (const r of result.results) {
      expect(r.status).toBe('configured');
    }
  });

  it('fails and reports missing if critical variables are absent', () => {
    const envGetter = createMockEnv({
      POSTGRES_USER: undefined,
      POSTGRES_PASSWORD: undefined,
      OWNER_SECRET_KEY: undefined,
      TOKEN_ENCRYPTION_KEY: undefined,
    });
    const result = runPreflightChecks(envGetter);

    expect(result.isAllConfigured).toBe(false);
    expect(result.missingCount).toBeGreaterThanOrEqual(3);

    const userItem = result.results.find((r) => r.name === 'POSTGRES_USER');
    const passItem = result.results.find((r) => r.name === 'POSTGRES_PASSWORD');
    const owner = result.results.find((r) => r.name === 'OWNER_SECRET_KEY');
    const token = result.results.find((r) => r.name === 'TOKEN_ENCRYPTION_KEY');

    expect(userItem?.status).toBe('missing');
    expect(passItem?.status).toBe('missing');
    expect(owner?.status).toBe('missing');
    expect(token?.status).toBe('missing');
  });

  it('rejects weak or default POSTGRES_PASSWORD (e.g. postgres, password, changeme)', () => {
    const weakPasswords = ['postgres', 'password', 'changeme', '123456', 'admin', 'short'];
    for (const weak of weakPasswords) {
      const result = runPreflightChecks(
        createMockEnv({
          POSTGRES_PASSWORD: weak,
          DATABASE_URL: `postgresql://fintrack:${weak}@127.0.0.1:5432/personal_finance`,
        })
      );
      const passItem = result.results.find((r) => r.name === 'POSTGRES_PASSWORD');
      expect(passItem?.status).toBe('invalid');
      expect(result.isAllConfigured).toBe(false);
    }
  });

  it('rejects DATABASE_URL and POSTGRES_PASSWORD mismatch', () => {
    const result = runPreflightChecks(
      createMockEnv({
        POSTGRES_PASSWORD: 'correct_password_hex_value_12345678',
        DATABASE_URL: 'postgresql://fintrack:mismatched_password_diff@127.0.0.1:5432/personal_finance',
      })
    );
    expect(result.isAllConfigured).toBe(false);
    const dbItem = result.results.find((r) => r.name === 'DATABASE_URL');
    expect(dbItem?.status).toBe('invalid');
    expect(dbItem?.detail).toBe('Password does not match POSTGRES_PASSWORD');
  });

  it('rejects DATABASE_URL and POSTGRES_USER mismatch', () => {
    const result = runPreflightChecks(
      createMockEnv({
        POSTGRES_USER: 'fintrack',
        DATABASE_URL: 'postgresql://otheruser:secure_random_hex_password_24chars@127.0.0.1:5432/personal_finance',
      })
    );
    expect(result.isAllConfigured).toBe(false);
    const dbItem = result.results.find((r) => r.name === 'DATABASE_URL');
    expect(dbItem?.status).toBe('invalid');
    expect(dbItem?.detail).toBe('Username does not match POSTGRES_USER');
  });

  it('rejects DATABASE_URL and POSTGRES_DB mismatch', () => {
    const result = runPreflightChecks(
      createMockEnv({
        POSTGRES_DB: 'personal_finance',
        DATABASE_URL: 'postgresql://fintrack:secure_random_hex_password_24chars@127.0.0.1:5432/wrong_database',
      })
    );
    expect(result.isAllConfigured).toBe(false);
    const dbItem = result.results.find((r) => r.name === 'DATABASE_URL');
    expect(dbItem?.status).toBe('invalid');
    expect(dbItem?.detail).toBe('Database name does not match POSTGRES_DB');
  });

  it('rejects DATABASE_URL and POSTGRES_PORT mismatch', () => {
    const result = runPreflightChecks(
      createMockEnv({
        POSTGRES_PORT: '5432',
        DATABASE_URL: 'postgresql://fintrack:secure_random_hex_password_24chars@127.0.0.1:5433/personal_finance',
      })
    );
    expect(result.isAllConfigured).toBe(false);
    const dbItem = result.results.find((r) => r.name === 'DATABASE_URL');
    expect(dbItem?.status).toBe('invalid');
    expect(dbItem?.detail).toBe('Port does not match POSTGRES_PORT');
  });

  it('rejects weak or short OWNER_SECRET_KEY as invalid', () => {
    // Short key (< 32 chars)
    const shortResult = runPreflightChecks(
      createMockEnv({ OWNER_SECRET_KEY: 'too-short-key' })
    );
    expect(shortResult.isAllConfigured).toBe(false);
    const shortItem = shortResult.results.find((r) => r.name === 'OWNER_SECRET_KEY');
    expect(shortItem?.status).toBe('invalid');

    // Known weak secret
    const weakResult = runPreflightChecks(
      createMockEnv({ OWNER_SECRET_KEY: 'password' })
    );
    const weakItem = weakResult.results.find((r) => r.name === 'OWNER_SECRET_KEY');
    expect(weakItem?.status).toBe('invalid');
  });

  it('rejects invalid TOKEN_ENCRYPTION_KEY length', () => {
    const invalidKeyResult = runPreflightChecks(
      createMockEnv({ TOKEN_ENCRYPTION_KEY: 'not-hex-and-not-32-bytes' })
    );
    expect(invalidKeyResult.isAllConfigured).toBe(false);
    const item = invalidKeyResult.results.find((r) => r.name === 'TOKEN_ENCRYPTION_KEY');
    expect(item?.status).toBe('invalid');
  });

  it('enforces exact origin matching between APP_ORIGIN and GOOGLE_REDIRECT_URI', () => {
    // Mismatched origin (port differs)
    const mismatchPort = runPreflightChecks(
      createMockEnv({
        APP_ORIGIN: 'http://localhost:3000',
        GOOGLE_REDIRECT_URI: 'http://localhost:8080/api/google/callback',
      })
    );
    expect(mismatchPort.isAllConfigured).toBe(false);
    const portItem = mismatchPort.results.find((r) => r.name === 'GOOGLE_REDIRECT_URI');
    expect(portItem?.status).toBe('invalid');
    expect(portItem?.detail).toBe('Origin does not exactly match APP_ORIGIN');

    // Mismatched path
    const mismatchPath = runPreflightChecks(
      createMockEnv({
        APP_ORIGIN: 'http://localhost:3000',
        GOOGLE_REDIRECT_URI: 'http://localhost:3000/api/auth/callback',
      })
    );
    expect(mismatchPath.isAllConfigured).toBe(false);
    const pathItem = mismatchPath.results.find((r) => r.name === 'GOOGLE_REDIRECT_URI');
    expect(pathItem?.status).toBe('invalid');
    expect(pathItem?.detail).toBe('Pathname must be exactly /api/google/callback');
  });

  describe('APP_ORIGIN Canonical Validation', () => {
    it('accepts valid canonical http://localhost:3000', () => {
      const result = runPreflightChecks(
        createMockEnv({
          APP_ORIGIN: 'http://localhost:3000',
          GOOGLE_REDIRECT_URI: 'http://localhost:3000/api/google/callback',
        })
      );
      const appItem = result.results.find((r) => r.name === 'APP_ORIGIN');
      expect(appItem?.status).toBe('configured');
    });

    it('rejects APP_ORIGIN with /path', () => {
      const result = runPreflightChecks(
        createMockEnv({
          APP_ORIGIN: 'http://localhost:3000/subpath',
        })
      );
      expect(result.isAllConfigured).toBe(false);
      const appItem = result.results.find((r) => r.name === 'APP_ORIGIN');
      expect(appItem?.status).toBe('invalid');
      expect(appItem?.detail).toContain('path segments');
    });

    it('rejects APP_ORIGIN with query', () => {
      const result = runPreflightChecks(
        createMockEnv({
          APP_ORIGIN: 'http://localhost:3000?foo=bar',
        })
      );
      expect(result.isAllConfigured).toBe(false);
      const appItem = result.results.find((r) => r.name === 'APP_ORIGIN');
      expect(appItem?.status).toBe('invalid');
      expect(appItem?.detail).toContain('query string');
    });

    it('rejects APP_ORIGIN with fragment', () => {
      const result = runPreflightChecks(
        createMockEnv({
          APP_ORIGIN: 'http://localhost:3000#section',
        })
      );
      expect(result.isAllConfigured).toBe(false);
      const appItem = result.results.find((r) => r.name === 'APP_ORIGIN');
      expect(appItem?.status).toBe('invalid');
      expect(appItem?.detail).toContain('URL fragment');
    });

    it('rejects APP_ORIGIN with username/password credentials', () => {
      const result = runPreflightChecks(
        createMockEnv({
          APP_ORIGIN: 'http://admin:secret@localhost:3000',
        })
      );
      expect(result.isAllConfigured).toBe(false);
      const appItem = result.results.find((r) => r.name === 'APP_ORIGIN');
      expect(appItem?.status).toBe('invalid');
      expect(appItem?.detail).toContain('credentials');
    });
  });

  it('never leaks secret values in diagnostic detail messages', () => {
    const secretValue = 'super-secret-passphrase-0123456789abcdef';
    const dbPassword = 'database-secret-password-xyz-987';
    const envGetter = createMockEnv({
      OWNER_SECRET_KEY: secretValue,
      POSTGRES_PASSWORD: dbPassword,
      DATABASE_URL: `postgresql://fintrack:mismatched_pw@127.0.0.1:5432/personal_finance`,
    });
    const result = runPreflightChecks(envGetter);

    for (const r of result.results) {
      expect(r.detail).not.toContain(secretValue);
      expect(r.detail).not.toContain(dbPassword);
    }
  });

  describe('Documented Synthetic Bank Fixtures Compatibility', () => {
    it('exact documented VCB forwarded IN fixture parses correctly as VCB / IN with timestamp and ref', () => {
      const raw: RawEmailData = {
        id: 'msg-doc-vcb-in',
        from: 'my-test-forwarder@gmail.com',
        subject: 'Fwd: Vietcombank - biến động số dư',
        snippet: 'VCB: TK ••••1234 | GD: +5,000,000 VND | 15/09/2026 10:30:00 | Mã GD: VCB262580001 | Luong thang 09',
        bodyText: 'VCB: TK ••••1234 | GD: +5,000,000 VND | 15/09/2026 10:30:00 | Mã GD: VCB262580001 | Luong thang 09',
        date: '2026-09-15T03:30:00.000Z',
        internalDate: '1789443000000',
      };

      // 1. Verify compatibility with buildBankSearchQuery()
      const query = buildBankSearchQuery();
      expect(query).toContain('Fwd:');
      expect(query).toContain('vietcombank');
      expect(query).toContain('biến động');

      // 2. Verify parsing behavior
      const event = parseBankNotification(raw);
      expect(event).not.toBeNull();
      expect(event?.bankCode).toBe('VCB');
      expect(event?.bankName).toBe('Vietcombank');
      expect(event?.direction).toBe('IN');
      expect(event?.amount).toBe(5000000);
      expect(event?.currency).toBe('VND');
      expect(event?.bankRefId).toBe('VCB262580001');

      // 15/09/2026 10:30:00 ICT is 2026-09-15T03:30:00Z UTC
      expect(event?.occurredAt.toISOString()).toBe('2026-09-15T03:30:00.000Z');
      expect(event?.fingerprint).toBeDefined();
    });

    it('exact documented VCB forwarded OUT fixture parses correctly as VCB / OUT with timestamp and ref', () => {
      const raw: RawEmailData = {
        id: 'msg-doc-vcb-out',
        from: 'my-test-forwarder@gmail.com',
        subject: 'Fwd: Vietcombank - biến động số dư',
        snippet: 'VCB: TK ••••1234 | GD: -1,200,000 VND | 16/09/2026 14:15:20 | Mã GD: VCB262590002 | Thanh toan hoa don',
        bodyText: 'VCB: TK ••••1234 | GD: -1,200,000 VND | 16/09/2026 14:15:20 | Mã GD: VCB262590002 | Thanh toan hoa don',
        date: '2026-09-16T07:15:20.000Z',
        internalDate: '1789542920000',
      };

      const event = parseBankNotification(raw);
      expect(event).not.toBeNull();
      expect(event?.bankCode).toBe('VCB');
      expect(event?.direction).toBe('OUT');
      expect(event?.amount).toBe(1200000);
      expect(event?.currency).toBe('VND');
      expect(event?.bankRefId).toBe('VCB262590002');
      // 16/09/2026 14:15:20 ICT is 2026-09-16T07:15:20Z UTC
      expect(event?.occurredAt.toISOString()).toBe('2026-09-16T07:15:20.000Z');
    });

    it('exact documented TCB forwarded fixture parses as TCB (not GENERIC) with merchant hint and FT ref', () => {
      const raw: RawEmailData = {
        id: 'msg-doc-tcb-out',
        from: 'my-test-forwarder@gmail.com',
        subject: 'Fwd: Techcombank - biến động số dư',
        snippet: 'Techcombank: So tien ghi no: 350,000 VND luc 17/09/2026 09:05:00. Ma GD: FT2626011234. Dien giai: Highlands Coffee.',
        bodyText: 'Techcombank: So tien ghi no: 350,000 VND luc 17/09/2026 09:05:00. Ma GD: FT2626011234. Dien giai: Highlands Coffee.',
        date: '2026-09-17T02:05:00.000Z',
        internalDate: '1789610700000',
      };

      const event = parseBankNotification(raw);
      expect(event).not.toBeNull();
      expect(event?.bankCode).toBe('TCB');
      expect(event?.bankName).toBe('Techcombank');
      expect(event?.direction).toBe('OUT');
      expect(event?.amount).toBe(350000);
      expect(event?.currency).toBe('VND');
      expect(event?.bankRefId).toBe('FT2626011234');
      expect(event?.merchantLabel).toBe('Highlands Coffee');
      // 17/09/2026 09:05:00 ICT is 2026-09-17T02:05:00Z UTC
      expect(event?.occurredAt.toISOString()).toBe('2026-09-17T02:05:00.000Z');
    });

    it('produces identical financial fingerprints for forwarded duplicate messages', () => {
      const rawFirst: RawEmailData = {
        id: 'msg-first-fwd',
        from: 'my-test-forwarder@gmail.com',
        subject: 'Fwd: Vietcombank - biến động số dư',
        snippet: 'VCB: TK ••••1234 | GD: +5,000,000 VND | 15/09/2026 10:30:00 | Mã GD: VCB262580001 | Luong thang 09',
        bodyText: 'VCB: TK ••••1234 | GD: +5,000,000 VND | 15/09/2026 10:30:00 | Mã GD: VCB262580001 | Luong thang 09',
        date: '2026-09-15T03:30:00.000Z',
      };

      const rawSecondDuplicate: RawEmailData = {
        id: 'msg-second-fwd-different-gmail-id',
        from: 'another-test-forwarder@gmail.com',
        subject: 'Fwd: Vietcombank - biến động số dư (Forwarded again)',
        snippet: 'VCB: TK ••••1234 | GD: +5,000,000 VND | 15/09/2026 10:30:00 | Mã GD: VCB262580001 | Luong thang 09',
        bodyText: 'VCB: TK ••••1234 | GD: +5,000,000 VND | 15/09/2026 10:30:00 | Mã GD: VCB262580001 | Luong thang 09',
        date: '2026-09-18T10:00:00.000Z', // Different receive date
      };

      const event1 = parseBankNotification(rawFirst);
      const event2 = parseBankNotification(rawSecondDuplicate);

      expect(event1).not.toBeNull();
      expect(event2).not.toBeNull();
      expect(event1?.bankRefId).toBe(event2?.bankRefId);
      expect(event1?.fingerprint).toBe(event2?.fingerprint);
    });
  });
});
