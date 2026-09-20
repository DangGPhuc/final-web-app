import { NextRequest, NextResponse } from 'next/server';

export const OWNER_COOKIE_NAME = 'cockpit_owner_session';
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 7 days

export function getOwnerSecretKey(): string {
  const secret = process.env.OWNER_SECRET_KEY;
  if (secret && secret.trim() !== '') {
    return secret.trim();
  }
  // In non-production only, provide fallback for local development / final-project classroom demo
  if (process.env.NODE_ENV !== 'production') {
    return 'cockpit-owner-demo-secret-2026';
  }
  throw new Error('OWNER_SECRET_KEY must be configured in production.');
}

/**
 * Constant-time string comparison to prevent timing attacks
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
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
 * Verify request Origin/Referer for CSRF mitigation on state-changing requests
 */
export function verifyOriginAndReferer(req: NextRequest): boolean {
  const method = req.method.toUpperCase();
  // Safe read methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    return true;
  }

  const host = req.headers.get('host');
  if (!host) return true; // Internal or test requests without host

  const origin = req.headers.get('origin');
  if (origin) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== host) {
        return false;
      }
    } catch {
      return false;
    }
  }

  return true;
}
