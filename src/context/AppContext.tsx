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
  getCurrentYearMonth,
} from '@/lib/utils';
import { safeErrorMessage } from '@/lib/error';
import {
  applyAddTransaction,
  applyEditTransaction,
  applyDeleteTransaction,
  validateTransferFee,
  applyAddWallet,
  applyEditWallet,
  applyDeleteWallet,
  applyAddBudget,
  applyEditBudget,
  applyDeleteBudget,
  applyUpdatePlanner,
  applyPayBill,
  applyUnpayBill,
  applyAddBill,
  applyEditBill,
  applyDeleteBill,
  applyAddGoal,
  applyEditGoal,
  applyDeleteGoal,
  applyGoalDeposit,
  applyGoalWithdraw,
} from '@/lib/domain-engine';
import {
  SCHEMA_VERSION,
  MAX_IMPORT_BYTES,
  StorageStatus,
  validateAndNormalizeAppSnapshot,
  getUtf8ByteLength,
} from '@/lib/storage-schema';
import {
  StorageAdapter,
  loadStorageSnapshot,
  persistStorageSnapshot,
} from '@/lib/storage-service';

export interface ToastNotification {
  id: string;
  text: string;
  type: 'error' | 'info' | 'success';
}

interface AppContextType {
  wallets: Wallet[];
  transactions: Transaction[];
  categories: Category[];
  budgets: Budget[];
  bills: RecurringBill[];
  goals: SavingsGoal[];
  planner: IncomeBudgetPlanner;
  currentMonth: string;

  // Navigation
  activeTab: string;
  setActiveTab: (tab: string) => void;
  quickAddOpen: boolean;
  setQuickAddOpen: (open: boolean) => void;
  quickAddDefaultType: 'EXPENSE' | 'INCOME' | 'TRANSFER';
  openQuickAdd: (type?: 'EXPENSE' | 'INCOME' | 'TRANSFER') => void;
  financialSummary: FinancialSummary;

  /** Storage lifecycle status — exposed to UI for banners/warnings */
  storageStatus: StorageStatus;
  storageError: string | undefined;
  recoveryCopySaved: boolean;
  recoveryKey: string | undefined;
  recoveryRawData: string | undefined;
  retrySave: () => void;
  downloadRawRecoveryData: () => void;

  // Transactions (return result so UI closes only on success)
  addTransaction: (tx: Omit<Transaction, 'id' | 'createdAt'>) => { ok: true } | { ok: false; error: string };
  editTransaction: (id: string, tx: Partial<Transaction>) => { ok: true } | { ok: false; error: string };
  deleteTransaction: (id: string) => { ok: true } | { ok: false; error: string };

  // Wallets
  addWallet: (wallet: Omit<Wallet, 'id' | 'createdAt'>) => { ok: true } | { ok: false; error: string };
  editWallet: (id: string, wallet: Partial<Wallet>) => { ok: true } | { ok: false; error: string };
  deleteWallet: (id: string) => { ok: true } | { ok: false; error: string };
  transferFunds: (fromWalletId: string, toWalletId: string, amount: number, fee: number, note?: string) => { ok: true } | { ok: false; error: string };

  // Budgets
  addBudget: (budget: Omit<Budget, 'id'>) => { ok: true } | { ok: false; error: string };
  editBudget: (id: string, budget: Partial<Budget>) => { ok: true } | { ok: false; error: string };
  deleteBudget: (id: string) => { ok: true } | { ok: false; error: string };
  updatePlanner: (planner: IncomeBudgetPlanner) => { ok: true } | { ok: false; error: string };

  // Bills
  addBill: (bill: Omit<RecurringBill, 'id'>) => { ok: true } | { ok: false; error: string };
  editBill: (id: string, bill: Partial<RecurringBill>) => { ok: true } | { ok: false; error: string };
  deleteBill: (id: string) => { ok: true } | { ok: false; error: string };
  payBill: (billId: string, walletId: string) => { ok: true } | { ok: false; error: string };
  unpayBill: (billId: string) => { ok: true } | { ok: false; error: string };

  // Goals
  addGoal: (goal: Omit<SavingsGoal, 'id' | 'createdAt' | 'history'>) => { ok: true } | { ok: false; error: string };
  editGoal: (id: string, goal: Partial<SavingsGoal>) => { ok: true } | { ok: false; error: string };
  deleteGoal: (id: string) => { ok: true } | { ok: false; error: string };
  depositToGoal: (goalId: string, amount: number, walletId: string, note?: string) => { ok: true } | { ok: false; error: string };
  withdrawFromGoal: (goalId: string, amount: number, walletId: string, note?: string) => { ok: true } | { ok: false; error: string };

  // Backup & Reset
  resetToDefaultData: () => void;
  clearAllData: () => void;
  exportDatabaseJSON: () => void;
  importDatabaseJSON: (jsonStr: string) => boolean;

  // Non-blocking user feedback
  lastDomainError: string | undefined;
  clearDomainError: () => void;
  toastMessage: ToastNotification | null;
  dismissToast: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const STORAGE_KEY = 'quan_ly_chi_tieu_data_v2';

const browserStorageAdapter: StorageAdapter = {
  getItem: (key) => (typeof window !== 'undefined' ? localStorage.getItem(key) : null),
  setItem: (key, val) => {
    if (typeof window !== 'undefined') localStorage.setItem(key, val);
  },
  removeItem: (key) => {
    if (typeof window !== 'undefined') localStorage.removeItem(key);
  },
};

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
  const [recoveryCopySaved, setRecoveryCopySaved] = useState<boolean>(false);
  const [recoveryKey, setRecoveryKey] = useState<string | undefined>(undefined);
  const [recoveryRawData, setRecoveryRawData] = useState<string | undefined>(undefined);

  // Non-blocking toast feedback
  const [lastDomainError, setLastDomainError] = useState<string | undefined>(undefined);
  const [toastMessage, setToastMessage] = useState<ToastNotification | null>(null);

  const clearDomainError = useCallback(() => setLastDomainError(undefined), []);
  const dismissToast = useCallback(() => setToastMessage(null), []);

  const reportDomainError = useCallback((msg: string) => {
    setLastDomainError(msg);
    setToastMessage({ id: String(Date.now()), text: msg, type: 'error' });
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

  // ── Load from storage via StorageService ──────────────────────────────────
  useEffect(() => {
    try {
      const res = loadStorageSnapshot(browserStorageAdapter, STORAGE_KEY);
      if (res.status === 'OK') {
        if (res.data) {
          setWallets(res.data.wallets);
          setTransactions(res.data.transactions);
          setCategories(res.data.categories);
          setBudgets(res.data.budgets);
          setBills(res.data.bills);
          setGoals(res.data.goals);
          setPlanner(res.data.planner);
        }
        setStorageStatus('OK');
      } else {
        setStorageStatus('RECOVERY_REQUIRED');
        setStorageError(res.error);
        setRecoveryCopySaved(res.recoveryCopySaved);
        setRecoveryKey(res.recoveryKey);
        setRecoveryRawData(res.recoveryRawData);
      }
    } catch (e) {
      console.error('[AppContext] Failed to load storage data:', safeErrorMessage(e));
      setStorageStatus('RECOVERY_REQUIRED');
      setStorageError('Không thể nạp dữ liệu từ bộ nhớ.');
    }
    setMounted(true);
  }, []);

  // ── Save to storage via StorageService ───────────────────────────────────
  const buildPayload = useCallback(
    () => ({
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      wallets,
      transactions,
      categories,
      budgets,
      bills,
      goals,
      planner,
    }),
    [wallets, transactions, categories, budgets, bills, goals, planner]
  );

  const saveToStorage = useCallback(() => {
    if (!mounted) return;
    if (storageStatus === 'RECOVERY_REQUIRED') return;

    const payload = buildPayload();
    const res = persistStorageSnapshot(browserStorageAdapter, STORAGE_KEY, payload);

    if (res.ok) {
      setStorageStatus('OK');
      setStorageError(undefined);
    } else {
      setStorageStatus('SAVE_ERROR');
      setStorageError(res.error);
    }
  }, [mounted, storageStatus, buildPayload]);

  useEffect(() => {
    saveToStorage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, wallets, transactions, categories, budgets, bills, goals, planner]);

  const retrySave = useCallback(() => {
    if (!mounted) return;
    saveToStorage();
  }, [mounted, saveToStorage]);

  const downloadRawRecoveryData = useCallback(() => {
    if (!recoveryRawData) return;
    const blob = new Blob([recoveryRawData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `fintrack_raw_recovery_${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [recoveryRawData]);

  const openQuickAdd = (type: 'EXPENSE' | 'INCOME' | 'TRANSFER' = 'EXPENSE') => {
    setQuickAddDefaultType(type);
    setQuickAddOpen(true);
  };

  // Financial summary
  const financialSummary = calculateFinancialSummary(wallets, transactions, currentMonth, goals);

  // ── Domain Mutations (Returning Status for UI Control) ─────────────────────

  const addTransaction = (
    tx: Omit<Transaction, 'id' | 'createdAt'>
  ): { ok: true } | { ok: false; error: string } => {
    const res = applyAddTransaction({ wallets, transactions, goals, bills }, tx);
    if (!res.ok) {
      reportDomainError(res.error);
      return { ok: false, error: res.error };
    }
    setWallets(res.state.wallets);
    setTransactions(res.state.transactions);
    return { ok: true };
  };

  const editTransaction = (
    id: string,
    updated: Partial<Transaction>
  ): { ok: true } | { ok: false; error: string } => {
    const res = applyEditTransaction({ wallets, transactions, goals, bills }, id, updated);
    if (!res.ok) {
      reportDomainError(res.error);
      return { ok: false, error: res.error };
    }
    setWallets(res.state.wallets);
    setTransactions(res.state.transactions);
    return { ok: true };
  };

  const deleteTransaction = (id: string): { ok: true } | { ok: false; error: string } => {
    const res = applyDeleteTransaction({ wallets, transactions, goals, bills }, id);
    if (!res.ok) {
      reportDomainError(res.error);
      return { ok: false, error: res.error };
    }
    setWallets(res.state.wallets);
    setTransactions(res.state.transactions);
    return { ok: true };
  };

  const addWallet = (
    wallet: Omit<Wallet, 'id' | 'createdAt'>
  ): { ok: true } | { ok: false; error: string } => {
    const res = applyAddWallet({ wallets, transactions, goals, bills }, wallet);
    if (!res.ok) {
      reportDomainError(res.error);
      return { ok: false, error: res.error };
    }
    setWallets(res.state.wallets);
    return { ok: true };
  };

  const editWallet = (
    id: string,
    updates: Partial<Wallet>
  ): { ok: true } | { ok: false; error: string } => {
    const res = applyEditWallet({ wallets, transactions, goals, bills }, id, updates);
    if (!res.ok) {
      reportDomainError(res.error);
      return { ok: false, error: res.error };
    }
    setWallets(res.state.wallets);
    return { ok: true };
  };

  const deleteWallet = (id: string): { ok: true } | { ok: false; error: string } => {
    const res = applyDeleteWallet({ wallets, transactions, goals, bills }, id);
    if (!res.ok) {
      reportDomainError(res.error);
      return { ok: false, error: res.error };
    }
    setWallets(res.state.wallets);
    return { ok: true };
  };

  const transferFunds = (
    fromWalletId: string,
    toWalletId: string,
    amount: number,
    fee: number,
    note?: string
  ): { ok: true } | { ok: false; error: string } => {
    const fromW = wallets.find((w) => w.id === fromWalletId);
    const toW = wallets.find((w) => w.id === toWalletId);
    if (!fromW || !toW) {
      const err = 'Không tìm thấy thông tin ví';
      reportDomainError(err);
      return { ok: false, error: err };
    }

    const feeCheck = validateTransferFee(fee);
    if (!feeCheck.valid) {
      const err = feeCheck.error || 'Phí chuyển khoản không hợp lệ';
      reportDomainError(err);
      return { ok: false, error: err };
    }

    return addTransaction({
      type: 'TRANSFER',
      amount,
      fee: feeCheck.fee,
      walletId: fromWalletId,
      walletName: fromW.name,
      toWalletId,
      toWalletName: toW.name,
      date: new Date().toISOString(),
      note:
        note ||
        (toW.type === 'CREDIT'
          ? `Thanh toán dư nợ thẻ ${toW.name}`
          : `Chuyển khoản từ ${fromW.name} sang ${toW.name}`),
      tags: [toW.type === 'CREDIT' ? 'Thanh toán thẻ tín dụng' : 'Chuyển khoản nội bộ'],
      transferKind: toW.type === 'CREDIT' ? 'CREDIT_PAYMENT' : 'WALLET_TRANSFER',
      origin: 'MANUAL',
    });
  };

  const addBudget = (
    budget: Omit<Budget, 'id'>
  ): { ok: true } | { ok: false; error: string } => {
    const res = applyAddBudget(budgets, budget, categories);
    if (!res.ok) {
      reportDomainError(res.error);
      return { ok: false, error: res.error };
    }
    setBudgets(res.budgets);
    return { ok: true };
  };

  const editBudget = (
    id: string,
    updates: Partial<Budget>
  ): { ok: true } | { ok: false; error: string } => {
    const res = applyEditBudget(budgets, id, updates, categories);
    if (!res.ok) {
      reportDomainError(res.error);
      return { ok: false, error: res.error };
    }
    setBudgets(res.budgets);
    return { ok: true };
  };

  const deleteBudget = (id: string): { ok: true } | { ok: false; error: string } => {
    const res = applyDeleteBudget(budgets, id);
    if (!res.ok) {
      reportDomainError(res.error);
      return { ok: false, error: res.error };
    }
    setBudgets(res.budgets);
    return { ok: true };
  };

  const updatePlanner = (
    newPlanner: IncomeBudgetPlanner
  ): { ok: true } | { ok: false; error: string } => {
    const res = applyUpdatePlanner(newPlanner);
    if (!res.ok) {
      reportDomainError(res.error);
      return { ok: false, error: res.error };
    }
    setPlanner(res.planner);
    return { ok: true };
  };

  const addBill = (
    bill: Omit<RecurringBill, 'id'>
  ): { ok: true } | { ok: false; error: string } => {
    const res = applyAddBill({ wallets, transactions, goals, bills }, bill);
    if (!res.ok) {
      reportDomainError(res.error);
      return { ok: false, error: res.error };
    }
    setBills(res.state.bills);
    return { ok: true };
  };

  const editBill = (
    id: string,
    updates: Partial<RecurringBill>
  ): { ok: true } | { ok: false; error: string } => {
    const res = applyEditBill({ wallets, transactions, goals, bills }, id, updates);
    if (!res.ok) {
      reportDomainError(res.error);
      return { ok: false, error: res.error };
    }
    setBills(res.state.bills);
    return { ok: true };
  };

  const deleteBill = (id: string): { ok: true } | { ok: false; error: string } => {
    const res = applyDeleteBill({ wallets, transactions, goals, bills }, id);
    if (!res.ok) {
      reportDomainError(res.error);
      return { ok: false, error: res.error };
    }
    setBills(res.state.bills);
    return { ok: true };
  };

  const payBill = (
    billId: string,
    walletId: string
  ): { ok: true } | { ok: false; error: string } => {
    const res = applyPayBill({ wallets, transactions, goals, bills }, billId, walletId);
    if (!res.ok) {
      reportDomainError(res.error);
      return { ok: false, error: res.error };
    }
    setWallets(res.state.wallets);
    setBills(res.state.bills);
    setTransactions(res.state.transactions);
    return { ok: true };
  };

  const unpayBill = (billId: string): { ok: true } | { ok: false; error: string } => {
    const res = applyUnpayBill({ wallets, transactions, goals, bills }, billId);
    if (!res.ok) {
      reportDomainError(res.error);
      return { ok: false, error: res.error };
    }
    setWallets(res.state.wallets);
    setBills(res.state.bills);
    setTransactions(res.state.transactions);
    return { ok: true };
  };

  const addGoal = (
    goal: Omit<SavingsGoal, 'id' | 'createdAt' | 'history'>
  ): { ok: true } | { ok: false; error: string } => {
    const res = applyAddGoal({ wallets, transactions, goals, bills }, goal);
    if (!res.ok) {
      reportDomainError(res.error);
      return { ok: false, error: res.error };
    }
    setGoals(res.state.goals);
    return { ok: true };
  };

  const editGoal = (
    id: string,
    updates: Partial<SavingsGoal>
  ): { ok: true } | { ok: false; error: string } => {
    const res = applyEditGoal({ wallets, transactions, goals, bills }, id, updates);
    if (!res.ok) {
      reportDomainError(res.error);
      return { ok: false, error: res.error };
    }
    setGoals(res.state.goals);
    return { ok: true };
  };

  const deleteGoal = (id: string): { ok: true } | { ok: false; error: string } => {
    const res = applyDeleteGoal({ wallets, transactions, goals, bills }, id);
    if (!res.ok) {
      reportDomainError(res.error);
      return { ok: false, error: res.error };
    }
    setGoals(res.state.goals);
    return { ok: true };
  };

  const depositToGoal = (
    goalId: string,
    amount: number,
    walletId: string,
    note?: string
  ): { ok: true } | { ok: false; error: string } => {
    const res = applyGoalDeposit({ wallets, transactions, goals, bills }, goalId, walletId, amount, note);
    if (!res.ok) {
      reportDomainError(res.error);
      return { ok: false, error: res.error };
    }
    setWallets(res.state.wallets);
    setGoals(res.state.goals);
    setTransactions(res.state.transactions);
    return { ok: true };
  };

  const withdrawFromGoal = (
    goalId: string,
    amount: number,
    walletId: string,
    note?: string
  ): { ok: true } | { ok: false; error: string } => {
    const res = applyGoalWithdraw({ wallets, transactions, goals, bills }, goalId, walletId, amount, note);
    if (!res.ok) {
      reportDomainError(res.error);
      return { ok: false, error: res.error };
    }
    setWallets(res.state.wallets);
    setGoals(res.state.goals);
    setTransactions(res.state.transactions);
    return { ok: true };
  };

  // ── Reset & Clear ──────────────────────────────────────────────────────────

  const resetToDefaultData = () => {
    setWallets(INITIAL_WALLETS);
    setTransactions(INITIAL_TRANSACTIONS);
    setCategories(DEFAULT_CATEGORIES);
    setBudgets(INITIAL_BUDGETS);
    setBills(INITIAL_BILLS);
    setGoals(INITIAL_GOALS);
    setPlanner(INITIAL_PLANNER);
    setStorageStatus('OK');
    setStorageError(undefined);
    setToastMessage({ id: String(Date.now()), text: 'Đã khôi phục dữ liệu mẫu', type: 'info' });
  };

  const clearAllData = () => {
    setWallets([]);
    setTransactions([]);
    setBudgets([]);
    setBills([]);
    setGoals([]);
    setStorageStatus('OK');
    setStorageError(undefined);
    setToastMessage({ id: String(Date.now()), text: 'Đã xóa toàn bộ dữ liệu', type: 'info' });
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
    const byteLength = getUtf8ByteLength(jsonStr);
    if (byteLength > MAX_IMPORT_BYTES) {
      reportDomainError(
        `Tệp dữ liệu quá lớn (${(byteLength / (1024 * 1024)).toFixed(1)} MB). Giới hạn là ${
          MAX_IMPORT_BYTES / (1024 * 1024)
        } MB.`
      );
      return false;
    }

    let data: unknown;
    try {
      data = JSON.parse(jsonStr);
    } catch {
      reportDomainError('Tệp dữ liệu không phải định dạng JSON hợp lệ');
      return false;
    }

    const res = validateAndNormalizeAppSnapshot(data);
    if (!res.ok) {
      console.error('[AppContext] Import failed:', res.error);
      reportDomainError(`Dữ liệu nhập không hợp lệ: ${res.error}`);
      return false;
    }

    setWallets(res.data.wallets);
    setTransactions(res.data.transactions);
    setCategories(res.data.categories);
    setBudgets(res.data.budgets);
    setBills(res.data.bills);
    setGoals(res.data.goals);
    setPlanner(res.data.planner);
    setStorageStatus('OK');
    setStorageError(undefined);
    setToastMessage({ id: String(Date.now()), text: 'Nhập dữ liệu thành công!', type: 'success' });
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
        recoveryCopySaved,
        recoveryKey,
        recoveryRawData,
        retrySave,
        downloadRawRecoveryData,
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
        toastMessage,
        dismissToast,
      }}
    >
      {children}
      {/* Toast notifications container */}
      {toastMessage && (
        <div className="fixed bottom-20 right-4 z-50 max-w-md bg-slate-900 text-white px-4 py-3 rounded-xl shadow-xl border border-slate-700 flex items-center justify-between gap-3 animate-in fade-in slide-in-from-bottom-2">
          <p className="text-xs sm:text-sm font-medium">{toastMessage.text}</p>
          <button
            onClick={dismissToast}
            className="text-slate-400 hover:text-white text-xs font-bold px-1.5 py-0.5"
          >
            ✕
          </button>
        </div>
      )}
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
