import { NextResponse } from 'next/server';
import { INITIAL_WALLETS } from '@/lib/mock-data';

export async function GET() {
  return NextResponse.json({
    success: true,
    data: INITIAL_WALLETS,
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    return NextResponse.json({
      success: true,
      data: {
        ...body,
        id: `wal-${Date.now()}`,
        createdAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Invalid payload' }, { status: 400 });
  }
}
