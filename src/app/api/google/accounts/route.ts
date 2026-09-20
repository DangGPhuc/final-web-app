import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET() {
  try {
    const connections = await prisma.gmailConnection.findMany({
      where: { revokedAt: null },
      orderBy: { connectedAt: 'desc' },
      select: {
        id: true,
        googleSub: true,
        email: true,
        displayName: true,
        avatarUrl: true,
        connectedAt: true,
        lastSyncAt: true,
      },
    });

    const accounts = connections.map(c => ({
      id: c.id,
      googleSub: c.googleSub,
      email: c.email,
      displayName: c.displayName,
      avatarUrl: c.avatarUrl,
      connectedAt: c.connectedAt.toISOString(),
      lastSyncAt: c.lastSyncAt ? c.lastSyncAt.toISOString() : null,
      connectionStatus: 'connected' as const,
    }));

    return NextResponse.json({ success: true, accounts });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch accounts',
      },
      { status: 500 }
    );
  }
}
