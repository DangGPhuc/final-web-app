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
} from '@/lib/domain-engine';
import { getCurrentYearMonth } from '@/lib/utils';

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
