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
import { calculateFinancialSummary } from '@/lib/utils';

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
  const [currentMonth, setCurrentMonth] = useState<string>('2026-09');

  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [quickAddOpen, setQuickAddOpen] = useState<boolean>(false);
  const [quickAddDefaultType, setQuickAddDefaultType] = useState<'EXPENSE' | 'INCOME' | 'TRANSFER'>('EXPENSE');

  // Load from local storage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.wallets) setWallets(parsed.wallets);
        if (parsed.transactions) setTransactions(parsed.transactions);
        if (parsed.categories) setCategories(parsed.categories);
        if (parsed.budgets) setBudgets(parsed.budgets);
        if (parsed.bills) setBills(parsed.bills);
        if (parsed.goals) setGoals(parsed.goals);
        if (parsed.planner) setPlanner(parsed.planner);
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
  const financialSummary = calculateFinancialSummary(wallets, transactions, currentMonth);

  // Add Transaction
  const addTransaction = (tx: Omit<Transaction, 'id' | 'createdAt'>) => {
    const id = `tx-${Date.now()}`;
    const createdAt = new Date().toISOString();
    const newTx: Transaction = {
      ...tx,
      id,
      createdAt,
    };

    // Update wallet balances
    setWallets((prevWallets) =>
      prevWallets.map((w) => {
        if (tx.type === 'EXPENSE' && w.id === tx.walletId) {
          return { ...w, balance: w.balance - tx.amount };
        }
        if (tx.type === 'INCOME' && w.id === tx.walletId) {
          return { ...w, balance: w.balance + tx.amount };
        }
        if (tx.type === 'TRANSFER') {
          if (w.id === tx.walletId) {
            return { ...w, balance: w.balance - (tx.amount + (tx.fee || 0)) };
          }
          if (w.id === tx.toWalletId) {
            return { ...w, balance: w.balance + tx.amount };
          }
        }
        return w;
      })
    );

    setTransactions((prev) => [newTx, ...prev]);
  };

  // Edit Transaction
  const editTransaction = (id: string, updated: Partial<Transaction>) => {
    const oldTx = transactions.find((t) => t.id === id);
    if (!oldTx) return;

    // Rollback old transaction on wallets
    let adjustedWallets = [...wallets];
    adjustedWallets = adjustedWallets.map((w) => {
      if (oldTx.type === 'EXPENSE' && w.id === oldTx.walletId) {
        return { ...w, balance: w.balance + oldTx.amount };
      }
      if (oldTx.type === 'INCOME' && w.id === oldTx.walletId) {
        return { ...w, balance: w.balance - oldTx.amount };
      }
      if (oldTx.type === 'TRANSFER') {
        if (w.id === oldTx.walletId) {
          return { ...w, balance: w.balance + (oldTx.amount + (oldTx.fee || 0)) };
        }
        if (w.id === oldTx.toWalletId) {
          return { ...w, balance: w.balance - oldTx.amount };
        }
      }
      return w;
    });

    const newTx: Transaction = { ...oldTx, ...updated };

    // Apply new transaction to wallets
    adjustedWallets = adjustedWallets.map((w) => {
      if (newTx.type === 'EXPENSE' && w.id === newTx.walletId) {
        return { ...w, balance: w.balance - newTx.amount };
      }
      if (newTx.type === 'INCOME' && w.id === newTx.walletId) {
        return { ...w, balance: w.balance + newTx.amount };
      }
      if (newTx.type === 'TRANSFER') {
        if (w.id === newTx.walletId) {
          return { ...w, balance: w.balance - (newTx.amount + (newTx.fee || 0)) };
        }
        if (w.id === newTx.toWalletId) {
          return { ...w, balance: w.balance + newTx.amount };
        }
      }
      return w;
    });

    setWallets(adjustedWallets);
    setTransactions((prev) => prev.map((t) => (t.id === id ? newTx : t)));
  };

  // Delete Transaction
  const deleteTransaction = (id: string) => {
    const oldTx = transactions.find((t) => t.id === id);
    if (!oldTx) return;

    // Rollback wallet balance
    setWallets((prevWallets) =>
      prevWallets.map((w) => {
        if (oldTx.type === 'EXPENSE' && w.id === oldTx.walletId) {
          return { ...w, balance: w.balance + oldTx.amount };
        }
        if (oldTx.type === 'INCOME' && w.id === oldTx.walletId) {
          return { ...w, balance: w.balance - oldTx.amount };
        }
        if (oldTx.type === 'TRANSFER') {
          if (w.id === oldTx.walletId) {
            return { ...w, balance: w.balance + (oldTx.amount + (oldTx.fee || 0)) };
          }
          if (w.id === oldTx.toWalletId) {
            return { ...w, balance: w.balance - oldTx.amount };
          }
        }
        return w;
      })
    );

    setTransactions((prev) => prev.filter((t) => t.id !== id));
  };

  // Wallets
  const addWallet = (wallet: Omit<Wallet, 'id' | 'createdAt'>) => {
    const newWallet: Wallet = {
      ...wallet,
      id: `wal-${Date.now()}`,
      createdAt: new Date().toISOString(),
    };
    setWallets((prev) => [...prev, newWallet]);
  };

  const editWallet = (id: string, updated: Partial<Wallet>) => {
    setWallets((prev) => prev.map((w) => (w.id === id ? { ...w, ...updated } : w)));
  };

  const deleteWallet = (id: string) => {
    setWallets((prev) => prev.filter((w) => w.id !== id));
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

    addTransaction({
      type: 'TRANSFER',
      amount,
      fee,
      walletId: fromWalletId,
      walletName: fromW?.name,
      toWalletId,
      toWalletName: toW?.name,
      date: new Date().toISOString(),
      note: note || `Chuyển khoản từ ${fromW?.name || 'Ví'} sang ${toW?.name || 'Ví'}`,
      tags: ['Chuyển khoản nội bộ'],
    });
  };

  // Budgets
  const addBudget = (budget: Omit<Budget, 'id'>) => {
    const newBudget: Budget = {
      ...budget,
      id: `bud-${Date.now()}`,
    };
    setBudgets((prev) => [...prev, newBudget]);
  };

  const editBudget = (id: string, updated: Partial<Budget>) => {
    setBudgets((prev) => prev.map((b) => (b.id === id ? { ...b, ...updated } : b)));
  };

  const deleteBudget = (id: string) => {
    setBudgets((prev) => prev.filter((b) => b.id !== id));
  };

  const updatePlanner = (newPlanner: IncomeBudgetPlanner) => {
    setPlanner(newPlanner);
  };

  // Bills
  const addBill = (bill: Omit<RecurringBill, 'id'>) => {
    const newBill: RecurringBill = {
      ...bill,
      id: `bill-${Date.now()}`,
    };
    setBills((prev) => [...prev, newBill]);
  };

  const editBill = (id: string, updated: Partial<RecurringBill>) => {
    setBills((prev) => prev.map((b) => (b.id === id ? { ...b, ...updated } : b)));
  };

  const deleteBill = (id: string) => {
    setBills((prev) => prev.filter((b) => b.id !== id));
  };

  const payBill = (billId: string, walletId: string) => {
    const bill = bills.find((b) => b.id === billId);
    if (!bill) return;

    const targetWallet = wallets.find((w) => w.id === walletId) || wallets[0];
    const billCategory = categories.find((c) => c.id === bill.categoryId);

    // 1. Mark bill as PAID
    setBills((prev) =>
      prev.map((b) =>
        b.id === billId
          ? {
              ...b,
              status: 'PAID',
              lastPaidDate: new Date().toISOString().split('T')[0],
              walletId,
            }
          : b
      )
    );

    // 2. Automatically record transaction
    addTransaction({
      type: 'EXPENSE',
      amount: bill.amount,
      categoryId: bill.categoryId,
      categoryName: billCategory?.name || bill.categoryName || 'Hóa đơn',
      walletId: targetWallet.id,
      walletName: targetWallet.name,
      date: new Date().toISOString(),
      note: `Thanh toán hóa đơn: ${bill.name}`,
      tags: ['Hóa đơn định kỳ'],
    });
  };

  // Goals
  const addGoal = (goal: Omit<SavingsGoal, 'id' | 'createdAt' | 'history'>) => {
    const newGoal: SavingsGoal = {
      ...goal,
      id: `goal-${Date.now()}`,
      history: [],
      createdAt: new Date().toISOString(),
    };
    setGoals((prev) => [...prev, newGoal]);
  };

  const editGoal = (id: string, updated: Partial<SavingsGoal>) => {
    setGoals((prev) => prev.map((g) => (g.id === id ? { ...g, ...updated } : g)));
  };

  const deleteGoal = (id: string) => {
    setGoals((prev) => prev.filter((g) => g.id !== id));
  };

  const depositToGoal = (goalId: string, amount: number, walletId: string, note?: string) => {
    const goal = goals.find((g) => g.id === goalId);
    const wallet = wallets.find((w) => w.id === walletId);
    if (!goal || !wallet) return;

    // Deduct from wallet
    setWallets((prev) =>
      prev.map((w) => (w.id === walletId ? { ...w, balance: w.balance - amount } : w))
    );

    // Add to goal
    const newHistoryItem = {
      id: `gh-${Date.now()}`,
      date: new Date().toISOString().split('T')[0],
      amount,
      type: 'DEPOSIT' as const,
      walletId,
      note: note || `Nạp từ ${wallet.name}`,
    };

    setGoals((prev) =>
      prev.map((g) =>
        g.id === goalId
          ? {
              ...g,
              currentAmount: g.currentAmount + amount,
              history: [newHistoryItem, ...g.history],
            }
          : g
      )
    );

    // Log transaction
    addTransaction({
      type: 'EXPENSE',
      amount,
      categoryId: 'cat-invest-exp',
      categoryName: 'Đầu tư & Tích lũy',
      walletId,
      walletName: wallet.name,
      date: new Date().toISOString(),
      note: `Tích lũy vào hũ: ${goal.name}`,
      tags: ['Tích lũy mục tiêu'],
    });
  };

  const withdrawFromGoal = (goalId: string, amount: number, walletId: string, note?: string) => {
    const goal = goals.find((g) => g.id === goalId);
    const wallet = wallets.find((w) => w.id === walletId);
    if (!goal || !wallet) return;

    // Add back to wallet
    setWallets((prev) =>
      prev.map((w) => (w.id === walletId ? { ...w, balance: w.balance + amount } : w))
    );

    // Deduct from goal
    const newHistoryItem = {
      id: `gh-${Date.now()}`,
      date: new Date().toISOString().split('T')[0],
      amount,
      type: 'WITHDRAW' as const,
      walletId,
      note: note || `Rút về ${wallet.name}`,
    };

    setGoals((prev) =>
      prev.map((g) =>
        g.id === goalId
          ? {
              ...g,
              currentAmount: Math.max(0, g.currentAmount - amount),
              history: [newHistoryItem, ...g.history],
            }
          : g
      )
    );

    // Log income transaction
    addTransaction({
      type: 'INCOME',
      amount,
      categoryId: 'cat-other-inc',
      categoryName: 'Thu nhập khác',
      walletId,
      walletName: wallet.name,
      date: new Date().toISOString(),
      note: `Rút từ hũ tích lũy: ${goal.name}`,
      tags: ['Rút hũ tiết kiệm'],
    });
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
      if (data.wallets && Array.isArray(data.wallets)) setWallets(data.wallets);
      if (data.transactions && Array.isArray(data.transactions)) setTransactions(data.transactions);
      if (data.categories && Array.isArray(data.categories)) setCategories(data.categories);
      if (data.budgets && Array.isArray(data.budgets)) setBudgets(data.budgets);
      if (data.bills && Array.isArray(data.bills)) setBills(data.bills);
      if (data.goals && Array.isArray(data.goals)) setGoals(data.goals);
      if (data.planner) setPlanner(data.planner);
      return true;
    } catch (e) {
      console.error('Import failed:', e);
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
