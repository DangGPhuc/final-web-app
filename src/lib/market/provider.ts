/**
 * Market Data Provider Interface
 */

import type { MarketCandle } from '@/types';

export interface MarketDataProvider {
  readonly name: string;
  readonly instrument: string;

  /**
   * Get current price
   */
  getCurrentPrice(): Promise<number>;

  /**
   * Get historical candle data
   */
  getCandles(days: number): Promise<MarketCandle[]>;

  /**
   * Whether this provider uses live data or demo data
   */
  isLive(): boolean;
}
