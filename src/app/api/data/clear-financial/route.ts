import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { OWNER_COOKIE_NAME, verifyOwnerSessionToken } from '@/lib/security/owner-auth';

export async function POST(req: NextRequest) {
  const sessionCookie = req.cookies.get(OWNER_COOKIE_NAME)?.value;
  const testBypass = req.headers.get('x-owner-test-bypass');
  const isTest = process.env.NODE_ENV === 'test' && testBypass === 'test-authorized-owner';

  if (!isTest && !(await verifyOwnerSessionToken(sessionCookie))) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized: Phiên chủ sở hữu không hợp lệ (Owner session required).' },
      { status: 401 }
    );
  }

  try {
    // Delete financial data inside a transaction, but keep Gmail connections and encrypted tokens
    await prisma.$transaction([
      prisma.bankTransaction.deleteMany(),
      prisma.category.deleteMany(),
      prisma.fund.deleteMany(),
      prisma.monthlySnapshot.deleteMany(),
      prisma.syncRun.deleteMany(),
    ]);

    return NextResponse.json({
      success: true,
      message: 'Đã xóa toàn bộ dữ liệu tài chính (biến động, quỹ, danh mục, snapshot). Tài khoản Gmail vẫn được giữ lại để bạn có thể nhập lại lịch sử bất kỳ lúc nào.',
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Lỗi xóa dữ liệu tài chính',
      },
      { status: 500 }
    );
  }
}
