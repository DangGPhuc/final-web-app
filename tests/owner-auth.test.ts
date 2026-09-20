import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import {
  getOwnerSecretKey,
  setTestOwnerSecretKey,
  constantTimeEqual,
  isIpRateLimited,
  recordFailedAttempt,
  resetRateLimit,
  verifyOwnerCredential,
  verifyOriginAndReferer,
  createOwnerSessionToken,
  verifyOwnerSessionToken,
} from '@/lib/security/owner-auth';

describe('Single-Owner Access Boundary & Security Hardening', () => {
  const TEST_KEY = 'test-secret-key-owner-32bytes-hex-val';

  beforeEach(() => {
    setTestOwnerSecretKey(TEST_KEY);
    resetRateLimit('127.0.0.1');
    resetRateLimit('192.168.1.100');
  });

  afterEach(() => {
    setTestOwnerSecretKey(null);
  });

  describe('Configuration & Fail-Closed Behavior', () => {
    it('returns configured owner secret key', () => {
      expect(getOwnerSecretKey()).toBe(TEST_KEY);
    });

    it('fails closed when OWNER_SECRET_KEY is missing outside test key injection', () => {
      setTestOwnerSecretKey(null);
      const originalEnv = process.env.OWNER_SECRET_KEY;
      delete process.env.OWNER_SECRET_KEY;

      try {
        expect(() => getOwnerSecretKey()).toThrow(
          'OWNER_SECRET_KEY is required and must be configured in environment.'
        );
      } finally {
        if (originalEnv) process.env.OWNER_SECRET_KEY = originalEnv;
      }
    });

    it('rejects empty or whitespace-only secret keys', () => {
      setTestOwnerSecretKey('   ');
      expect(() => getOwnerSecretKey()).toThrow(
        'OWNER_SECRET_KEY is required and must be configured in environment.'
      );
    });
  });

  describe('Constant-Time Secret Comparison', () => {
    it('returns true for exact matching secrets', () => {
      expect(constantTimeEqual('secret-12345', 'secret-12345')).toBe(true);
    });

    it('returns false for mismatched secrets', () => {
      expect(constantTimeEqual('secret-12345', 'secret-12346')).toBe(false);
    });

    it('returns false for secrets of different lengths without throwing', () => {
      expect(constantTimeEqual('short', 'much-longer-secret')).toBe(false);
      expect(constantTimeEqual('', 'secret')).toBe(false);
    });
  });

  describe('Owner Credential Verification & Rate Limiting', () => {
    it('accepts correct owner secret key and resets rate limit', () => {
      const result = verifyOwnerCredential(TEST_KEY, '127.0.0.1');
      expect(result.success).toBe(true);
      expect(isIpRateLimited('127.0.0.1')).toBe(false);
    });

    it('rejects invalid owner secret key with generic message', () => {
      const result = verifyOwnerCredential('wrong-password', '127.0.0.1');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Owner key không hợp lệ');
    });

    it('rejects empty secret key', () => {
      const result = verifyOwnerCredential('', '127.0.0.1');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Owner key không hợp lệ');
    });

    it('enforces rate limiting after 5 consecutive failed attempts', () => {
      const ip = '192.168.1.100';
      for (let i = 0; i < 5; i++) {
        const res = verifyOwnerCredential('wrong-key', ip);
        expect(res.success).toBe(false);
      }

      expect(isIpRateLimited(ip)).toBe(true);

      // 6th attempt should be blocked by rate limiter immediately
      const blockedRes = verifyOwnerCredential('wrong-key', ip);
      expect(blockedRes.success).toBe(false);
      expect(blockedRes.rateLimited).toBe(true);
      expect(blockedRes.error).toContain('Quá nhiều lần thử sai');
    });

    it('resets rate limit upon successful verification', () => {
      const ip = '192.168.1.100';
      recordFailedAttempt(ip);
      recordFailedAttempt(ip);

      const successRes = verifyOwnerCredential(TEST_KEY, ip);
      expect(successRes.success).toBe(true);
      expect(isIpRateLimited(ip)).toBe(false);
    });
  });

  describe('HMAC Owner Session Token Generation and Validation', () => {
    it('generates a valid session token that verifies successfully', async () => {
      const token = await createOwnerSessionToken();
      expect(typeof token).toBe('string');
      expect(token).toContain(':');
      expect(await verifyOwnerSessionToken(token)).toBe(true);
    });

    it('rejects tampered tokens', async () => {
      const token = await createOwnerSessionToken();
      const [ts, sig] = token.split(':');
      const tampered = `${ts}:${sig.slice(0, -4)}abcd`;
      expect(await verifyOwnerSessionToken(tampered)).toBe(false);
    });
  });

  describe('Origin and Referer CSRF Mitigation', () => {
    const originalEnv = process.env.NODE_ENV;
    const originalAppOrigin = process.env.APP_ORIGIN;

    afterEach(() => {
      (process.env as Record<string, string | undefined>).NODE_ENV = originalEnv;
      process.env.APP_ORIGIN = originalAppOrigin;
    });

    it('allows safe read methods (GET, HEAD, OPTIONS) without origin checks', () => {
      const req = new NextRequest('http://localhost:3000/api/transactions', {
        method: 'GET',
      });
      expect(verifyOriginAndReferer(req)).toBe(true);
    });

    it('accepts matching same-origin POST requests in production', () => {
      (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
      process.env.APP_ORIGIN = 'https://finance.example.com';

      const req = new NextRequest('https://finance.example.com/api/data/clear-financial', {
        method: 'POST',
        headers: {
          host: 'finance.example.com',
          origin: 'https://finance.example.com',
        },
      });

      expect(verifyOriginAndReferer(req)).toBe(true);
    });

    it('rejects cross-origin mutations in production', () => {
      (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
      process.env.APP_ORIGIN = 'https://finance.example.com';

      const req = new NextRequest('https://finance.example.com/api/data/clear-financial', {
        method: 'POST',
        headers: {
          host: 'finance.example.com',
          origin: 'https://evil-attacker.com',
        },
      });

      expect(verifyOriginAndReferer(req)).toBe(false);
    });

    it('rejects mutations with missing Origin and Referer in production', () => {
      (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
      process.env.APP_ORIGIN = 'https://finance.example.com';

      const req = new NextRequest('https://finance.example.com/api/data/factory-reset', {
        method: 'POST',
        headers: {
          host: 'finance.example.com',
        },
      });

      expect(verifyOriginAndReferer(req)).toBe(false);
    });
  });
});
