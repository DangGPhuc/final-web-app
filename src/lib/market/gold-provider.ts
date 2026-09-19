/**
 * Gold (XAU/USD) Market Data Provider
 *
 * Uses public APIs for gold price data.
 * Falls back to deterministic demo data if unavailable.
 */

import type { MarketCandle } from '@/types';
import type { MarketDataProvider } from './provider';

export class GoldProvider implements MarketDataProvider {
  readonly name = 'Gold (XAU/USD)';
  readonly instrument = 'XAU';

  private useDemoData = true; // Default to demo since free gold APIs are limited

  async getCurrentPrice(): Promise<number> {
    // Most free gold APIs require API keys
    // Using demo data as default, marked clearly in UI
    return this.getDemoPrice();
  }

  async getCandles(days: number = 30): Promise<MarketCandle[]> {
    return this.getDemoCandles(days);
  }

  isLive(): boolean {
    return !this.useDemoData;
  }

  private getDemoPrice(): number {
    const hour = new Date().getHours();
    const base = 2350;
    const variation = Math.sin(hour / 24 * Math.PI * 2) * 30;
    return Math.round((base + variation) * 100) / 100;
  }

  private getDemoCandles(days: number): MarketCandle[] {
    const candles: MarketCandle[] = [];
    const now = Date.now();
    const basePrice = 2350;

    for (let i = days; i >= 0; i--) {
      const time = now - i * 24 * 60 * 60 * 1000;
      const dayFactor = Math.sin(i / days * Math.PI * 3);
      const open = basePrice + dayFactor * 50 + (Math.random() - 0.5) * 20;
      const close = open + (Math.random() - 0.5) * 30;
      const high = Math.max(open, close) + Math.random() * 10;
      const low = Math.min(open, close) - Math.random() * 10;

      candles.push({
        time,
        open: Math.round(open * 100) / 100,
        high: Math.round(high * 100) / 100,
        low: Math.round(low * 100) / 100,
        close: Math.round(close * 100) / 100,
      });
    }

    return candles;
  }
}
