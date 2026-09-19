import { describe, it, expect } from 'vitest';
import {
  calculateBalance,
  calculateMonthlyCashflow,
  calculateFundStatus,
  calculateMonthlySnapshot,
  calculateAverageSavings,
  calculateSavingsProjection,
  calculatePaperTradePnL,
  estimateLiquidation,
} from '../src/lib/finance/calculations';
import type { Transaction, Fund, MonthlySnapshot } from '../src/types';

describe('Financial Calculations — Pure Domain Functions', () => {
  describe('calculateBalance', () => {
    it('calculates balance with opening balance + posted IN - posted OUT', () => {
      const transactions: Transaction[] = [
        {
          id: '1',
          source: 'MANUAL',
          direction: 'IN',
          amount: 20000000,
          currency: 'VND',
          occurredAt: '2026-09-01T00:00:00Z',
          description: 'Lương',
          category: 'Lương',
          status: 'POSTED',
          createdAt: '',
          updatedAt: '',
        },
        {
          id: '2',
          source: 'MANUAL',
          direction: 'OUT',
          amount: 5000000,
          currency: 'VND',
          occurredAt: '2026-09-02T00:00:00Z',
          description: 'Tiền nhà',
          category: 'Nhà cửa',
          status: 'POSTED',
          createdAt: '',
          updatedAt: '',
        },
        {
          id: '3',
          source: 'EMAIL',
          direction: 'OUT',
          amount: 1000000,
          currency: 'VND',
          occurredAt: '2026-09-03T00:00:00Z',
          description: 'Chưa duyệt',
          category: 'Khác',
          status: 'NEEDS_REVIEW', // Should not affect balance!
          createdAt: '',
          updatedAt: '',
        },
      ];

      const balance = calculateBalance(1000000, transactions);
      // 1,000,000 + 20,000,000 - 5,000,000 = 16,000,000
      expect(balance).toBe(16000000);
    });
  });

  describe('Fund Accounting Rules', () => {
    const fund: Fund = {
      id: 'fund-dining',
      name: 'Quỹ ăn uống',
      monthlyAllocation: 3000000,
      categoryMappings: ['Ăn uống'],
      merchantMappings: [],
      createdAt: '',
      active: true,
    };

    it('calculates spent, remaining, usagePercent, and UNDER status', () => {
      const transactions: Transaction[] = [
        {
          id: '1',
          source: 'MANUAL',
          direction: 'OUT',
          amount: 1200000,
          currency: 'VND',
          occurredAt: '2026-09-05T00:00:00Z',
          description: 'Ăn uống',
          category: 'Ăn uống',
          fundId: 'fund-dining',
          status: 'POSTED',
          createdAt: '',
          updatedAt: '',
        },
      ];

      const status = calculateFundStatus(fund, transactions, '2026-09');
      expect(status.spent).toBe(1200000);
      expect(status.remaining).toBe(1800000);
      expect(status.usagePercent).toBe(40);
      expect(status.overAmount).toBe(0);
      expect(status.status).toBe('UNDER');
    });

    it('calculates OVER status and overAmount when spent exceeds allocation', () => {
      const transactions: Transaction[] = [
        {
          id: '1',
          source: 'MANUAL',
          direction: 'OUT',
          amount: 3500000,
          currency: 'VND',
          occurredAt: '2026-09-10T00:00:00Z',
          description: 'Tiệc tùng',
          category: 'Ăn uống',
          fundId: 'fund-dining',
          status: 'POSTED',
          createdAt: '',
          updatedAt: '',
        },
      ];

      const status = calculateFundStatus(fund, transactions, '2026-09');
      expect(status.spent).toBe(3500000);
      expect(status.remaining).toBe(-500000);
      expect(status.overAmount).toBe(500000);
      expect(status.status).toBe('OVER');
    });

    it('changing monthly allocation does NOT modify spent amount', () => {
      const transactions: Transaction[] = [
        {
          id: '1',
          source: 'MANUAL',
          direction: 'OUT',
          amount: 1000000,
          currency: 'VND',
          occurredAt: '2026-09-10T00:00:00Z',
          description: 'Ăn uống',
          category: 'Ăn uống',
          fundId: 'fund-dining',
          status: 'POSTED',
          createdAt: '',
          updatedAt: '',
        },
      ];

      const statusOld = calculateFundStatus(fund, transactions, '2026-09');
      const modifiedFund = { ...fund, monthlyAllocation: 5000000 };
      const statusNew = calculateFundStatus(modifiedFund, transactions, '2026-09');

      expect(statusOld.spent).toBe(1000000);
      expect(statusNew.spent).toBe(1000000);
      expect(statusNew.remaining).toBe(4000000);
    });
  });

  describe('Savings Forecast Logic', () => {
    it('1 month -> average equals that 1 month', () => {
      const snapshots: MonthlySnapshot[] = [
        {
          month: '2026-07',
          totalIncome: 20000000,
          totalExpense: 14000000,
          netSavings: 6000000,
          fundResults: [],
          closedAt: '',
        },
      ];

      const { average, months } = calculateAverageSavings(snapshots);
      expect(months).toBe(1);
      expect(average).toBe(6000000);
    });

    it('2 months -> average is (m1 + m2) / 2', () => {
      const snapshots: MonthlySnapshot[] = [
        {
          month: '2026-07',
          totalIncome: 20000000,
          totalExpense: 14000000,
          netSavings: 6000000,
          fundResults: [],
          closedAt: '',
        },
        {
          month: '2026-08',
          totalIncome: 22000000,
          totalExpense: 14000000,
          netSavings: 8000000,
          fundResults: [],
          closedAt: '',
        },
      ];

      const { average, months } = calculateAverageSavings(snapshots);
      expect(months).toBe(2);
      expect(average).toBe(7000000);
    });

    it('supports negative savings trajectory without Math.max(0)', () => {
      const snapshots: MonthlySnapshot[] = [
        {
          month: '2026-07',
          totalIncome: 15000000,
          totalExpense: 18000000,
          netSavings: -3000000,
          fundResults: [],
          closedAt: '',
        },
        {
          month: '2026-08',
          totalIncome: 15000000,
          totalExpense: 20000000,
          netSavings: -5000000,
          fundResults: [],
          closedAt: '',
        },
      ];

      const { average, months } = calculateAverageSavings(snapshots);
      expect(months).toBe(2);
      expect(average).toBe(-4000000);

      const proj = calculateSavingsProjection(snapshots, 10000000, 3);
      expect(proj.averageMonthlySavings).toBe(-4000000);
      const forecastPoints = proj.projections.filter(p => !p.isActual);
      expect(forecastPoints[0].projected).toBe(6000000); // 10M - 4M
      expect(forecastPoints[1].projected).toBe(2000000); // 6M - 4M
      expect(forecastPoints[2].projected).toBe(-2000000); // 2M - 4M (proper negative value!)
    });
  });

  describe('Demo Trading Calculations', () => {
    it('calculates LONG position size and unrealized PnL', () => {
      const res = calculatePaperTradePnL(
        'LONG',
        60000, // entry
        66000, // +10% price move
        1000,  // margin
        10,    // 10x leverage
        0      // 0 fee
      );

      expect(res.positionSize).toBe(10000); // 1000 * 10
      expect(res.priceMovePct).toBe(10);
      expect(res.unrealizedPnL).toBe(1000); // 10% * 10000
      expect(res.roi).toBe(100);            // 100% on margin
      expect(res.status).toBe('PROFIT');
    });

    it('calculates SHORT position size and unrealized PnL', () => {
      const res = calculatePaperTradePnL(
        'SHORT',
        60000, // entry
        54000, // -10% price move
        1000,  // margin
        10,    // 10x leverage
        0      // 0 fee
      );

      expect(res.positionSize).toBe(10000);
      expect(res.unrealizedPnL).toBe(1000);
      expect(res.roi).toBe(100);
      expect(res.status).toBe('PROFIT');
    });

    it('estimates liquidation correctly and marks LIQUIDATED when threshold crossed', () => {
      // 10x leverage liquidation is at 10% adverse move: 60000 * (1 - 0.1) = 54000
      const liqPrice = estimateLiquidation('LONG', 60000, 10);
      expect(liqPrice).toBe(54000);

      const liquidatedRes = calculatePaperTradePnL(
        'LONG',
        60000,
        53900, // below liquidation
        1000,
        10,
        0
      );

      expect(liquidatedRes.status).toBe('LIQUIDATED');
    });
  });
});
