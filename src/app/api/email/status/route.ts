import { NextResponse } from 'next/server';
import { GmailProvider } from '@/lib/email/gmail-provider';

export async function GET() {
  try {
    const provider = new GmailProvider();
    const status = await provider.getStatus();
    return NextResponse.json({
      provider: 'gmail',
      connected: status.connected,
      email: status.email,
      error: status.error,
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
