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
    // Validate amount
    if (typeof tx.amount !== 'number' || isNaN(tx.amount) || !isFinite(tx.amount) || tx.amount <= 0) {
      console.warn('addTransaction: Số tiền không hợp lệ (> 0 và hữu hạn)', tx.amount);
      return;
    }

    // Validate wallet existence
    const sourceWallet = wallets.find((w) => w.id === tx.walletId);
    if (!sourceWallet) {
      console.warn('addTransaction: Ví nguồn không tồn tại', tx.walletId);
      return;
    }

    // Validate transfer specifics
    const fee = typeof tx.fee === 'number' && isFinite(tx.fee) && tx.fee >= 0 ? tx.fee : 0;
    if (tx.type === 'TRANSFER') {
      if (!tx.toWalletId || tx.toWalletId === tx.walletId) {
        alert('Ví nhận phải khác ví chuyển');
        return;
      }
      const destWallet = wallets.find((w) => w.id === tx.toWalletId);
      if (!destWallet) {
        console.warn('addTransaction: Ví đích không tồn tại', tx.toWalletId);
        return;
      }
      if (sourceWallet.balance < tx.amount + fee) {
        alert('Số dư ví nguồn không đủ để thực hiện chuyển khoản!');
        return;
      }
    }

    const id = `tx-${Date.now()}`;
    const createdAt = new Date().toISOString();
    const newTx: Transaction = {
      ...tx,
      fee,
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
            return { ...w, balance: w.balance - (tx.amount + fee) };
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

    if (updated.amount !== undefined) {
      if (typeof updated.amount !== 'number' || isNaN(updated.amount) || !isFinite(updated.amount) || updated.amount <= 0) {
        console.warn('editTransaction: Số tiền không hợp lệ');
        return;
      }
    }

    const newTx: Transaction = { ...oldTx, ...updated };
    if (newTx.type === 'TRANSFER' && newTx.toWalletId && newTx.walletId === newTx.toWalletId) {
      alert('Ví nhận phải khác ví chuyển');
      return;
    }

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

    // Apply new transaction to wallets
    const fee = typeof newTx.fee === 'number' && isFinite(newTx.fee) && newTx.fee >= 0 ? newTx.fee : 0;
    adjustedWallets = adjustedWallets.map((w) => {
      if (newTx.type === 'EXPENSE' && w.id === newTx.walletId) {
        return { ...w, balance: w.balance - newTx.amount };
      }
      if (newTx.type === 'INCOME' && w.id === newTx.walletId) {
        return { ...w, balance: w.balance + newTx.amount };
      }
      if (newTx.type === 'TRANSFER') {
        if (w.id === newTx.walletId) {
          return { ...w, balance: w.balance - (newTx.amount + fee) };
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
    const bal = typeof wallet.balance === 'number' && isFinite(wallet.balance) ? wallet.balance : 0;
    const newWallet: Wallet = {
      ...wallet,
      balance: bal,
      initialBalance: bal,
      id: `wal-${Date.now()}`,
      createdAt: new Date().toISOString(),
    };
    setWallets((prev) => [...prev, newWallet]);
  };

  const editWallet = (id: string, updated: Partial<Wallet>) => {
    setWallets((prev) =>
      prev.map((w) => {
        if (w.id !== id) return w;
        const bal = updated.balance !== undefined && isFinite(updated.balance) ? updated.balance : w.balance;
        return { ...w, ...updated, balance: bal };
      })
    );
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
    if (typeof amount !== 'number' || isNaN(amount) || !isFinite(amount) || amount <= 0) {
      alert('Số tiền chuyển phải lớn hơn 0');
      return;
    }
    if (fromWalletId === toWalletId) {
      alert('Ví nhận phải khác ví chuyển');
      return;
    }
    const fromW = wallets.find((w) => w.id === fromWalletId);
    const toW = wallets.find((w) => w.id === toWalletId);
    if (!fromW || !toW) {
      alert('Không tìm thấy thông tin ví');
      return;
    }
    const validFee = typeof fee === 'number' && isFinite(fee) && fee >= 0 ? fee : 0;
    if (fromW.balance < amount + validFee) {
      alert('Số dư ví nguồn không đủ để thực hiện chuyển khoản');
      return;
    }

    addTransaction({
      type: 'TRANSFER',
      amount,
      fee: validFee,
      walletId: fromWalletId,
      walletName: fromW.name,
      toWalletId,
      toWalletName: toW.name,
      date: new Date().toISOString(),
      note: note || `Chuyển khoản từ ${fromW.name} sang ${toW.name}`,
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
    if (!targetWallet) {
      alert('Không tìm thấy ví thanh toán');
      return;
    }

    if (typeof bill.amount !== 'number' || isNaN(bill.amount) || !isFinite(bill.amount) || bill.amount <= 0) {
      alert('Số tiền hóa đơn không hợp lệ');
      return;
    }

    if (targetWallet.type !== 'CREDIT' && targetWallet.balance < bill.amount) {
      alert('Số dư ví không đủ để thanh toán hóa đơn này');
      return;
    }

    const billCategory = categories.find((c) => c.id === bill.categoryId);

    // 1. Mark bill as PAID
    setBills((prev) =>
      prev.map((b) =>
        b.id === billId
          ? {
              ...b,
              status: 'PAID',
              lastPaidDate: new Date().toISOString().split('T')[0],
              walletId: targetWallet.id,
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
    const target = typeof goal.targetAmount === 'number' && isFinite(goal.targetAmount) && goal.targetAmount > 0
      ? goal.targetAmount
      : 0;
    const newGoal: SavingsGoal = {
      ...goal,
      targetAmount: target,
      currentAmount: 0,
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
    if (typeof amount !== 'number' || isNaN(amount) || !isFinite(amount) || amount <= 0) {
      alert('Số tiền nạp vào mục tiêu phải lớn hơn 0');
      return;
    }

    const goal = goals.find((g) => g.id === goalId);
    const wallet = wallets.find((w) => w.id === walletId);
    if (!goal || !wallet) {
      alert('Không tìm thấy mục tiêu tích lũy hoặc ví');
      return;
    }

    if (wallet.balance < amount) {
      alert('Số dư ví không đủ để nạp vào mục tiêu tích lũy!');
      return;
    }

    // Add to goal history & update current amount
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

    // addTransaction is the single authoritative mutator for wallet balance (-amount)
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
    if (typeof amount !== 'number' || isNaN(amount) || !isFinite(amount) || amount <= 0) {
      alert('Số tiền rút khỏi mục tiêu phải lớn hơn 0');
      return;
    }

    const goal = goals.find((g) => g.id === goalId);
    const wallet = wallets.find((w) => w.id === walletId);
    if (!goal || !wallet) {
      alert('Không tìm thấy mục tiêu tích lũy hoặc ví');
      return;
    }

    if (goal.currentAmount < amount) {
      alert('Số tiền rút vượt quá số dư hiện có trong mục tiêu tích lũy!');
      return;
    }

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

    // addTransaction is the single authoritative mutator for wallet balance (+amount)
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
      if (!data || typeof data !== 'object') {
        console.error('Import failed: payload is not a valid JSON object');
        return false;
      }

      // Validate wallets structure
      if (data.wallets) {
        if (!Array.isArray(data.wallets)) return false;
        const validWallets = data.wallets.every(
          (w: any) =>
            w &&
            typeof w.id === 'string' &&
            typeof w.name === 'string' &&
            ['CASH', 'BANK', 'CREDIT', 'SAVINGS'].includes(w.type) &&
            typeof w.balance === 'number' &&
            isFinite(w.balance)
        );
        if (!validWallets) {
          console.error('Import failed: invalid wallet structure');
          return false;
        }
      }

      // Validate transactions structure
      if (data.transactions) {
        if (!Array.isArray(data.transactions)) return false;
        const validTxs = data.transactions.every(
          (t: any) =>
            t &&
            typeof t.id === 'string' &&
            ['EXPENSE', 'INCOME', 'TRANSFER'].includes(t.type) &&
            typeof t.amount === 'number' &&
            isFinite(t.amount) &&
            t.amount > 0 &&
            typeof t.walletId === 'string' &&
            typeof t.date === 'string'
        );
        if (!validTxs) {
          console.error('Import failed: invalid transaction structure');
          return false;
        }
      }

      // Validate goals structure
      if (data.goals) {
        if (!Array.isArray(data.goals)) return false;
        const validGoals = data.goals.every(
          (g: any) =>
            g &&
            typeof g.id === 'string' &&
            typeof g.name === 'string' &&
            typeof g.targetAmount === 'number' &&
            isFinite(g.targetAmount) &&
            typeof g.currentAmount === 'number' &&
            isFinite(g.currentAmount) &&
            Array.isArray(g.history)
        );
        if (!validGoals) {
          console.error('Import failed: invalid savings goal structure');
          return false;
        }
      }

      // If all checks pass, apply updates
      if (data.wallets && Array.isArray(data.wallets)) setWallets(data.wallets);
      if (data.transactions && Array.isArray(data.transactions)) setTransactions(data.transactions);
      if (data.categories && Array.isArray(data.categories)) setCategories(data.categories);
      if (data.budgets && Array.isArray(data.budgets)) setBudgets(data.budgets);
      if (data.bills && Array.isArray(data.bills)) setBills(data.bills);
      if (data.goals && Array.isArray(data.goals)) setGoals(data.goals);
      if (data.planner && typeof data.planner === 'object') setPlanner(data.planner);
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
