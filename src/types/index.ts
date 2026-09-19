// ─── Personal Finance Cockpit — Domain Types ────────────────────────────────

// ─── Transaction ─────────────────────────────────────────────────────────────

export type TransactionSource = 'EMAIL' | 'MANUAL';
export type TransactionDirection = 'IN' | 'OUT';
export type TransactionStatus = 'POSTED' | 'NEEDS_REVIEW' | 'IGNORED';

export interface Transaction {
  id: string;
  source: TransactionSource;
  sourceMessageId?: string;
  sourceProvider?: string;
  bank?: string;
  accountHint?: string;
  direction: TransactionDirection;
  amount: number;
  currency: string;
  occurredAt: string; // ISO string
  counterparty?: string;
  description: string;
  category: string;
  fundId?: string;
  status: TransactionStatus;
  parserConfidence?: number;
  rawSubject?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Fund ────────────────────────────────────────────────────────────────────

export interface Fund {
  id: string;
  name: string;
  monthlyAllocation: number;
  categoryMappings: string[];
  merchantMappings: string[];
  createdAt: string;
  active: boolean;
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

// ─── Email Integration ──────────────────────────────────────────────────────

export interface EmailMessage {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  body?: string;
  receivedAt: string;
  labels?: string[];
}

export interface EmailConnectionState {
  provider: 'gmail' | 'none';
  connected: boolean;
  email?: string;
  lastSyncAt?: string;
  syncStatus: 'idle' | 'syncing' | 'error';
  syncError?: string;
}

export interface EmailSyncState {
  lastSyncAt?: string;
  totalSynced: number;
  totalSkipped: number;
  totalNeedsReview: number;
}

export interface EmailParserRule {
  id: string;
  name: string;
  senderPattern: string;
  subjectPattern?: string;
  bankCode?: string;
  active: boolean;
}

// ─── Classification ─────────────────────────────────────────────────────────

export interface MerchantRule {
  id: string;
  pattern: string;
  category: string;
  fundId?: string;
  createdAt: string;
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
  time: number;    // unix timestamp
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

// ─── Settings ───────────────────────────────────────────────────────────────

export interface AppSettings {
  openingBalance: number;
  defaultCurrency: string;
  trustedSenders: string[];
  autoPostMinConfidence: number;
}

// ─── App State ──────────────────────────────────────────────────────────────

export interface AppDataSnapshot {
  schemaVersion: number;
  exportedAt: string;
  transactions: Transaction[];
  funds: Fund[];
  monthlySnapshots: MonthlySnapshot[];
  merchantRules: MerchantRule[];
  emailParserRules: EmailParserRule[];
  paperTrades: PaperTradeScenario[];
  settings: AppSettings;
}

// ─── Navigation ─────────────────────────────────────────────────────────────

export type AppTab = 'dashboard' | 'cashflow' | 'funds' | 'forecast' | 'trading' | 'settings';

// ─── Default Categories ─────────────────────────────────────────────────────

export const DEFAULT_CATEGORIES = [
  'Lương',
  'Thưởng',
  'Thu nhập khác',
  'Ăn uống',
  'Di chuyển',
  'Mua sắm',
  'Hóa đơn',
  'Nhà cửa',
  'Giải trí',
  'Sức khỏe',
  'Giáo dục',
  'Đầu tư',
  'Khác',
] as const;

export type CategoryName = (typeof DEFAULT_CATEGORIES)[number];

// ─── Toast ──────────────────────────────────────────────────────────────────

export interface ToastNotification {
  id: string;
  text: string;
  type: 'error' | 'info' | 'success';
}
