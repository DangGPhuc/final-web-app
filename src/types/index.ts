export type WalletType = 'CASH' | 'BANK' | 'CREDIT' | 'SAVINGS';

export interface Wallet {
  id: string;
  name: string;
  type: WalletType;
  balance: number;
  initialBalance: number;
  currency: string;
  bankName?: string;
  accountNumber?: string;
  creditLimit?: number;
  interestRate?: number;
  color: string;
  icon: string;
  isExcludedFromTotal?: boolean;
  createdAt: string;
}

export type TransactionType = 'EXPENSE' | 'INCOME' | 'TRANSFER';

export interface Category {
  id: string;
  name: string;
  type: 'EXPENSE' | 'INCOME';
  icon: string;
  color: string;
}

export interface Transaction {
  id: string;
  type: TransactionType;
  amount: number;
  categoryId?: string;
  categoryName?: string;
  walletId: string;
  walletName?: string;
  toWalletId?: string;
  toWalletName?: string;
  fee?: number;
  date: string; // ISO string
  note: string;
  tags: string[];
  receiptImage?: string; // Data URL
  createdAt: string;
}

export interface Budget {
  id: string;
  categoryId: string;
  categoryName: string;
  amount: number;
  month: string; // YYYY-MM
  alertThreshold80?: boolean;
  alertThreshold100?: boolean;
}

export interface IncomeBudgetPlanner {
  monthlyIncome: number;
  needsPercent: number; // e.g. 50
  wantsPercent: number; // e.g. 30
  savingsPercent: number; // e.g. 20
  notes?: string;
}

export type BillFrequency = 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
export type BillStatus = 'PAID' | 'UNPAID';

export interface RecurringBill {
  id: string;
  name: string;
  amount: number;
  categoryId: string;
  categoryName?: string;
  walletId?: string;
  dueDay: number; // 1-31
  frequency: BillFrequency;
  status: BillStatus;
  lastPaidDate?: string;
  note?: string;
  reminderDaysBefore?: number;
}

export interface SavingsGoal {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  deadline: string; // YYYY-MM-DD
  color: string;
  icon: string;
  category?: string;
  history: {
    id: string;
    date: string;
    amount: number;
    type: 'DEPOSIT' | 'WITHDRAW';
    walletId?: string;
    note?: string;
  }[];
  createdAt: string;
}

export interface FinancialSummary {
  totalAssets: number; // Cash + Bank + Savings - Credit Card Debt
  availableBalance: number; // Cash + Bank
  totalCreditDebt: number;
  totalSavings: number;
  monthlyIncome: number;
  monthlyExpense: number;
  netSavingsThisMonth: number;
  savingsRate: number; // percentage
}

export type FilterPeriod = 'THIS_WEEK' | 'THIS_MONTH' | 'LAST_MONTH' | 'THIS_YEAR' | 'CUSTOM';
