/**
 * Pure finance calculation functions — no React dependency
 */

import type {
  BankTransaction,
  Fund,
  FundStatus,
  MonthlySnapshot,
  FundSnapshotEntry,
  SavingsProjection,
  ProjectionPoint,
} from '@/types';

// ─── Helpers ────────────────────────────────────────────────────────────────

export function getCurrentYearMonth(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function getTransactionYearMonth(tx: { occurredAt: string | Date }): string {
  const d = new Date(tx.occurredAt);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function formatCurrency(amount: number, currency: string = 'VND'): string {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(dateString: string | Date, type: 'short' | 'full' | 'time' = 'short'): string {
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return String(dateString);
    if (type === 'time') {
      return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    }
    if (type === 'full') {
      return date.toLocaleDateString('vi-VN', {
        weekday: 'short',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    }
    return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return String(dateString);
  }
}

export function formatMonthLabel(yearMonth: string): string {
  if (!yearMonth || !yearMonth.includes('-')) return yearMonth;
  const [y, m] = yearMonth.split('-');
  return `Tháng ${m}/${y}`;
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ─── Balance Calculation ────────────────────────────────────────────────────
// In the Personal Finance Cockpit:
// - All valid bank transactions affect the balance immediately upon ingestion.
// - Classification does NOT change whether money entered or left the account.
// - Fund assignment does NOT change the balance.

export function calculateBalance(
  openingBalance: number = 0,
  transactions: BankTransaction[]
): number {
  const totalIn = transactions
    .filter(tx => tx.direction === 'IN')
    .reduce((sum, tx) => sum + tx.amount, 0);
  const totalOut = transactions
    .filter(tx => tx.direction === 'OUT')
    .reduce((sum, tx) => sum + tx.amount, 0);
  return openingBalance + totalIn - totalOut;
}

// ─── Monthly Cashflow ───────────────────────────────────────────────────────

export interface MonthlyCashflow {
  month: string;
  totalIn: number;
  totalOut: number;
  net: number;
}

export function calculateMonthlyCashflow(
  transactions: BankTransaction[],
  month: string
): MonthlyCashflow {
  const monthTxs = transactions.filter(
    tx => getTransactionYearMonth(tx) === month
  );
  const totalIn = monthTxs
    .filter(tx => tx.direction === 'IN')
    .reduce((s, tx) => s + tx.amount, 0);
  const totalOut = monthTxs
    .filter(tx => tx.direction === 'OUT')
    .reduce((s, tx) => s + tx.amount, 0);
  return { month, totalIn, totalOut, net: totalIn - totalOut };
}

// ─── Fund Status ────────────────────────────────────────────────────────────

export function calculateFundStatus(
  fund: Fund,
  transactions: BankTransaction[],
  month: string
): FundStatus {
  const monthTxs = transactions.filter(
    tx =>
      tx.direction === 'OUT' &&
      tx.fundId === fund.id &&
      getTransactionYearMonth(tx) === month
  );
  const spent = monthTxs.reduce((s, tx) => s + tx.amount, 0);
  const allocated = fund.monthlyAllocation;
  const remaining = allocated - spent;
  const usagePercent = allocated > 0 ? (spent / allocated) * 100 : 0;
  const overAmount = remaining < 0 ? Math.abs(remaining) : 0;

  let status: FundStatus['status'] = 'UNDER';
  if (remaining < 0) status = 'OVER';
  else if (remaining === 0) status = 'AT_LIMIT';

  return {
    fundId: fund.id,
    name: fund.name,
    allocated,
    spent,
    remaining,
    usagePercent: Math.round(usagePercent * 10) / 10,
    overAmount,
    status,
  };
}

export function calculateAllFundStatuses(
  funds: Fund[],
  transactions: BankTransaction[],
  month: string
): FundStatus[] {
  return funds
    .filter(f => f.active)
    .map(f => calculateFundStatus(f, transactions, month));
}

export function calculateUnallocated(
  totalIncome: number,
  funds: Fund[]
): number {
  const totalAllocated = funds
    .filter(f => f.active)
    .reduce((s, f) => s + f.monthlyAllocation, 0);
  return totalIncome - totalAllocated;
}

// ─── Monthly Snapshot ───────────────────────────────────────────────────────

export function calculateMonthlySnapshot(
  month: string,
  transactions: BankTransaction[],
  funds: Fund[]
): MonthlySnapshot {
  const cashflow = calculateMonthlyCashflow(transactions, month);
  const fundResults: FundSnapshotEntry[] = funds
    .filter(f => f.active)
    .map(f => {
      const fs = calculateFundStatus(f, transactions, month);
      return {
        fundId: f.id,
        fundName: f.name,
        allocated: fs.allocated,
        spent: fs.spent,
        remaining: fs.remaining,
      };
    });

  return {
    month,
    totalIncome: cashflow.totalIn,
    totalExpense: cashflow.totalOut,
    netSavings: cashflow.net,
    fundResults,
    closedAt: new Date().toISOString(),
  };
}

// ─── Savings Forecast ───────────────────────────────────────────────────────

export function calculateAverageSavings(snapshots: MonthlySnapshot[]): number {
  if (snapshots.length === 0) return 0;
  const total = snapshots.reduce((s, snap) => s + snap.netSavings, 0);
  return total / snapshots.length;
}

export function calculateSavingsProjection(
  snapshots: MonthlySnapshot[],
  cumulativeSavings: number,
  horizonMonths: number = 12
): SavingsProjection {
  const avg = calculateAverageSavings(snapshots);
  const months = snapshots.length;

  const projections: ProjectionPoint[] = [];

  // Historical actual points
  let running = 0;
  for (const snap of snapshots) {
    running += snap.netSavings;
    projections.push({
      month: snap.month,
      projected: running,
      isActual: true,
    });
  }

  // Future projected points
  let currentProjected = cumulativeSavings;
  const now = new Date();
  for (let i = 1; i <= horizonMonths; i++) {
    const futureDate = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const monthStr = getCurrentYearMonth(futureDate);
    currentProjected += avg;
    projections.push({
      month: monthStr,
      projected: Math.round(currentProjected),
      isActual: false,
    });
  }

  return {
    currentCumulativeSavings: cumulativeSavings,
    averageMonthlySavings: Math.round(avg),
    monthsOfData: months,
    projections,
  };
}

// ─── Paper Trading ──────────────────────────────────────────────────────────

export interface TradePnLResult {
  positionSize: number;
  unrealizedPnL: number;
  roi: number;
  priceMovePct: number;
  remainingEquity: number;
  estimatedLiquidationPrice: number | null;
  status: 'OPEN' | 'PROFIT' | 'LOSS' | 'LIQUIDATED';
}

export function calculatePaperTradePnL(
  direction: 'LONG' | 'SHORT',
  entryPrice: number,
  currentPrice: number,
  margin: number,
  leverage: number,
  feePercent: number = 0,
  stopLoss?: number,
  takeProfit?: number
): TradePnLResult {
  const positionSize = margin * leverage;
  const feeAmount = positionSize * (feePercent / 100) * 2;

  let unrealizedPnL: number;
  if (direction === 'LONG') {
    unrealizedPnL = ((currentPrice - entryPrice) / entryPrice) * positionSize - feeAmount;
  } else {
    unrealizedPnL = ((entryPrice - currentPrice) / entryPrice) * positionSize - feeAmount;
  }

  const remainingEquity = margin + unrealizedPnL;
  const roi = margin > 0 ? (unrealizedPnL / margin) * 100 : 0;
  const priceMovePct = entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0;

  let estimatedLiquidationPrice: number | null = null;
  if (leverage > 1 && entryPrice > 0) {
    if (direction === 'LONG') {
      estimatedLiquidationPrice = entryPrice * (1 - 1 / leverage);
    } else {
      estimatedLiquidationPrice = entryPrice * (1 + 1 / leverage);
    }
  }

  let status: TradePnLResult['status'] = 'OPEN';
  if (estimatedLiquidationPrice !== null) {
    if (direction === 'LONG' && currentPrice <= estimatedLiquidationPrice) {
      status = 'LIQUIDATED';
    } else if (direction === 'SHORT' && currentPrice >= estimatedLiquidationPrice) {
      status = 'LIQUIDATED';
    }
  }

  if (status !== 'LIQUIDATED') {
    if (stopLoss !== undefined) {
      if (direction === 'LONG' && currentPrice <= stopLoss) status = 'LOSS';
      if (direction === 'SHORT' && currentPrice >= stopLoss) status = 'LOSS';
    }
    if (takeProfit !== undefined && status === 'OPEN') {
      if (direction === 'LONG' && currentPrice >= takeProfit) status = 'PROFIT';
      if (direction === 'SHORT' && currentPrice <= takeProfit) status = 'PROFIT';
    }
    if (status === 'OPEN') {
      if (unrealizedPnL > 0) status = 'PROFIT';
      else if (unrealizedPnL < 0) status = 'LOSS';
    }
  }

  return {
    positionSize,
    unrealizedPnL: Math.round(unrealizedPnL * 100) / 100,
    roi: Math.round(roi * 100) / 100,
    priceMovePct: Math.round(priceMovePct * 100) / 100,
    remainingEquity: Math.round(remainingEquity * 100) / 100,
    estimatedLiquidationPrice:
      estimatedLiquidationPrice !== null
        ? Math.round(estimatedLiquidationPrice * 100) / 100
        : null,
    status,
  };
}

export function estimateLiquidation(
  direction: 'LONG' | 'SHORT',
  entryPrice: number,
  leverage: number
): number | null {
  if (leverage <= 1 || entryPrice <= 0) return null;
  if (direction === 'LONG') {
    return Math.round(entryPrice * (1 - 1 / leverage) * 100) / 100;
  }
  return Math.round(entryPrice * (1 + 1 / leverage) * 100) / 100;
}

// ─── Merchant Context Detection (Display Hint Only) ──────────────────────────
// Detects known merchant brands for UI context display only.
// This does NOT automatically assign categories or funds.

export function detectMerchantContext(text: string): string | null {
  const lower = text.toLowerCase();
  if (lower.includes('highland')) return 'Highlands Coffee';
  if (lower.includes('grab')) return 'Grab';
  if (lower.includes('shopee')) return 'Shopee';
  if (lower.includes('lazada')) return 'Lazada';
  if (lower.includes('tiki')) return 'Tiki';
  if (lower.includes('starbucks')) return 'Starbucks';
  if (lower.includes('phuc long') || lower.includes('phúc long')) return 'Phúc Long';
  if (lower.includes('be group') || lower.includes('be car') || lower.includes('be bike')) return 'Be';
  if (lower.includes('circle k')) return 'Circle K';
  if (lower.includes('winmart') || lower.includes('vinmart')) return 'WinMart';
  if (lower.includes('co.opmart') || lower.includes('coopmart')) return 'Co.opmart';
  return null;
}
