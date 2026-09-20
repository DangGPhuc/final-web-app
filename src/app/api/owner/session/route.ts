import { NextRequest, NextResponse } from 'next/server';
import {
  OWNER_COOKIE_NAME,
  verifyOwnerSessionToken,
  setOwnerSessionCookie,
  clearOwnerSessionCookie,
  verifyOwnerCredential,
} from '@/lib/security/owner-auth';

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  Pragma: 'no-cache',
};

export async function GET(req: NextRequest) {
  const token = req.cookies.get(OWNER_COOKIE_NAME)?.value;
  const isAuthenticated = await verifyOwnerSessionToken(token);

  return NextResponse.json(
    {
      authenticated: isAuthenticated,
    },
    {
      headers: NO_CACHE_HEADERS,
    }
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { secretKey } = body as { secretKey?: string };

    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      req.headers.get('x-real-ip') ||
      '127.0.0.1';

    const result = verifyOwnerCredential(secretKey, ip);

    if (!result.success) {
      const status = result.rateLimited ? 429 : 401;
      return NextResponse.json(
        {
          success: false,
          error: result.error || 'Owner key không hợp lệ',
        },
        {
          status,
          headers: NO_CACHE_HEADERS,
        }
      );
    }

    const res = NextResponse.json(
      {
        success: true,
        message: 'Mở khóa Cockpit thành công (Owner session established).',
      },
      {
        headers: NO_CACHE_HEADERS,
      }
    );

    await setOwnerSessionCookie(res);
    return res;
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: 'Lỗi xác thực khóa chủ sở hữu',
      },
      {
        status: 500,
        headers: NO_CACHE_HEADERS,
      }
    );
  }
}

export async function DELETE() {
  const res = NextResponse.json(
    {
      success: true,
      message: 'Đã khóa Cockpit (Owner session cleared).',
    },
    {
      headers: NO_CACHE_HEADERS,
    }
  );
  clearOwnerSessionCookie(res);
  return res;
}
