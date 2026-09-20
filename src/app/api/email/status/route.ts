import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET() {
  try {
    const connections = await prisma.gmailConnection.findMany({
      where: { revokedAt: null },
      orderBy: { connectedAt: 'desc' },
    });

    const isConnected = connections.length > 0;
    const emails = connections.map(c => c.email);

    return NextResponse.json({
      provider: 'gmail',
      connected: isConnected,
      email: emails[0] || undefined,
      accountsCount: connections.length,
      emails,
    });
  } catch (error) {
    return NextResponse.json(
      {
        provider: 'gmail',
        connected: false,
        error: error instanceof Error ? error.message : 'Lỗi kết nối email',
      },
      { status: 500 }
    );
  }
}
