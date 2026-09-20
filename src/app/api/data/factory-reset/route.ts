import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { decryptToken } from '@/lib/security/crypto';
import { revokeGoogleToken } from '@/lib/oauth/google-oauth';

export async function POST() {
  try {
    // 1. Attempt revocation of all active Google tokens
    const connections = await prisma.gmailConnection.findMany();
    for (const conn of connections) {
      if (conn.encryptedRefreshToken) {
        try {
          const refreshToken = decryptToken(conn.encryptedRefreshToken);
          await revokeGoogleToken(refreshToken);
        } catch {
          // Continue even if revocation fails for one token
        }
      }
    }

    // 2. Wipe entire database
    await prisma.$transaction([
      prisma.bankTransaction.deleteMany(),
      prisma.category.deleteMany(),
      prisma.fund.deleteMany(),
      prisma.monthlySnapshot.deleteMany(),
      prisma.syncRun.deleteMany(),
      prisma.gmailConnection.deleteMany(),
      prisma.paperTrade.deleteMany(),
    ]);

    return NextResponse.json({
      success: true,
      message: 'Hệ thống đã được khôi phục về trạng thái ban đầu (đã thu hồi token và xóa toàn bộ tài khoản liên kết).',
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Lỗi khôi phục hệ thống',
      },
      { status: 500 }
    );
  }
}
