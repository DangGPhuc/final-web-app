'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  Wallet,
  Transaction,
  Category,
  Budget,
  RecurringBill,
  SavingsGoal,
  IncomeBudgetPlanner,
  FinancialSummary,
} from '@/types';
import {
  INITIAL_WALLETS,
  INITIAL_TRANSACTIONS,
  INITIAL_BUDGETS,
  INITIAL_BILLS,
  INITIAL_GOALS,
  INITIAL_PLANNER,
} from '@/lib/mock-data';
import { DEFAULT_CATEGORIES } from '@/lib/constants';
import {
  calculateFinancialSummary,
  applyAddTransaction,
  applyEditTransaction,
  applyDeleteTransaction,
  applyGoalDeposit,
  applyGoalWithdraw,
  applyDeleteGoal,
  applyEditGoal,
  applyAddBill,
  applyEditBill,
  applyDeleteBill,
  applyPayBill,
  applyUnpayBill,
  applyDeleteWallet,
  applyEditWallet,
  applyAddWallet,
  validateTransferFee,
  applyAddGoal,
  applyAddBudget,
  applyEditBudget,
  applyDeleteBudget,
  applyUpdatePlanner,
} from '@/lib/domain-engine';
import { getCurrentYearMonth } from '@/lib/utils';
import {
  validateAndNormalizeAppSnapshot,
  StorageStatus,
  SCHEMA_VERSION,
  MAX_IMPORT_BYTES,
} from '@/lib/storage-schema';
import { safeErrorMessage } from '@/lib/error';

interface AppContextType {
  wallets: Wallet[];
  transactions: Transaction[];
  categories: Category[];
  budgets: Budget[];
  bills: RecurringBill[];
  goals: SavingsGoal[];
  planner: IncomeBudgetPlanner;
  currentMonth: string;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  quickAddOpen: boolean;
  setQuickAddOpen: (open: boolean) => void;
  quickAddDefaultType: 'EXPENSE' | 'INCOME' | 'TRANSFER';
  openQuickAdd: (type?: 'EXPENSE' | 'INCOME' | 'TRANSFER') => void;
  financialSummary: FinancialSummary;

  /** Storage lifecycle status — exposed to UI for banners/warnings */
  storageStatus: StorageStatus;
  /** Human-readable storage error, set when storageStatus is RECOVERY_REQUIRED or SAVE_ERROR */
  storageError: string | undefined;
  /** Retry last failed save */
  retrySave: () => void;

  // Transactions
  addTransaction: (tx: Omit<Transaction, 'id' | 'createdAt'>) => void;
  editTransaction: (id: string, tx: Partial<Transaction>) => void;
  deleteTransaction: (id: string) => void;

  // Wallets
  addWallet: (wallet: Omit<Wallet, 'id' | 'createdAt'>) => void;
  editWallet: (id: string, wallet: Partial<Wallet>) => void;
  deleteWallet: (id: string) => void;
  transferFunds: (fromWalletId: string, toWalletId: string, amount: number, fee: number, note?: string) => void;

  // Budgets
  addBudget: (budget: Omit<Budget, 'id'>) => void;
  editBudget: (id: string, budget: Partial<Budget>) => void;
  deleteBudget: (id: string) => void;
  updatePlanner: (planner: IncomeBudgetPlanner) => void;

  // Bills
  addBill: (bill: Omit<RecurringBill, 'id'>) => void;
  editBill: (id: string, bill: Partial<RecurringBill>) => void;
  deleteBill: (id: string) => void;
  payBill: (billId: string, walletId: string) => void;
  unpayBill: (billId: string) => void;

  // Goals
  addGoal: (goal: Omit<SavingsGoal, 'id' | 'createdAt' | 'history'>) => void;
  editGoal: (id: string, goal: Partial<SavingsGoal>) => void;
  deleteGoal: (id: string) => void;
  depositToGoal: (goalId: string, amount: number, walletId: string, note?: string) => void;
  withdrawFromGoal: (goalId: string, amount: number, walletId: string, note?: string) => void;

  // Backup & Reset
  resetToDefaultData: () => void;
  clearAllData: () => void;
  exportDatabaseJSON: () => void;
  importDatabaseJSON: (jsonStr: string) => boolean;

  // Domain error — shown by UI without blocking (replaces alert())
  lastDomainError: string | undefined;
  clearDomainError: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const STORAGE_KEY = 'quan_ly_chi_tieu_data_v2';

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mounted, setMounted] = useState(false);
  const [wallets, setWallets] = useState<Wallet[]>(INITIAL_WALLETS);
  const [transactions, setTransactions] = useState<Transaction[]>(INITIAL_TRANSACTIONS);
  const [categories, setCategories] = useState<Category[]>(DEFAULT_CATEGORIES);
  const [budgets, setBudgets] = useState<Budget[]>(INITIAL_BUDGETS);
  const [bills, setBills] = useState<RecurringBill[]>(INITIAL_BILLS);
  const [goals, setGoals] = useState<SavingsGoal[]>(INITIAL_GOALS);
  const [planner, setPlanner] = useState<IncomeBudgetPlanner>(INITIAL_PLANNER);
  const [currentMonth, setCurrentMonth] = useState<string>(getCurrentYearMonth());

  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [quickAddOpen, setQuickAddOpen] = useState<boolean>(false);
  const [quickAddDefaultType, setQuickAddDefaultType] = useState<'EXPENSE' | 'INCOME' | 'TRANSFER'>('EXPENSE');

  // Storage lifecycle
  const [storageStatus, setStorageStatus] = useState<StorageStatus>('LOADING');
  const [storageError, setStorageError] = useState<string | undefined>(undefined);

  // Domain error (non-blocking, replaces alert())
  const [lastDomainError, setLastDomainError] = useState<string | undefined>(undefined);
  const clearDomainError = useCallback(() => setLastDomainError(undefined), []);

  const reportDomainError = useCallback((msg: string) => {
    setLastDomainError(msg);
    // Also keep legacy alert for now — will be fully replaced once StorageStatusBanner is wired
    alert(msg);
  }, []);

  // Rollover currentMonth on focus, visibility change, and interval
  useEffect(() => {
    const checkMonthRollover = () => {
      const nowYm = getCurrentYearMonth();
      setCurrentMonth((prev) => (prev !== nowYm ? nowYm : prev));
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') checkMonthRollover();
    };
    window.addEventListener('focus', checkMonthRollover);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    const intervalId = setInterval(checkMonthRollover, 60000);
    return () => {
      window.removeEventListener('focus', checkMonthRollover);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(intervalId);
    };
  }, []);

  // ── Load from localStorage (safe recovery) ───────────────────────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          // Unparseable — preserve raw bytes, enter RECOVERY_REQUIRED
          const recoveryKey = `fintrack_recovery_corrupt_${Date.now()}`;
          try { localStorage.setItem(recoveryKey, raw); } catch { /* ignore quota */ }
          setStorageStatus('RECOVERY_REQUIRED');
          setStorageError('Dữ liệu lưu trữ không thể đọc được (JSON không hợp lệ). Bản sao phục hồi đã được lưu.');
          setMounted(true);
          return;
        }

        const res = validateAndNormalizeAppSnapshot(parsed);
        if (res.ok) {
          setWallets(res.data.wallets);
          setTransactions(res.data.transactions);
          setCategories(res.data.categories);
          setBudgets(res.data.budgets);
          setBills(res.data.bills);
          setGoals(res.data.goals);
          setPlanner(res.data.planner);
          setStorageStatus('OK');
        } else {
          // Validation failed — NEVER overwrite the original raw data automatically.
          // Preserve a recovery copy under a timestamped key.
          const recoveryKey = `fintrack_recovery_corrupt_${Date.now()}`;
          try { localStorage.setItem(recoveryKey, raw); } catch { /* ignore quota */ }
          setStorageStatus('RECOVERY_REQUIRED');
          setStorageError(`Dữ liệu không vượt qua kiểm tra tính toàn vẹn: ${res.error}. Bản sao phục hồi đã được lưu. Ứng dụng đang chạy với dữ liệu mặc định — dữ liệu sẽ KHÔNG bị ghi đè cho đến khi bạn xác nhận.`);
          // Load defaults in memory only — do NOT save yet
          setMounted(true);
          return;
        }
      } else {
        // No stored data — fresh start
        setStorageStatus('OK');
      }
    } catch (e) {
      console.error('[AppContext] Failed to load storage data:', safeErrorMessage(e));
      setStorageStatus('RECOVERY_REQUIRED');
      setStorageError('Không thể đọc dữ liệu từ bộ nhớ cục bộ.');
    }
    setMounted(true);
  }, []);

  // ── Save to localStorage ──────────────────────────────────────────────────
  const buildPayload = useCallback(() => ({
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    wallets,
    transactions,
    categories,
    budgets,
    bills,
    goals,
    planner,
  }), [wallets, transactions, categories, budgets, bills, goals, planner]);

  const saveToStorage = useCallback(() => {
    if (!mounted) return;
    // Do NOT save if we are in RECOVERY_REQUIRED — user must explicitly confirm
    if (storageStatus === 'RECOVERY_REQUIRED') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(buildPayload()));
      setStorageStatus('OK');
      setStorageError(undefined);
    } catch (e) {
      console.error('[AppContext] Failed to save to localStorage:', safeErrorMessage(e));
      setStorageStatus('SAVE_ERROR');
      setStorageError('Không thể lưu dữ liệu vào bộ nhớ. Hãy xuất bản sao lưu để tránh mất dữ liệu.');
    }
  }, [mounted, storageStatus, buildPayload]);

  useEffect(() => {
    saveToStorage();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, wallets, transactions, categories, budgets, bills, goals, planner]);

  const retrySave = useCallback(() => {
    if (!mounted) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(buildPayload()));
      setStorageStatus('OK');
      setStorageError(undefined);
    } catch (e) {
      setStorageStatus('SAVE_ERROR');
      setStorageError('Thử lại lưu thất bại. Vui lòng xuất bản sao lưu thủ công.');
    }
  }, [mounted, buildPayload]);

  const openQuickAdd = (type: 'EXPENSE' | 'INCOME' | 'TRANSFER' = 'EXPENSE') => {
    setQuickAddDefaultType(type);
    setQuickAddOpen(true);
  };

  // Financial summary
  const financialSummary = calculateFinancialSummary(wallets, transactions, currentMonth, goals);

  // Add Transaction
  const addTransaction = (tx: Omit<Transaction, 'id' | 'createdAt'>) => {
    const res = applyAddTransaction({ wallets, transactions, goals, bills }, tx);
    if (!res.ok) { reportDomainError(res.error); return; }
    setWallets(res.state.wallets);
    setTransactions(res.state.transactions);
  };

  // Edit Transaction
  const editTransaction = (id: string, updated: Partial<Transaction>) => {
    const res = applyEditTransaction({ wallets, transactions, goals, bills }, id, updated);
    if (!res.ok) { reportDomainError(res.error); return; }
    setWallets(res.state.wallets);
    setTransactions(res.state.transactions);
  };

  // Delete Transaction
  const deleteTransaction = (id: string) => {
    const res = applyDeleteTransaction({ wallets, transactions, goals, bills }, id);
    if (!res.ok) { reportDomainError(res.error); return; }
    setWallets(res.state.wallets);
    setTransactions(res.state.transactions);
  };

  // Wallets
  const addWallet = (wallet: Omit<Wallet, 'id' | 'createdAt'>) => {
    const res = applyAddWallet({ transactions, wallets, goals, bills }, wallet);
    if (!res.ok) { reportDomainError(res.error); return; }
    setWallets(res.state.wallets);
  };

  const editWallet = (id: string, updated: Partial<Wallet>) => {
    const res = applyEditWallet({ wallets, transactions, goals, bills }, id, updated);
    if (!res.ok) { reportDomainError(res.error); return; }
    setWallets(res.state.wallets);
  };

  const deleteWallet = (id: string) => {
    const res = applyDeleteWallet({ wallets, transactions, goals, bills }, id);
    if (!res.ok) { reportDomainError(res.error); return; }
    setWallets(res.state.wallets);
  };

  const transferFunds = (
    fromWalletId: string,
    toWalletId: string,
    amount: number,
    fee: number,
    note?: string
  ) => {
    const fromW = wallets.find((w) => w.id === fromWalletId);
    const toW = wallets.find((w) => w.id === toWalletId);
    if (!fromW || !toW) { reportDomainError('Không tìm thấy thông tin ví'); return; }

    const feeCheck = validateTransferFee(fee);
    if (!feeCheck.valid) { reportDomainError(feeCheck.error || 'Phí chuyển khoản không hợp lệ'); return; }

    addTransaction({
      type: 'TRANSFER',
      amount,
      fee: feeCheck.fee,
      walletId: fromWalletId,
      walletName: fromW.name,
      toWalletId,
      toWalletName: toW.name,
      date: new Date().toISOString(),
      note: note || (toW.type === 'CREDIT' ? `Thanh toán dư nợ thẻ ${toW.name}` : `Chuyển khoản từ ${fromW.name} sang ${toW.name}`),
      tags: [toW.type === 'CREDIT' ? 'Thanh toán thẻ tín dụng' : 'Chuyển khoản nội bộ'],
      transferKind: toW.type === 'CREDIT' ? 'CREDIT_PAYMENT' : 'WALLET_TRANSFER',
      origin: 'MANUAL',
    });
  };

  // Budgets — pass categories for §5 validation
  const addBudget = (budget: Omit<Budget, 'id'>) => {
    const res = applyAddBudget(budgets, budget, categories);
    if (!res.ok) { reportDomainError(res.error); return; }
    setBudgets(res.budgets);
  };

  const editBudget = (id: string, updated: Partial<Budget>) => {
    const res = applyEditBudget(budgets, id, updated, categories);
    if (!res.ok) { reportDomainError(res.error); return; }
    setBudgets(res.budgets);
  };

  const deleteBudget = (id: string) => {
    const res = applyDeleteBudget(budgets, id);
    if (!res.ok) { reportDomainError(res.error); return; }
    setBudgets(res.budgets);
  };

  const updatePlanner = (newPlanner: IncomeBudgetPlanner) => {
    const res = applyUpdatePlanner(newPlanner);
    if (!res.ok) { reportDomainError(res.error); return; }
    setPlanner(res.planner);
  };

  // Bills
  const addBill = (bill: Omit<RecurringBill, 'id'>) => {
    const res = applyAddBill({ wallets, transactions, goals, bills }, bill);
    if (!res.ok) { reportDomainError(res.error); return; }
    setBills(res.state.bills);
  };

  const editBill = (id: string, updated: Partial<RecurringBill>) => {
    const res = applyEditBill({ wallets, transactions, goals, bills }, id, updated);
    if (!res.ok) { reportDomainError(res.error); return; }
    setBills(res.state.bills);
  };

  const deleteBill = (id: string) => {
    const res = applyDeleteBill({ wallets, transactions, goals, bills }, id);
    if (!res.ok) { reportDomainError(res.error); return; }
    setBills(res.state.bills);
  };

  const payBill = (billId: string, walletId: string) => {
    const res = applyPayBill({ wallets, transactions, goals, bills }, billId, walletId);
    if (!res.ok) { reportDomainError(res.error); return; }
    setWallets(res.state.wallets);
    setBills(res.state.bills);
    setTransactions(res.state.transactions);
  };

  const unpayBill = (billId: string) => {
    const res = applyUnpayBill({ wallets, transactions, goals, bills }, billId);
    if (!res.ok) { reportDomainError(res.error); return; }
    setWallets(res.state.wallets);
    setBills(res.state.bills);
    setTransactions(res.state.transactions);
  };

  // Goals
  const addGoal = (goal: Omit<SavingsGoal, 'id' | 'createdAt' | 'history'>) => {
    const res = applyAddGoal({ wallets, transactions, goals, bills }, goal);
    if (!res.ok) { reportDomainError(res.error); return; }
    setGoals(res.state.goals);
  };

  const editGoal = (id: string, updated: Partial<SavingsGoal>) => {
    const res = applyEditGoal({ wallets, transactions, goals, bills }, id, updated);
    if (!res.ok) { reportDomainError(res.error); return; }
    setGoals(res.state.goals);
  };

  const deleteGoal = (id: string) => {
    const res = applyDeleteGoal({ wallets, transactions, goals, bills }, id);
    if (!res.ok) { reportDomainError(res.error); return; }
    setGoals(res.state.goals);
  };

  const depositToGoal = (goalId: string, amount: number, walletId: string, note?: string) => {
    const res = applyGoalDeposit({ wallets, transactions, goals, bills }, goalId, walletId, amount, note);
    if (!res.ok) { reportDomainError(res.error); return; }
    setWallets(res.state.wallets);
    setGoals(res.state.goals);
    setTransactions(res.state.transactions);
  };

  const withdrawFromGoal = (goalId: string, amount: number, walletId: string, note?: string) => {
    const res = applyGoalWithdraw({ wallets, transactions, goals, bills }, goalId, walletId, amount, note);
    if (!res.ok) { reportDomainError(res.error); return; }
    setWallets(res.state.wallets);
    setGoals(res.state.goals);
    setTransactions(res.state.transactions);
  };

  // Backup & Reset
  const resetToDefaultData = () => {
    setWallets(INITIAL_WALLETS);
    setTransactions(INITIAL_TRANSACTIONS);
    setCategories(DEFAULT_CATEGORIES);
    setBudgets(INITIAL_BUDGETS);
    setBills(INITIAL_BILLS);
    setGoals(INITIAL_GOALS);
    setPlanner(INITIAL_PLANNER);
    localStorage.removeItem(STORAGE_KEY);
    setStorageStatus('OK');
    setStorageError(undefined);
  };

  const clearAllData = () => {
    setWallets([
      {
        id: 'wal-cash-empty',
        name: 'Tiền mặt',
        type: 'CASH',
        balance: 0,
        initialBalance: 0,
        currency: 'VND',
        color: '#10b981',
        icon: 'Banknote',
        createdAt: new Date().toISOString(),
      },
    ]);
    setTransactions([]);
    setBudgets([]);
    setBills([]);
    setGoals([]);
    setPlanner({ monthlyIncome: 0, needsPercent: 50, wantsPercent: 30, savingsPercent: 20 });
  };

  const exportDatabaseJSON = () => {
    const data = {
      schemaVersion: SCHEMA_VERSION,
      applicationVersion: '2.0.0',
      exportedAt: new Date().toISOString(),
      wallets,
      transactions,
      categories,
      budgets,
      bills,
      goals,
      planner,
    };
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const dateStr = new Date().toISOString().slice(0, 10);
    link.download = `fintrack-backup-${dateStr}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importDatabaseJSON = (jsonStr: string): boolean => {
    // Reject oversized payloads before parsing
    if (jsonStr.length > MAX_IMPORT_BYTES) {
      reportDomainError(`Tệp dữ liệu quá lớn (${(jsonStr.length / 1024 / 1024).toFixed(1)} MB). Giới hạn là ${MAX_IMPORT_BYTES / 1024 / 1024} MB.`);
      return false;
    }

    let data: unknown;
    try {
      data = JSON.parse(jsonStr);
    } catch {
      reportDomainError('Tệp dữ liệu không phải định dạng JSON hợp lệ');
      return false;
    }

    // Full migration + validation — existing state is NOT touched until this passes
    const res = validateAndNormalizeAppSnapshot(data);
    if (!res.ok) {
      console.error('[AppContext] Import failed:', res.error);
      reportDomainError(`Dữ liệu nhập không hợp lệ: ${res.error}`);
      return false;
    }

    // Atomic swap — only executed after successful validation
    setWallets(res.data.wallets);
    setTransactions(res.data.transactions);
    setCategories(res.data.categories);
    setBudgets(res.data.budgets);
    setBills(res.data.bills);
    setGoals(res.data.goals);
    setPlanner(res.data.planner);
    setStorageStatus('OK');
    setStorageError(undefined);
    return true;
  };

  return (
    <AppContext.Provider
      value={{
        wallets,
        transactions,
        categories,
        budgets,
        bills,
        goals,
        planner,
        currentMonth,
        activeTab,
        setActiveTab,
        quickAddOpen,
        setQuickAddOpen,
        quickAddDefaultType,
        openQuickAdd,
        financialSummary,
        storageStatus,
        storageError,
        retrySave,
        addTransaction,
        editTransaction,
        deleteTransaction,
        addWallet,
        editWallet,
        deleteWallet,
        transferFunds,
        addBudget,
        editBudget,
        deleteBudget,
        updatePlanner,
        addBill,
        editBill,
        deleteBill,
        payBill,
        unpayBill,
        addGoal,
        editGoal,
        deleteGoal,
        depositToGoal,
        withdrawFromGoal,
        resetToDefaultData,
        clearAllData,
        exportDatabaseJSON,
        importDatabaseJSON,
        lastDomainError,
        clearDomainError,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
