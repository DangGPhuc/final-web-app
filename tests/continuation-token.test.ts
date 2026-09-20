import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  signContinuationToken,
  verifyContinuationToken,
  ContinuationExpiredError,
  InvalidContinuationError,
} from '../src/lib/security/continuation-token';
import { setTestOwnerSecretKey } from '../src/lib/security/owner-auth';

const TEST_OWNER_KEY = Buffer.alloc(32, 9).toString('hex');

describe('Server-Authenticated Opaque Continuation Tokens', () => {
  beforeAll(() => {
    setTestOwnerSecretKey(TEST_OWNER_KEY);
  });

  afterAll(() => {
    setTestOwnerSecretKey(null);
  });

  it('signs and verifies a valid QUICK mode continuation token', () => {
    const token = signContinuationToken({
      mode: 'QUICK',
      gmailConnectionId: 'conn-abc-123',
      pageToken: 'page_token_xyz',
      lowerBoundEpoch: 1788195600,
      upperBoundEpoch: 1788199200,
    });

    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(2);

    const verified = verifyContinuationToken(token);
    expect(verified.version).toBe(1);
    expect(verified.mode).toBe('QUICK');
    expect(verified.gmailConnectionId).toBe('conn-abc-123');
    expect(verified.pageToken).toBe('page_token_xyz');
    if (verified.mode === 'QUICK') {
      expect(verified.lowerBoundEpoch).toBe(1788195600);
      expect(verified.upperBoundEpoch).toBe(1788199200);
    }
  });

  it('signs and verifies a valid HISTORICAL mode continuation token', () => {
    const token = signContinuationToken({
      mode: 'HISTORICAL',
      gmailConnectionId: 'conn-hist-456',
      pageToken: 'hist_token_001',
      fromDate: '2026-01-01',
      toDate: '2026-01-31',
    });

    const verified = verifyContinuationToken(token);
    expect(verified.version).toBe(1);
    expect(verified.mode).toBe('HISTORICAL');
    expect(verified.gmailConnectionId).toBe('conn-hist-456');
    expect(verified.pageToken).toBe('hist_token_001');
    if (verified.mode === 'HISTORICAL') {
      expect(verified.fromDate).toBe('2026-01-01');
      expect(verified.toDate).toBe('2026-01-31');
    }
  });

  it('rejects tampered payload', () => {
    const token = signContinuationToken({
      mode: 'QUICK',
      gmailConnectionId: 'conn-abc-123',
      pageToken: 'page_token_xyz',
      lowerBoundEpoch: 1788195600,
      upperBoundEpoch: 1788199200,
    });

    const [payloadB64, sig] = token.split('.');
    // Tamper with payload by changing base64 characters
    const tamperedPayload = payloadB64.slice(0, -2) + (payloadB64.slice(-2) === 'AA' ? 'BB' : 'AA');
    const tamperedToken = `${tamperedPayload}.${sig}`;

    expect(() => verifyContinuationToken(tamperedToken)).toThrow(InvalidContinuationError);
  });

  it('rejects tampered signature', () => {
    const token = signContinuationToken({
      mode: 'QUICK',
      gmailConnectionId: 'conn-abc-123',
      pageToken: 'page_token_xyz',
      lowerBoundEpoch: 1788195600,
      upperBoundEpoch: 1788199200,
    });

    const [payloadB64, sig] = token.split('.');
    const tamperedSig = sig.slice(0, -2) + (sig.slice(-2) === 'AA' ? 'BB' : 'AA');
    const tamperedToken = `${payloadB64}.${tamperedSig}`;

    expect(() => verifyContinuationToken(tamperedToken)).toThrow(InvalidContinuationError);
  });

  it('rejects expired continuation token with code continuation_expired', () => {
    // Expired immediately (-1 second TTL)
    const token = signContinuationToken(
      {
        mode: 'QUICK',
        gmailConnectionId: 'conn-abc-123',
        pageToken: 'page_token_xyz',
        lowerBoundEpoch: 1788195600,
        upperBoundEpoch: 1788199200,
      },
      -10 // expired 10s ago
    );

    try {
      verifyContinuationToken(token);
      expect.unreachable('Should have thrown ContinuationExpiredError');
    } catch (err) {
      expect(err).toBeInstanceOf(ContinuationExpiredError);
      expect((err as ContinuationExpiredError).code).toBe('continuation_expired');
    }
  });

  it('rejects invalid token formats', () => {
    expect(() => verifyContinuationToken('')).toThrow(InvalidContinuationError);
    expect(() => verifyContinuationToken('not-a-token')).toThrow(InvalidContinuationError);
    expect(() => verifyContinuationToken('a.b.c')).toThrow(InvalidContinuationError);
  });

  it('does not expose OWNER_SECRET_KEY or Gmail refresh tokens in continuation token', () => {
    const token = signContinuationToken({
      mode: 'QUICK',
      gmailConnectionId: 'conn-safe-1',
      pageToken: 'safe_page_token',
      lowerBoundEpoch: 1788195600,
      upperBoundEpoch: 1788199200,
    });

    expect(token).not.toContain(TEST_OWNER_KEY);
    const decoded = Buffer.from(token.split('.')[0], 'base64url').toString('utf-8');
    expect(decoded).not.toContain(TEST_OWNER_KEY);
    expect(decoded).not.toContain('refresh');
  });

  it('rejects invalid historical continuation calendar date', () => {
    // Construct a token with invalid calendar date
    const payload = {
      version: 1,
      mode: 'HISTORICAL',
      gmailConnectionId: 'conn-hist-456',
      pageToken: 'hist_token_001',
      fromDate: '2026-02-31', // impossible date
      toDate: '2026-03-15',
      exp: Math.floor(Date.now() / 1000) + 1800,
    };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const secret = Buffer.alloc(32, 9).toString('hex');
    const crypto = require('crypto');
    const key = crypto.createHmac('sha256', secret).update('gmail-continuation:v1').digest();
    const sig = crypto.createHmac('sha256', key).update(payloadB64).digest('base64url');
    const token = `${payloadB64}.${sig}`;

    expect(() => verifyContinuationToken(token)).toThrow(InvalidContinuationError);
  });

  it('rejects historical token with fromDate > toDate', () => {
    const payload = {
      version: 1,
      mode: 'HISTORICAL',
      gmailConnectionId: 'conn-hist-456',
      pageToken: 'hist_token_001',
      fromDate: '2026-03-31',
      toDate: '2026-03-01', // fromDate > toDate
      exp: Math.floor(Date.now() / 1000) + 1800,
    };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const secret = Buffer.alloc(32, 9).toString('hex');
    const crypto = require('crypto');
    const key = crypto.createHmac('sha256', secret).update('gmail-continuation:v1').digest();
    const sig = crypto.createHmac('sha256', key).update(payloadB64).digest('base64url');
    const token = `${payloadB64}.${sig}`;

    expect(() => verifyContinuationToken(token)).toThrow(InvalidContinuationError);
  });

  it('rejects historical token missing fromDate or toDate', () => {
    const payload = {
      version: 1,
      mode: 'HISTORICAL',
      gmailConnectionId: 'conn-hist-456',
      pageToken: 'hist_token_001',
      exp: Math.floor(Date.now() / 1000) + 1800,
    };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const secret = Buffer.alloc(32, 9).toString('hex');
    const crypto = require('crypto');
    const key = crypto.createHmac('sha256', secret).update('gmail-continuation:v1').digest();
    const sig = crypto.createHmac('sha256', key).update(payloadB64).digest('base64url');
    const token = `${payloadB64}.${sig}`;

    expect(() => verifyContinuationToken(token)).toThrow(InvalidContinuationError);
  });
});
