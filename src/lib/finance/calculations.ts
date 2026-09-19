/**
 * Pure finance calculation functions — no React dependency
 */

import type {
  Transaction,
  Fund,
  FundStatus,
  MonthlySnapshot,
  FundSnapshotEntry,
  SavingsProjection,
  ProjectionPoint,
  AppSettings,
} from '@/types';

// ─── Helpers ────────────────────────────────────────────────────────────────

export function getCurrentYearMonth(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function getTransactionYearMonth(tx: Transaction): string {
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

export function formatDate(dateString: string, type: 'short' | 'full' | 'time' = 'short'): string {
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    if (type === 'time') {
      return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    }
    if (type === 'full') {
      return date.toLocaleDateString('vi-VN', {
        weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    }
    return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return dateString;
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

// ─── Balance ────────────────────────────────────────────────────────────────

export function calculateBalance(
  openingBalance: number,
  transactions: Transaction[]
): number {
  const posted = transactions.filter(tx => tx.status === 'POSTED');
  const totalIn = posted
    .filter(tx => tx.direction === 'IN')
    .reduce((sum, tx) => sum + tx.amount, 0);
  const totalOut = posted
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
  transactions: Transaction[],
  month: string
): MonthlyCashflow {
  const posted = transactions.filter(
    tx => tx.status === 'POSTED' && getTransactionYearMonth(tx) === month
  );
  const totalIn = posted.filter(tx => tx.direction === 'IN').reduce((s, tx) => s + tx.amount, 0);
  const totalOut = posted.filter(tx => tx.direction === 'OUT').reduce((s, tx) => s + tx.amount, 0);
  return { month, totalIn, totalOut, net: totalIn - totalOut };
}

// ─── Fund Status ────────────────────────────────────────────────────────────

export function calculateFundStatus(
  fund: Fund,
  transactions: Transaction[],
  month: string
): FundStatus {
  const monthTxs = transactions.filter(
    tx =>
      tx.status === 'POSTED' &&
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
  transactions: Transaction[],
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
  transactions: Transaction[],
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

// ─── Average Savings ────────────────────────────────────────────────────────

export function calculateAverageSavings(
  snapshots: MonthlySnapshot[]
): { average: number; months: number } {
  if (snapshots.length === 0) return { average: 0, months: 0 };
  const total = snapshots.reduce((s, snap) => s + snap.netSavings, 0);
  return {
    average: total / snapshots.length,
    months: snapshots.length,
  };
}

// ─── Savings Projection ─────────────────────────────────────────────────────

export function calculateSavingsProjection(
  snapshots: MonthlySnapshot[],
  currentCumulativeSavings: number,
  horizonMonths: number
): SavingsProjection {
  const { average, months } = calculateAverageSavings(snapshots);

  const projections: ProjectionPoint[] = [];

  // Historical actual points
  let cumulative = currentCumulativeSavings;
  // Build from snapshots
  const sortedSnapshots = [...snapshots].sort((a, b) => a.month.localeCompare(b.month));

  // Re-derive cumulative from opening balance perspective
  let historicalCumulative = 0;
  for (const snap of sortedSnapshots) {
    historicalCumulative += snap.netSavings;
    projections.push({
      month: snap.month,
      projected: historicalCumulative,
      isActual: true,
    });
  }

  // Future forecast points
  const lastMonth = sortedSnapshots.length > 0
    ? sortedSnapshots[sortedSnapshots.length - 1].month
    : getCurrentYearMonth();

  let forecastCumulative = currentCumulativeSavings;
  for (let i = 1; i <= horizonMonths; i++) {
    const [y, m] = lastMonth.split('-').map(Number);
    const futureDate = new Date(y, m - 1 + i, 1);
    const futureMonth = getCurrentYearMonth(futureDate);
    forecastCumulative += average;
    projections.push({
      month: futureMonth,
      projected: Math.round(forecastCumulative),
      isActual: false,
    });
  }

  return {
    currentCumulativeSavings,
    averageMonthlySavings: Math.round(average),
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
  const feeAmount = positionSize * (feePercent / 100) * 2; // entry + exit fee

  let unrealizedPnL: number;
  if (direction === 'LONG') {
    unrealizedPnL = ((currentPrice - entryPrice) / entryPrice) * positionSize - feeAmount;
  } else {
    unrealizedPnL = ((entryPrice - currentPrice) / entryPrice) * positionSize - feeAmount;
  }

  const remainingEquity = margin + unrealizedPnL;
  const roi = margin > 0 ? (unrealizedPnL / margin) * 100 : 0;
  const priceMovePct = entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0;

  // Estimated liquidation (simplified: when equity reaches 0)
  let estimatedLiquidationPrice: number | null = null;
  if (leverage > 1 && entryPrice > 0) {
    if (direction === 'LONG') {
      estimatedLiquidationPrice = entryPrice * (1 - 1 / leverage);
    } else {
      estimatedLiquidationPrice = entryPrice * (1 + 1 / leverage);
    }
  }

  // Determine status
  let status: TradePnLResult['status'] = 'OPEN';
  if (estimatedLiquidationPrice !== null) {
    if (direction === 'LONG' && currentPrice <= estimatedLiquidationPrice) {
      status = 'LIQUIDATED';
    } else if (direction === 'SHORT' && currentPrice >= estimatedLiquidationPrice) {
      status = 'LIQUIDATED';
    }
  }

  if (status !== 'LIQUIDATED') {
    // Check stop loss
    if (stopLoss !== undefined) {
      if (direction === 'LONG' && currentPrice <= stopLoss) status = 'LOSS';
      if (direction === 'SHORT' && currentPrice >= stopLoss) status = 'LOSS';
    }
    // Check take profit
    if (takeProfit !== undefined && status === 'OPEN') {
      if (direction === 'LONG' && currentPrice >= takeProfit) status = 'PROFIT';
      if (direction === 'SHORT' && currentPrice <= takeProfit) status = 'PROFIT';
    }
    // General P&L status
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
    estimatedLiquidationPrice: estimatedLiquidationPrice !== null
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

// ─── Transaction Classification ─────────────────────────────────────────────

import type { MerchantRule } from '@/types';

const KEYWORD_MAP: Record<string, string> = {
  'salary': 'Lương',
  'payroll': 'Lương',
  'luong': 'Lương',
  'lương': 'Lương',
  'restaurant': 'Ăn uống',
  'coffee': 'Ăn uống',
  'cafe': 'Ăn uống',
  'food': 'Ăn uống',
  'an uong': 'Ăn uống',
  'grab': 'Di chuyển',
  'taxi': 'Di chuyển',
  'be': 'Di chuyển',
  'xang': 'Di chuyển',
  'shopping': 'Mua sắm',
  'mua sam': 'Mua sắm',
  'shopee': 'Mua sắm',
  'lazada': 'Mua sắm',
  'tiki': 'Mua sắm',
  'electricity': 'Hóa đơn',
  'internet': 'Hóa đơn',
  'dien': 'Hóa đơn',
  'nuoc': 'Hóa đơn',
  'water': 'Hóa đơn',
  'transport': 'Di chuyển',
};

export function classifyTransaction(
  description: string,
  counterparty: string | undefined,
  merchantRules: MerchantRule[]
): { category: string; fundId?: string } {
  const text = `${description} ${counterparty || ''}`.toLowerCase();

  // Check merchant rules first
  for (const rule of merchantRules) {
    if (text.includes(rule.pattern.toLowerCase())) {
      return { category: rule.category, fundId: rule.fundId };
    }
  }

  // Keyword matching
  for (const [keyword, category] of Object.entries(KEYWORD_MAP)) {
    if (text.includes(keyword)) {
      return { category };
    }
  }

  return { category: 'Khác' };
}

// ─── Deduplication ──────────────────────────────────────────────────────────

export function dedupeEmailEvents(
  existing: Transaction[],
  incoming: Transaction[]
): Transaction[] {
  const existingIds = new Set(
    existing
      .filter(tx => tx.source === 'EMAIL' && tx.sourceMessageId)
      .map(tx => tx.sourceMessageId)
  );

  return incoming.filter(tx => {
    if (!tx.sourceMessageId) return true;
    if (existingIds.has(tx.sourceMessageId)) return false;
    existingIds.add(tx.sourceMessageId);
    return true;
  });
}
