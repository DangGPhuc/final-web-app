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

/**
 * Retrieve OWNER_SECRET_KEY. Must fail closed if not configured.
 * Never logs or exposes secret material.
 */
export function getOwnerSecretKey(): string {
  const secret = testOwnerSecretKey || process.env.OWNER_SECRET_KEY;
  if (!secret || typeof secret !== 'string' || secret.trim() === '') {
    throw new Error('OWNER_SECRET_KEY is required and must be configured in environment.');
  }
  return secret.trim();
}

/**
 * Constant-time string comparison to prevent timing attacks
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) {
    let dummy = 0;
    for (let i = 0; i < a.length; i++) {
      dummy |= a.charCodeAt(i) ^ 0;
    }
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
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
export function verifyOwnerCredential(
  secretKey: string | undefined | null,
  ip: string
): { success: boolean; rateLimited?: boolean; error?: string } {
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

  const isValid = constantTimeEqual(secretKey.trim(), expectedSecret);
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
    return constantTimeEqual(signature, expectedSignature);
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
 * In production: strictly requires valid same-origin Origin or Referer against APP_ORIGIN / Host.
 */
export function verifyOriginAndReferer(req: NextRequest): boolean {
  const method = req.method.toUpperCase();
  // Safe read methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    return true;
  }

  const appOrigin = process.env.APP_ORIGIN?.trim();
  const host = req.headers.get('host');
  const origin = req.headers.get('origin');
  const referer = req.headers.get('referer');

  // In production, require either valid Origin or Referer
  if (process.env.NODE_ENV === 'production') {
    if (!origin && !referer) {
      return false;
    }
  }

  // Check Origin if provided
  if (origin) {
    try {
      const originHost = new URL(origin).host;
      if (appOrigin) {
        const canonicalHost = new URL(appOrigin).host;
        return originHost === canonicalHost;
      }
      return !!host && originHost === host;
    } catch {
      return false;
    }
  }

  // Check Referer if Origin is absent
  if (referer) {
    try {
      const refererHost = new URL(referer).host;
      if (appOrigin) {
        const canonicalHost = new URL(appOrigin).host;
        return refererHost === canonicalHost;
      }
      return !!host && refererHost === host;
    } catch {
      return false;
    }
  }

  // In non-production (dev/test), permit if neither is set (e.g. CLI / automated test suites)
  return process.env.NODE_ENV !== 'production';
}
