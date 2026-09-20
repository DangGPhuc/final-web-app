import { NextRequest, NextResponse } from 'next/server';
import {
  OWNER_COOKIE_NAME,
  verifyOwnerSessionToken,
  setOwnerSessionCookie,
  clearOwnerSessionCookie,
  getOwnerSecretKey,
} from '@/lib/security/owner-auth';

export async function GET(req: NextRequest) {
  const token = req.cookies.get(OWNER_COOKIE_NAME)?.value;
  const isAuthenticated = await verifyOwnerSessionToken(token);

  return NextResponse.json({
    authenticated: isAuthenticated,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { secretKey } = body as { secretKey?: string };

    const expectedSecret = getOwnerSecretKey();

    // If in dev or test and secretKey matches OR user clicked quick-unlock with default
    if (!secretKey || secretKey.trim() !== expectedSecret) {
      return NextResponse.json(
        {
          success: false,
          error: 'Khóa chủ sở hữu không chính xác (Invalid owner key).',
        },
        { status: 401 }
      );
    }

    const res = NextResponse.json({
      success: true,
      message: 'Xác thực chủ sở hữu thành công (Owner session established).',
    });

    await setOwnerSessionCookie(res);
    return res;
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Lỗi xác thực',
      },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  const res = NextResponse.json({
    success: true,
    message: 'Đã đăng xuất phiên chủ sở hữu (Owner session cleared).',
  });
  clearOwnerSessionCookie(res);
  return res;
}
