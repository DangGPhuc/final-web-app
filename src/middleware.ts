import { NextRequest, NextResponse } from 'next/server';
import {
  OWNER_COOKIE_NAME,
  verifyOwnerSessionToken,
  verifyOriginAndReferer,
} from '@/lib/security/owner-auth';

// Protected API route prefixes
const PROTECTED_PREFIXES = [
  '/api/google',
  '/api/email',
  '/api/transactions',
  '/api/categories',
  '/api/funds',
  '/api/data',
];

export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  // Check if request matches any protected API route
  const isProtected = PROTECTED_PREFIXES.some(prefix => pathname.startsWith(prefix));
  if (!isProtected) {
    return NextResponse.next();
  }

  // 1. Check for test bypass in test environment only
  const testBypass = req.headers.get('x-owner-test-bypass');
  const isTestBypass = process.env.NODE_ENV === 'test' && testBypass === 'test-authorized-owner';

  // 2. Validate owner session cookie
  const sessionCookie = req.cookies.get(OWNER_COOKIE_NAME)?.value;
  const isOwnerValid = isTestBypass || (await verifyOwnerSessionToken(sessionCookie));

  if (!isOwnerValid) {
    return NextResponse.json(
      {
        success: false,
        error: 'Unauthorized: Phiên chủ sở hữu không hợp lệ hoặc đã hết hạn (Owner session required).',
      },
      { status: 401 }
    );
  }

  // 3. Origin & CSRF validation on destructive state-changing requests
  if (!isTestBypass && !verifyOriginAndReferer(req)) {
    return NextResponse.json(
      {
        success: false,
        error: 'Forbidden: Yêu cầu bị chặn do không khớp nguồn gốc CSRF (Cross-origin mutation rejected).',
      },
      { status: 403 }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/api/google/:path*',
    '/api/email/:path*',
    '/api/transactions/:path*',
    '/api/categories/:path*',
    '/api/funds/:path*',
    '/api/data/:path*',
  ],
};
