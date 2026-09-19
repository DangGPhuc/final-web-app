/**
 * Bitcoin Market Data Provider
 *
 * Uses CoinGecko public API (no API key required for basic endpoints).
 * Falls back to deterministic demo data if API is unavailable.
 */

import type { MarketCandle } from '@/types';
import type { MarketDataProvider } from './provider';

export class BitcoinProvider implements MarketDataProvider {
  readonly name = 'Bitcoin (BTC/USD)';
  readonly instrument = 'BTC';

  private lastPrice: number | null = null;
  private useDemoData = false;

  async getCurrentPrice(): Promise<number> {
    try {
      const res = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
        { next: { revalidate: 60 } }
      );
      if (!res.ok) throw new Error('API error');
      const data = await res.json();
      this.lastPrice = data.bitcoin?.usd ?? null;
      if (this.lastPrice) {
        this.useDemoData = false;
        return this.lastPrice;
      }
    } catch {
      this.useDemoData = true;
    }

    // Fallback: deterministic demo price
    return this.getDemoPrice();
  }

  async getCandles(days: number = 30): Promise<MarketCandle[]> {
    try {
      const res = await fetch(
        `https://api.coingecko.com/api/v3/coins/bitcoin/ohlc?vs_currency=usd&days=${days}`,
        { next: { revalidate: 300 } }
      );
      if (!res.ok) throw new Error('API error');
      const data: number[][] = await res.json();
      this.useDemoData = false;
      return data.map(([time, open, high, low, close]) => ({
        time,
        open,
        high,
        low,
        close,
      }));
    } catch {
      this.useDemoData = true;
      return this.getDemoCandles(days);
    }
  }

  isLive(): boolean {
    return !this.useDemoData;
  }

  private getDemoPrice(): number {
    // Deterministic demo price based on time
    const hour = new Date().getHours();
    const base = 65000;
    const variation = Math.sin(hour / 24 * Math.PI * 2) * 2000;
    return Math.round(base + variation);
  }

  private getDemoCandles(days: number): MarketCandle[] {
    const candles: MarketCandle[] = [];
    const now = Date.now();
    const basePrice = 65000;

    for (let i = days; i >= 0; i--) {
      const time = now - i * 24 * 60 * 60 * 1000;
      const dayFactor = Math.sin(i / days * Math.PI * 4);
      const open = basePrice + dayFactor * 3000 + (Math.random() - 0.5) * 1000;
      const close = open + (Math.random() - 0.5) * 2000;
      const high = Math.max(open, close) + Math.random() * 500;
      const low = Math.min(open, close) - Math.random() * 500;

      candles.push({
        time,
        open: Math.round(open),
        high: Math.round(high),
        low: Math.round(low),
        close: Math.round(close),
      });
    }

    return candles;
  }
}
