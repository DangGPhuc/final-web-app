import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { decryptToken } from '@/lib/security/crypto';
import { revokeGoogleToken } from '@/lib/oauth/google-oauth';

export async function POST(req: NextRequest) {
  try {
    const { accountId } = await req.json();

    if (!accountId) {
      return NextResponse.json({ success: false, error: 'Missing accountId' }, { status: 400 });
    }

    const connection = await prisma.gmailConnection.findUnique({
      where: { id: accountId },
    });

    if (!connection) {
      return NextResponse.json({ success: false, error: 'Account not found' }, { status: 404 });
    }

    // 1. Attempt token revocation with Google
    if (connection.encryptedRefreshToken) {
      try {
        const refreshToken = decryptToken(connection.encryptedRefreshToken);
        await revokeGoogleToken(refreshToken);
      } catch {
        // Token revocation failure should not block disconnecting
      }
    }

    // 2. Ensure transactions retain sourceEmail before deleting connection
    await prisma.bankTransaction.updateMany({
      where: { gmailConnectionId: connection.id },
      data: { sourceEmail: connection.email },
    });

    // 3. Delete GmailConnection record (transactions are kept via onDelete: SetNull)
    await prisma.gmailConnection.delete({
      where: { id: connection.id },
    });

    return NextResponse.json({
      success: true,
      message: `Đã ngắt kết nối tài khoản ${connection.email}. Lịch sử giao dịch đã nhập được giữ lại.`,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to disconnect account',
      },
      { status: 500 }
    );
  }
}
