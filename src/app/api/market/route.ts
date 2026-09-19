import { NextRequest, NextResponse } from 'next/server';
import { BitcoinProvider } from '@/lib/market/bitcoin-provider';
import { GoldProvider } from '@/lib/market/gold-provider';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const instrument = (searchParams.get('instrument') || 'BTC').toUpperCase();
    const days = parseInt(searchParams.get('days') || '30', 10);

    const provider = instrument === 'XAU' ? new GoldProvider() : new BitcoinProvider();

    const [currentPrice, candles] = await Promise.all([
      provider.getCurrentPrice(),
      provider.getCandles(days),
    ]);

    return NextResponse.json({
      instrument: provider.instrument,
      name: provider.name,
      currentPrice,
      candles,
      isLive: provider.isLive(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Lỗi tải dữ liệu thị trường',
      },
      { status: 500 }
    );
  }
}
