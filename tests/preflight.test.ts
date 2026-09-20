import { describe, it, expect } from 'vitest';
import { runPreflightChecks } from '../scripts/preflight-real-env.mjs';

describe('Phase 5 Real Environment Preflight Checks', () => {
  const createMockEnv = (overrides: Record<string, string | undefined> = {}) => {
    const base: Record<string, string | undefined> = {
      DATABASE_URL: 'postgresql://postgres:pass123@127.0.0.1:5432/personal_finance',
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

  it('passes completely when all required variables are validly configured', () => {
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
      DATABASE_URL: undefined,
      OWNER_SECRET_KEY: undefined,
      TOKEN_ENCRYPTION_KEY: undefined,
    });
    const result = runPreflightChecks(envGetter);

    expect(result.isAllConfigured).toBe(false);
    expect(result.missingCount).toBe(3);

    const db = result.results.find((r) => r.name === 'DATABASE_URL');
    const owner = result.results.find((r) => r.name === 'OWNER_SECRET_KEY');
    const token = result.results.find((r) => r.name === 'TOKEN_ENCRYPTION_KEY');

    expect(db?.status).toBe('missing');
    expect(owner?.status).toBe('missing');
    expect(token?.status).toBe('missing');
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

  it('rejects non-postgres DATABASE_URL or invalid URL syntax', () => {
    const mysqlResult = runPreflightChecks(
      createMockEnv({ DATABASE_URL: 'mysql://user:pass@localhost:3306/db' })
    );
    expect(mysqlResult.isAllConfigured).toBe(false);
    const item = mysqlResult.results.find((r) => r.name === 'DATABASE_URL');
    expect(item?.status).toBe('invalid');

    const malformedResult = runPreflightChecks(
      createMockEnv({ DATABASE_URL: 'not-a-url' })
    );
    const malformedItem = malformedResult.results.find((r) => r.name === 'DATABASE_URL');
    expect(malformedItem?.status).toBe('invalid');
  });

  it('flags ALLOW_DEMO_DATA=true or ALLOW_MOCK_OAUTH=true as invalid for real-environment readiness', () => {
    const demoResult = runPreflightChecks(
      createMockEnv({ ALLOW_DEMO_DATA: 'true' })
    );
    expect(demoResult.isAllConfigured).toBe(false);
    const demoItem = demoResult.results.find((r) => r.name === 'ALLOW_DEMO_DATA');
    expect(demoItem?.status).toBe('invalid');

    const mockResult = runPreflightChecks(
      createMockEnv({ ALLOW_MOCK_OAUTH: 'true' })
    );
    expect(mockResult.isAllConfigured).toBe(false);
    const mockItem = mockResult.results.find((r) => r.name === 'ALLOW_MOCK_OAUTH');
    expect(mockItem?.status).toBe('invalid');
  });

  it('flags placeholder values as invalid', () => {
    const placeholderResult = runPreflightChecks(
      createMockEnv({
        GOOGLE_CLIENT_ID: 'your-google-client-id.apps.googleusercontent.com',
        GOOGLE_CLIENT_SECRET: 'replace_with_client_secret',
      })
    );
    expect(placeholderResult.isAllConfigured).toBe(false);
    const clientIdItem = placeholderResult.results.find((r) => r.name === 'GOOGLE_CLIENT_ID');
    const secretItem = placeholderResult.results.find((r) => r.name === 'GOOGLE_CLIENT_SECRET');
    expect(clientIdItem?.status).toBe('invalid');
    expect(secretItem?.status).toBe('invalid');
  });

  it('flags GOOGLE_REDIRECT_URI mismatch with APP_ORIGIN', () => {
    const mismatchResult = runPreflightChecks(
      createMockEnv({
        APP_ORIGIN: 'http://localhost:3000',
        GOOGLE_REDIRECT_URI: 'https://other-domain.com/api/google/callback',
      })
    );
    expect(mismatchResult.isAllConfigured).toBe(false);
    const redirectItem = mismatchResult.results.find((r) => r.name === 'GOOGLE_REDIRECT_URI');
    expect(redirectItem?.status).toBe('invalid');
  });

  it('never leaks secret values in diagnostic detail messages', () => {
    const secretValue = 'super-secret-passphrase-0123456789abcdef';
    const envGetter = createMockEnv({
      OWNER_SECRET_KEY: secretValue,
    });
    const result = runPreflightChecks(envGetter);

    for (const r of result.results) {
      expect(r.detail).not.toContain(secretValue);
    }
  });
});
