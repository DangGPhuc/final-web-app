import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  Pragma: 'no-cache',
};

export async function GET() {
  try {
    const connections = await prisma.gmailConnection.findMany({
      orderBy: { connectedAt: 'desc' },
      select: {
        id: true,
        googleSub: true,
        email: true,
        displayName: true,
        avatarUrl: true,
        connectedAt: true,
        lastSyncAt: true,
        revokedAt: true,
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
      connectionStatus: c.revokedAt ? ('reconnect_required' as const) : ('connected' as const),
    }));

    return NextResponse.json({ success: true, accounts }, { headers: NO_CACHE_HEADERS });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch accounts',
      },
      { status: 500, headers: NO_CACHE_HEADERS }
    );
  }
}
