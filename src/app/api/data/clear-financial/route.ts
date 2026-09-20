import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function POST() {
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
