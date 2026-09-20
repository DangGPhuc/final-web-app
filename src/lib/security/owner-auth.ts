import { NextRequest, NextResponse } from 'next/server';

export const OWNER_COOKIE_NAME = 'cockpit_owner_session';
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 7 days

// In-memory rate limiting for owner secret verification (brute-force defense)
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_FAILED_ATTEMPTS = 5;

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const failedAttemptsMap = new Map<string, RateLimitEntry>();

let testOwnerSecretKey: string | null = null;

/**
 * For unit/integration testing only: explicitly set an ephemeral test owner secret key
 */
export function setTestOwnerSecretKey(key: string | null): void {
  testOwnerSecretKey = key;
}

const KNOWN_WEAK_SECRETS = new Set([
  'password',
  '12345678',
  '1234567890',
  'owner',
  'admin',
  'cockpit',
  'secret',
  'changeme',
]);

/**
 * Retrieve OWNER_SECRET_KEY. Must fail closed if not configured or too weak.
 * Requires at least 32 characters/bytes of key material.
 * Never logs or exposes secret material.
 */
export function getOwnerSecretKey(): string {
  const secret = testOwnerSecretKey || process.env.OWNER_SECRET_KEY;
  if (!secret || typeof secret !== 'string' || secret.trim() === '') {
    throw new Error('OWNER_SECRET_KEY is required and must be configured in environment.');
  }
  const trimmed = secret.trim();
  if (trimmed.length < 32 || KNOWN_WEAK_SECRETS.has(trimmed.toLowerCase())) {
    throw new Error('OWNER_SECRET_KEY does not meet minimum strength requirements (at least 32 characters/bytes required).');
  }
  return trimmed;
}

/**
 * Hash string to SHA-256 32-byte digest array using Web Crypto API
 */
async function sha256DigestBytes(str: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(str));
  return new Uint8Array(buf);
}

/**
 * Constant-time string comparison using fixed-length 32-byte SHA-256 digests.
 * Completely eliminates length-difference timing side channels.
 */
export async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const hashA = await sha256DigestBytes(a);
  const hashB = await sha256DigestBytes(b);
  let mismatch = 0;
  for (let i = 0; i < 32; i++) {
    mismatch |= hashA[i] ^ hashB[i];
  }
  return mismatch === 0;
}

/**
 * Check if an IP is currently rate limited
 */
export function isIpRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = failedAttemptsMap.get(ip);
  if (!entry) return false;
  if (now > entry.resetAt) {
    failedAttemptsMap.delete(ip);
    return false;
  }
  return entry.count >= MAX_FAILED_ATTEMPTS;
}

/**
 * Record a failed attempt for an IP
 */
export function recordFailedAttempt(ip: string): void {
  const now = Date.now();
  const entry = failedAttemptsMap.get(ip);
  if (!entry || now > entry.resetAt) {
    failedAttemptsMap.set(ip, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
  } else {
    entry.count += 1;
  }
}

/**
 * Clear failed attempts for an IP upon successful verification
 */
export function resetRateLimit(ip: string): void {
  failedAttemptsMap.delete(ip);
}

/**
 * Verify owner credential with rate limiting and constant-time comparison
 */
export async function verifyOwnerCredential(
  secretKey: string | undefined | null,
  ip: string
): Promise<{ success: boolean; rateLimited?: boolean; error?: string }> {
  if (isIpRateLimited(ip)) {
    return {
      success: false,
      rateLimited: true,
      error: 'Quá nhiều lần thử sai. Vui lòng thử lại sau 15 phút.',
    };
  }

  if (!secretKey || typeof secretKey !== 'string' || secretKey.trim() === '') {
    recordFailedAttempt(ip);
    return {
      success: false,
      error: 'Owner key không hợp lệ',
    };
  }

  let expectedSecret: string;
  try {
    expectedSecret = getOwnerSecretKey();
  } catch {
    return {
      success: false,
      error: 'Lỗi cấu hình hệ thống: OWNER_SECRET_KEY chưa được thiết lập.',
    };
  }

  const isValid = await constantTimeEqual(secretKey.trim(), expectedSecret);
  if (!isValid) {
    recordFailedAttempt(ip);
    return {
      success: false,
      error: 'Owner key không hợp lệ',
    };
  }

  resetRateLimit(ip);
  return { success: true };
}

/**
 * Generate HMAC-SHA256 signature using standard Web Crypto API (Edge-compatible)
 */
async function signPayload(payload: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Create owner session token: "<timestamp>:<signature>"
 */
export async function createOwnerSessionToken(): Promise<string> {
  const secret = getOwnerSecretKey();
  const timestamp = Date.now().toString();
  const signature = await signPayload(timestamp, secret);
  return `${timestamp}:${signature}`;
}

/**
 * Verify owner session token
 */
export async function verifyOwnerSessionToken(token?: string | null): Promise<boolean> {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split(':');
  if (parts.length !== 2) return false;

  const [timestampStr, signature] = parts;
  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp)) return false;

  // Check expiration (7 days)
  const age = (Date.now() - timestamp) / 1000;
  if (age < 0 || age > SESSION_MAX_AGE_SECONDS) return false;

  try {
    const secret = getOwnerSecretKey();
    const expectedSignature = await signPayload(timestampStr, secret);
    return await constantTimeEqual(signature, expectedSignature);
  } catch {
    return false;
  }
}

/**
 * Set HTTP-only secure owner session cookie on a response
 */
export async function setOwnerSessionCookie(response: NextResponse): Promise<void> {
  const token = await createOwnerSessionToken();
  response.cookies.set({
    name: OWNER_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

/**
 * Clear owner session cookie on a response
 */
export function clearOwnerSessionCookie(response: NextResponse): void {
  response.cookies.delete(OWNER_COOKIE_NAME);
}

/**
 * Verify request Origin/Referer for CSRF mitigation on state-changing requests.
 * In production: strictly requires valid same-origin Origin or Referer against exact APP_ORIGIN (scheme + host + port).
 */
export function verifyOriginAndReferer(req: NextRequest): boolean {
  const method = req.method.toUpperCase();
  // Safe read methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    return true;
  }

  const appOrigin = process.env.APP_ORIGIN?.trim();
  const origin = req.headers.get('origin');
  const referer = req.headers.get('referer');

  // In production, APP_ORIGIN is mandatory and mutations must match exact origin
  if (process.env.NODE_ENV === 'production') {
    if (!appOrigin) {
      // Missing APP_ORIGIN fails closed in production
      return false;
    }
    let canonicalOrigin: string;
    try {
      canonicalOrigin = new URL(appOrigin).origin;
    } catch {
      return false;
    }

    // Must have Origin or Referer
    if (!origin && !referer) {
      return false;
    }

    if (origin) {
      try {
        const parsedOrigin = new URL(origin).origin;
        return parsedOrigin === canonicalOrigin;
      } catch {
        return false;
      }
    }

    if (referer) {
      try {
        const parsedRefererOrigin = new URL(referer).origin;
        return parsedRefererOrigin === canonicalOrigin;
      } catch {
        return false;
      }
    }

    return false;
  }

  // Non-production (development, test)
  if (appOrigin) {
    try {
      const canonicalOrigin = new URL(appOrigin).origin;
      if (origin) {
        return new URL(origin).origin === canonicalOrigin;
      }
      if (referer) {
        return new URL(referer).origin === canonicalOrigin;
      }
    } catch {
      return false;
    }
  } else {
    // If APP_ORIGIN is not specified in non-production, check Host header if Origin/Referer present
    const host = req.headers.get('host');
    if (origin) {
      try {
        return new URL(origin).host === host;
      } catch {
        return false;
      }
    }
    if (referer) {
      try {
        return new URL(referer).host === host;
      } catch {
        return false;
      }
    }
  }

  // Non-production allows absent headers (e.g. automated test suites, CLI)
  return true;
}
