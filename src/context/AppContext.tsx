'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  Wallet,
  Transaction,
  Category,
  Budget,
  RecurringBill,
  SavingsGoal,
  IncomeBudgetPlanner,
  FinancialSummary,
  FilterPeriod,
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
import { validateAndNormalizeAppSnapshot } from '@/lib/storage-schema';

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

  // Rollover currentMonth on focus, visibility change, and interval
  useEffect(() => {
    const checkMonthRollover = () => {
      const nowYm = getCurrentYearMonth();
      setCurrentMonth((prev) => (prev !== nowYm ? nowYm : prev));
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkMonthRollover();
      }
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

  // Load from local storage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        const res = validateAndNormalizeAppSnapshot(parsed);
        if (res.ok) {
          setWallets(res.data.wallets);
          setTransactions(res.data.transactions);
          setCategories(res.data.categories);
          setBudgets(res.data.budgets);
          setBills(res.data.bills);
          setGoals(res.data.goals);
          setPlanner(res.data.planner);
        } else {
          console.warn('Storage snapshot validation failed, using defaults:', res.error);
        }
      }
    } catch (e) {
      console.error('Failed to load storage data:', e);
    }
    setMounted(true);
  }, []);

  // Save to local storage
  useEffect(() => {
    if (!mounted) return;
    try {
      const payload = {
        wallets,
        transactions,
        categories,
        budgets,
        bills,
        goals,
        planner,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {
      console.error('Failed to save to localStorage:', e);
    }
  }, [mounted, wallets, transactions, categories, budgets, bills, goals, planner]);

  const openQuickAdd = (type: 'EXPENSE' | 'INCOME' | 'TRANSFER' = 'EXPENSE') => {
    setQuickAddDefaultType(type);
    setQuickAddOpen(true);
  };

  // Financial summary
  const financialSummary = calculateFinancialSummary(wallets, transactions, currentMonth, goals);

  // Add Transaction
  const addTransaction = (tx: Omit<Transaction, 'id' | 'createdAt'>) => {
    const res = applyAddTransaction({ wallets, transactions, goals, bills }, tx);
    if (!res.ok) {
      alert(res.error);
      return;
    }
    setWallets(res.state.wallets);
    setTransactions(res.state.transactions);
  };

  // Edit Transaction
  const editTransaction = (id: string, updated: Partial<Transaction>) => {
    const res = applyEditTransaction({ wallets, transactions, goals, bills }, id, updated);
    if (!res.ok) {
      alert(res.error);
      return;
    }
    setWallets(res.state.wallets);
    setTransactions(res.state.transactions);
  };

  // Delete Transaction
  const deleteTransaction = (id: string) => {
    const res = applyDeleteTransaction({ wallets, transactions, goals, bills }, id);
    if (!res.ok) {
      alert(res.error);
      return;
    }
    setWallets(res.state.wallets);
    setTransactions(res.state.transactions);
  };

  // Wallets
  const addWallet = (wallet: Omit<Wallet, 'id' | 'createdAt'>) => {
    const res = applyAddWallet(
      { transactions, wallets, goals, bills },
      wallet
    );
    if (!res.ok) {
      alert(res.error);
      return;
    }
    setWallets(res.state.wallets);
  };

  const editWallet = (id: string, updated: Partial<Wallet>) => {
    const res = applyEditWallet({ wallets, transactions, goals, bills }, id, updated);
    if (!res.ok) {
      alert(res.error);
      return;
    }
    setWallets(res.state.wallets);
  };

  const deleteWallet = (id: string) => {
    const res = applyDeleteWallet({ wallets, transactions, goals, bills }, id);
    if (!res.ok) {
      alert(res.error);
      return;
    }
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
    if (!fromW || !toW) {
      alert('Không tìm thấy thông tin ví');
      return;
    }

    const feeCheck = validateTransferFee(fee);
    if (!feeCheck.valid) {
      alert(feeCheck.error || 'Phí chuyển khoản không hợp lệ');
      return;
    }

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

  // Budgets
  const addBudget = (budget: Omit<Budget, 'id'>) => {
    const res = applyAddBudget(budgets, budget);
    if (!res.ok) {
      alert(res.error);
      return;
    }
    setBudgets(res.budgets);
  };

  const editBudget = (id: string, updated: Partial<Budget>) => {
    const res = applyEditBudget(budgets, id, updated);
    if (!res.ok) {
      alert(res.error);
      return;
    }
    setBudgets(res.budgets);
  };

  const deleteBudget = (id: string) => {
    const res = applyDeleteBudget(budgets, id);
    if (!res.ok) {
      alert(res.error);
      return;
    }
    setBudgets(res.budgets);
  };

  const updatePlanner = (newPlanner: IncomeBudgetPlanner) => {
    const res = applyUpdatePlanner(newPlanner);
    if (!res.ok) {
      alert(res.error);
      return;
    }
    setPlanner(res.planner);
  };

  // Bills
  const addBill = (bill: Omit<RecurringBill, 'id'>) => {
    const res = applyAddBill({ wallets, transactions, goals, bills }, bill);
    if (!res.ok) {
      alert(res.error);
      return;
    }
    setBills(res.state.bills);
  };

  const editBill = (id: string, updated: Partial<RecurringBill>) => {
    const res = applyEditBill({ wallets, transactions, goals, bills }, id, updated);
    if (!res.ok) {
      alert(res.error);
      return;
    }
    setBills(res.state.bills);
  };

  const deleteBill = (id: string) => {
    const res = applyDeleteBill({ wallets, transactions, goals, bills }, id);
    if (!res.ok) {
      alert(res.error);
      return;
    }
    setBills(res.state.bills);
  };

  const payBill = (billId: string, walletId: string) => {
    const res = applyPayBill({ wallets, transactions, goals, bills }, billId, walletId);
    if (!res.ok) {
      alert(res.error);
      return;
    }
    setWallets(res.state.wallets);
    setBills(res.state.bills);
    setTransactions(res.state.transactions);
  };

  const unpayBill = (billId: string) => {
    const res = applyUnpayBill({ wallets, transactions, goals, bills }, billId);
    if (!res.ok) {
      alert(res.error);
      return;
    }
    setWallets(res.state.wallets);
    setBills(res.state.bills);
    setTransactions(res.state.transactions);
  };

  // Goals
  const addGoal = (goal: Omit<SavingsGoal, 'id' | 'createdAt' | 'history'>) => {
    const res = applyAddGoal({ wallets, transactions, goals, bills }, goal);
    if (!res.ok) {
      alert(res.error);
      return;
    }
    setGoals(res.state.goals);
  };

  const editGoal = (id: string, updated: Partial<SavingsGoal>) => {
    const res = applyEditGoal({ wallets, transactions, goals, bills }, id, updated);
    if (!res.ok) {
      alert(res.error);
      return;
    }
    setGoals(res.state.goals);
  };

  const deleteGoal = (id: string) => {
    const res = applyDeleteGoal({ wallets, transactions, goals, bills }, id);
    if (!res.ok) {
      alert(res.error);
      return;
    }
    setGoals(res.state.goals);
  };

  const depositToGoal = (goalId: string, amount: number, walletId: string, note?: string) => {
    const res = applyGoalDeposit({ wallets, transactions, goals, bills }, goalId, walletId, amount, note);
    if (!res.ok) {
      alert(res.error);
      return;
    }
    setWallets(res.state.wallets);
    setGoals(res.state.goals);
    setTransactions(res.state.transactions);
  };

  const withdrawFromGoal = (goalId: string, amount: number, walletId: string, note?: string) => {
    const res = applyGoalWithdraw({ wallets, transactions, goals, bills }, goalId, walletId, amount, note);
    if (!res.ok) {
      alert(res.error);
      return;
    }
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
    setPlanner({
      monthlyIncome: 0,
      needsPercent: 50,
      wantsPercent: 30,
      savingsPercent: 20,
    });
  };

  const exportDatabaseJSON = () => {
    const data = {
      wallets,
      transactions,
      categories,
      budgets,
      bills,
      goals,
      planner,
      exportedAt: new Date().toISOString(),
      version: '2.0',
    };
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `quan-ly-chi-tieu-backup-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importDatabaseJSON = (jsonStr: string): boolean => {
    try {
      const data = JSON.parse(jsonStr);
      const res = validateAndNormalizeAppSnapshot(data);
      if (!res.ok) {
        console.error('Import failed:', res.error);
        alert(`Dữ liệu nhập không hợp lệ: ${res.error}`);
        return false;
      }

      setWallets(res.data.wallets);
      setTransactions(res.data.transactions);
      setCategories(res.data.categories);
      setBudgets(res.data.budgets);
      setBills(res.data.bills);
      setGoals(res.data.goals);
      setPlanner(res.data.planner);
      return true;
    } catch (e) {
      console.error('Import failed:', e);
      alert('Tệp dữ liệu không phải định dạng JSON hợp lệ');
      return false;
    }
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
