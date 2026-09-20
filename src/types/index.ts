// ─── Personal Finance Cockpit — Domain Types ────────────────────────────────

export type TransactionDirection = 'IN' | 'OUT';
export type ClassificationState = 'UNCLASSIFIED' | 'CLASSIFIED';

// ─── Bank Transaction Entity ──────────────────────────────────────────────────

export interface BankTransaction {
  id: string;
  gmailConnectionId?: string | null;
  sourceEmail?: string | null;
  gmailMessageId: string;
  gmailThreadId?: string | null;
  bankRefId?: string | null;
  fingerprint?: string | null;
  bankCode?: string | null;
  bankName?: string | null;
  accountHint?: string | null;
  direction: TransactionDirection;
  amount: number;
  currency: string;
  occurredAt: string; // ISO string
  emailReceivedAt?: string | null; // ISO string of raw email receipt
  counterparty?: string | null;
  merchantLabel?: string | null; // Display hint only, does NOT automatically classify
  summary: string;
  categoryId?: string | null;
  fundId?: string | null;
  classificationState: ClassificationState;
  importedAt: string;
  category?: Category | null;
  fund?: Fund | null;
}

// Alias for convenience across UI components
export type Transaction = BankTransaction;

// ─── User-Defined Category Entity ─────────────────────────────────────────────

export interface Category {
  id: string;
  name: string;
  direction?: string | null; // IN | OUT | BOTH
  createdAt: string;
}

// ─── Fund Entity (Clean budget allocation model) ──────────────────────────────

export interface Fund {
  id: string;
  name: string;
  monthlyAllocation: number;
  active: boolean;
  createdAt: string;
}

export interface FundStatus {
  fundId: string;
  name: string;
  allocated: number;
  spent: number;
  remaining: number;
  usagePercent: number;
  overAmount: number;
  status: 'UNDER' | 'AT_LIMIT' | 'OVER';
}

// ─── Monthly Snapshot ────────────────────────────────────────────────────────

export interface MonthlySnapshot {
  id?: string;
  month: string; // YYYY-MM
  totalIncome: number;
  totalExpense: number;
  netSavings: number;
  fundResults: FundSnapshotEntry[];
  closedAt: string;
}

export interface FundSnapshotEntry {
  fundId: string;
  fundName: string;
  allocated: number;
  spent: number;
  remaining: number;
}

// ─── Gmail Connection & Sync ──────────────────────────────────────────────────

export interface GmailAccountInfo {
  id: string;
  googleSub: string;
  email: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  connectedAt: string;
  lastSyncAt?: string | null;
  connectionStatus: 'connected' | 'error' | 'syncing' | 'reconnect_required';
}

export type SyncMode = 'QUICK' | 'HISTORICAL';

export interface QuickScanBounds {
  lowerBoundEpoch: number;
  quickScanUpperBoundEpoch: number;
}

export interface AccountSyncResult {
  accountId: string;
  email: string;
  fetchedCount: number;
  newCount: number;
  duplicateCount: number;
  failedCount: number;
  status: 'ok' | 'reconnect_required' | 'error';
  errorMessage?: string;
  truncated?: boolean;
  nextPageToken?: string;
  quickScanBounds?: QuickScanBounds;
}

export interface SyncResultStats {
  mode?: SyncMode;
  totalFetched: number;
  totalNew: number;
  totalDuplicates: number;
  totalFailed: number;
  accountEmail?: string;
  dateRange?: string;
  truncated?: boolean;
  nextPageToken?: string;
  accountResults?: AccountSyncResult[];
  accountContinuationTokens?: Record<string, string>;
  quickScanBounds?: Record<string, QuickScanBounds>;
}

// ─── Savings Forecast ───────────────────────────────────────────────────────

export interface SavingsProjection {
  currentCumulativeSavings: number;
  averageMonthlySavings: number;
  monthsOfData: number;
  projections: ProjectionPoint[];
}

export interface ProjectionPoint {
  month: string;
  projected: number;
  isActual: boolean;
}

// ─── Paper Trading ──────────────────────────────────────────────────────────

export type TradeDirection = 'LONG' | 'SHORT';
export type TradeStatus = 'OPEN' | 'PROFIT' | 'LOSS' | 'LIQUIDATED';

export interface PaperTradeScenario {
  id: string;
  instrument: string;
  direction: TradeDirection;
  entryPrice: number;
  currentPrice: number;
  margin: number;
  leverage: number;
  stopLoss?: number;
  takeProfit?: number;
  feePercent: number;
  createdAt: string;
  status: TradeStatus;
}

export interface MarketCandle {
  time: number; // unix timestamp
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

// ─── Navigation ─────────────────────────────────────────────────────────────

export type AppTab = 'dashboard' | 'cashflow' | 'funds' | 'forecast' | 'trading' | 'settings';

// ─── Toast ──────────────────────────────────────────────────────────────────

export interface ToastNotification {
  id: string;
  text: string;
  type: 'error' | 'info' | 'success';
}
