import { describe, it, expect } from 'vitest';
import {
  calculateBalance,
  calculateMonthlyCashflow,
  calculateFundStatus,
  calculateMonthlySnapshot,
  calculateSavingsProjection,
  calculatePaperTradePnL,
  estimateLiquidation,
  detectMerchantContext,
} from '../src/lib/finance/calculations';
import type { BankTransaction, Fund, MonthlySnapshot } from '../src/types';

describe('Financial Calculations — Pure Domain Functions', () => {
  describe('calculateBalance', () => {
    it('calculates balance with opening baseline + all valid IN - all valid OUT immediately', () => {
      const transactions: BankTransaction[] = [
        {
          id: '1',
          gmailMessageId: 'm1',
          direction: 'IN',
          amount: 20000000,
          currency: 'VND',
          occurredAt: '2026-09-01T00:00:00Z',
          summary: 'Lương',
          classificationState: 'UNCLASSIFIED',
          importedAt: '',
        },
        {
          id: '2',
          gmailMessageId: 'm2',
          direction: 'OUT',
          amount: 5000000,
          currency: 'VND',
          occurredAt: '2026-09-02T00:00:00Z',
          summary: 'Tiền nhà',
          classificationState: 'UNCLASSIFIED',
          importedAt: '',
        },
        {
          id: '3',
          gmailMessageId: 'm3',
          direction: 'OUT',
          amount: 120000,
          currency: 'VND',
          occurredAt: '2026-09-03T00:00:00Z',
          summary: 'Highlands Coffee',
          classificationState: 'UNCLASSIFIED',
          importedAt: '',
        },
      ];

      const balance = calculateBalance(0, transactions);
      // 0 + 20,000,000 - 5,000,000 - 120,000 = 14,880,000
      expect(balance).toBe(14880000);
    });

    it('classification does NOT change the authoritative balance', () => {
      const txUnclassified: BankTransaction = {
        id: 'tx-1',
        gmailMessageId: 'm1',
        direction: 'OUT',
        amount: 120000,
        currency: 'VND',
        occurredAt: '2026-09-06T14:15:00Z',
        summary: 'Highlands Coffee',
        classificationState: 'UNCLASSIFIED',
        importedAt: '',
      };

      const balanceBefore = calculateBalance(0, [txUnclassified]);
      expect(balanceBefore).toBe(-120000);

      // Now user classifies the transaction
      const txClassified: BankTransaction = {
        ...txUnclassified,
        categoryId: 'cat-cafe',
        fundId: 'fund-dining',
        classificationState: 'CLASSIFIED',
      };

      const balanceAfter = calculateBalance(0, [txClassified]);
      // Ledger balance remains strictly identical
      expect(balanceAfter).toBe(balanceBefore);
    });
  });

  describe('Fund Accounting & Status', () => {
    const fund: Fund = {
      id: 'fund-dining',
      name: 'Quỹ ăn uống',
      monthlyAllocation: 3000000,
      createdAt: '',
      active: true,
    };

    it('calculates fund spent, remaining, and status UNDER when within limit', () => {
      const transactions: BankTransaction[] = [
        {
          id: '1',
          gmailMessageId: 'm1',
          direction: 'OUT',
          amount: 500000,
          currency: 'VND',
          occurredAt: '2026-09-05T00:00:00Z',
          summary: 'Ăn tối',
          fundId: 'fund-dining',
          classificationState: 'CLASSIFIED',
          importedAt: '',
        },
      ];

      const status = calculateFundStatus(fund, transactions, '2026-09');
      expect(status.spent).toBe(500000);
      expect(status.remaining).toBe(2500000);
      expect(status.status).toBe('UNDER');
      expect(status.overAmount).toBe(0);
    });

    it('detects OVER limit correctly when spent exceeds monthlyAllocation', () => {
      const transactions: BankTransaction[] = [
        {
          id: '1',
          gmailMessageId: 'm1',
          direction: 'OUT',
          amount: 3500000,
          currency: 'VND',
          occurredAt: '2026-09-10T00:00:00Z',
          summary: 'Tiệc tùng',
          fundId: 'fund-dining',
          classificationState: 'CLASSIFIED',
          importedAt: '',
        },
      ];

      const status = calculateFundStatus(fund, transactions, '2026-09');
      expect(status.spent).toBe(3500000);
      expect(status.remaining).toBe(-500000);
      expect(status.status).toBe('OVER');
      expect(status.overAmount).toBe(500000);
    });
  });

  describe('Merchant Context Detection (Display Hint Only)', () => {
    it('detects Highlands Coffee brand without auto-classifying', () => {
      expect(detectMerchantContext('Thanh toan Cafe Highland Nguyen Du')).toBe('Highlands Coffee');
    });

    it('detects Grab brand', () => {
      expect(detectMerchantContext('Thanh toan Grab Car di lam')).toBe('Grab');
    });

    it('detects Shopee brand', () => {
      expect(detectMerchantContext('Mua sam Shopee don hang 98231')).toBe('Shopee');
    });

    it('returns null for generic transactions', () => {
      expect(detectMerchantContext('Chuyen tien ca nhan')).toBeNull();
    });
  });

  describe('Paper Trading Calculations', () => {
    it('calculates long profit correctly', () => {
      const res = calculatePaperTradePnL('LONG', 60000, 66000, 1000, 10, 0);
      // Position = 10,000. Price went up 10% -> PnL = +1,000.
      expect(res.unrealizedPnL).toBe(1000);
      expect(res.status).toBe('PROFIT');
    });

    it('estimates liquidation price for 10x leverage', () => {
      const liq = estimateLiquidation('LONG', 60000, 10);
      // 60,000 * (1 - 0.1) = 54,000
      expect(liq).toBe(54000);
    });
  });
});
