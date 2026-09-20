'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import type {
  BankTransaction,
  Fund,
  FundStatus,
  Category,
  MonthlySnapshot,
  PaperTradeScenario,
  AppTab,
  GmailAccountInfo,
  ToastNotification,
  SyncResultStats,
} from '@/types';
import {
  calculateBalance,
  calculateMonthlyCashflow,
  calculateAllFundStatuses,
  calculateMonthlySnapshot,
  getCurrentYearMonth,
  generateId,
  type MonthlyCashflow,
} from '@/lib/finance/calculations';
import { DEMO_PAPER_TRADES } from '@/lib/mock-data';

interface AppContextType {
  // State
  transactions: BankTransaction[];
  funds: Fund[];
  categories: Category[];
  gmailAccounts: GmailAccountInfo[];
  monthlySnapshots: MonthlySnapshot[];
  paperTrades: PaperTradeScenario[];
  activeTab: AppTab;
  selectedMonth: string;
  toast: ToastNotification | null;
  isSyncing: boolean;
  classifyingTransaction: BankTransaction | null;

  // Derived metrics
  balance: number;
  currentMonthCashflow: MonthlyCashflow;
  selectedMonthCashflow: MonthlyCashflow;
  fundStatuses: FundStatus[];
  unclassifiedTransactions: BankTransaction[];

  // Navigation & UI
  setActiveTab: (tab: AppTab) => void;
  setSelectedMonth: (month: string) => void;
  setClassifyingTransaction: (tx: BankTransaction | null) => void;
  showToast: (text: string, type?: 'success' | 'error' | 'info') => void;

  // Single-Owner Authentication State
  isOwnerAuthenticated: boolean | null;
  unlockCockpit: (key: string) => Promise<{ success: boolean; error?: string }>;
  lockCockpit: () => Promise<void>;

  // Data Loading & Refresh
  refreshData: () => Promise<void>;

  // Transaction Operations
  classifyTransaction: (id: string, categoryName: string, fundId?: string) => Promise<void>;
  deleteTransaction: (id: string) => Promise<void>;

  // Fund Operations (Persistent via PostgreSQL + Prisma)
  createFund: (name: string, monthlyAllocation: number) => Promise<void>;
  editFund: (id: string, updates: { name?: string; monthlyAllocation?: number }) => Promise<void>;
  deleteFund: (id: string) => Promise<void>;

  // Category Operations
  createCategory: (name: string, direction?: string) => Promise<Category>;

  // Email Sync & OAuth
  syncEmail: (params?: {
    accountId?: string;
    fromDate?: string;
    toDate?: string;
    isDemoMode?: boolean;
    pageToken?: string;
    accountContinuationTokens?: Record<string, string>;
  }) => Promise<SyncResultStats | null>;
  disconnectGmail: (accountId: string) => Promise<void>;

  // Month Snapshot / Close Operations
  closeMonth: (month: string) => void;

  // Paper Trading Operations
  savePaperTrade: (trade: Omit<PaperTradeScenario, 'id' | 'createdAt'>) => void;
  deletePaperTrade: (id: string) => void;

  // Data Management
  clearFinancialData: () => Promise<void>;
  factoryReset: () => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [activeTab, setActiveTab] = useState<AppTab>('dashboard');
  const [selectedMonth, setSelectedMonth] = useState<string>(() => getCurrentYearMonth());
  const [toast, setToast] = useState<ToastNotification | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [classifyingTransaction, setClassifyingTransaction] = useState<BankTransaction | null>(null);

  // Core domain data
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [funds, setFunds] = useState<Fund[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [gmailAccounts, setGmailAccounts] = useState<GmailAccountInfo[]>([]);
  const [monthlySnapshots, setMonthlySnapshots] = useState<MonthlySnapshot[]>([]);
  const [paperTrades, setPaperTrades] = useState<PaperTradeScenario[]>(DEMO_PAPER_TRADES);

  const showToast = useCallback((text: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = generateId();
    setToast({ id, text, type });
    setTimeout(() => {
      setToast(prev => (prev?.id === id ? null : prev));
    }, 4000);
  }, []);

  // Single-owner authentication state (null = checking, false = locked, true = unlocked)
  const [isOwnerAuthenticated, setIsOwnerAuthenticated] = useState<boolean | null>(null);

  // Refresh domain data from server
  const refreshData = useCallback(async () => {
    try {
      const [txRes, fundsRes, catRes, accRes] = await Promise.all([
        fetch('/api/transactions'),
        fetch('/api/funds'),
        fetch('/api/categories'),
        fetch('/api/google/accounts'),
      ]);

      if (txRes.ok) {
        const txData = await txRes.json();
        if (txData.success) setTransactions(txData.transactions);
      }
      if (fundsRes.ok) {
        const fundsData = await fundsRes.json();
        if (fundsData.success) setFunds(fundsData.funds);
      }
      if (catRes.ok) {
        const catData = await catRes.json();
        if (catData.success) setCategories(catData.categories);
      }
      if (accRes.ok) {
        const accData = await accRes.json();
        if (accData.success) setGmailAccounts(accData.accounts);
      }
    } catch {
      // Offline or network error
    }
  }, []);

  // Check initial owner session status
  const checkOwnerSession = useCallback(async () => {
    try {
      const res = await fetch('/api/owner/session');
      const data = await res.json();
      const authenticated = !!data.authenticated;
      setIsOwnerAuthenticated(authenticated);
      if (authenticated) {
        await refreshData();
      }
      return authenticated;
    } catch {
      setIsOwnerAuthenticated(false);
      return false;
    }
  }, [refreshData]);

  // Unlock cockpit with owner secret (never persisted to storage or kept in React state)
  const unlockCockpit = useCallback(
    async (secretKey: string) => {
      try {
        const res = await fetch('/api/owner/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ secretKey }),
        });
        const data = await res.json();
        if (res.ok && data.success) {
          setIsOwnerAuthenticated(true);
          await refreshData();
          showToast('Mở khóa Cockpit thành công.', 'success');
          return { success: true };
        }
        return { success: false, error: data.error || 'Khóa chủ sở hữu không chính xác.' };
      } catch {
        return { success: false, error: 'Không thể kết nối đến máy chủ.' };
      }
    },
    [refreshData, showToast]
  );

  // Lock cockpit (clears server cookie and local in-memory domain state)
  const lockCockpit = useCallback(async () => {
    try {
      await fetch('/api/owner/session', { method: 'DELETE' });
    } catch {
      // Ignore network errors
    }
    setIsOwnerAuthenticated(false);
    setTransactions([]);
    setFunds([]);
    setCategories([]);
    setGmailAccounts([]);
    showToast('Đã khóa Cockpit.', 'info');
  }, [showToast]);

  // Initial session verification
  useEffect(() => {
    checkOwnerSession();
  }, [checkOwnerSession]);

  // Derived metrics
  const balance = useMemo(() => {
    return calculateBalance(0, transactions);
  }, [transactions]);

  const currentMonthStr = useMemo(() => getCurrentYearMonth(), []);

  const currentMonthCashflow = useMemo(() => {
    return calculateMonthlyCashflow(transactions, currentMonthStr);
  }, [transactions, currentMonthStr]);

  const selectedMonthCashflow = useMemo(() => {
    return calculateMonthlyCashflow(transactions, selectedMonth);
  }, [transactions, selectedMonth]);

  const fundStatuses = useMemo(() => {
    return calculateAllFundStatuses(funds, transactions, selectedMonth);
  }, [funds, transactions, selectedMonth]);

  const unclassifiedTransactions = useMemo(() => {
    return transactions.filter(t => t.classificationState === 'UNCLASSIFIED');
  }, [transactions]);

  // Category Operation
  const createCategory = useCallback(async (name: string, direction?: string): Promise<Category> => {
    const res = await fetch('/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, direction }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to create category');
    }
    const created: Category = data.category;
    setCategories(prev => {
      if (prev.some(c => c.id === created.id || c.name.toLowerCase() === created.name.toLowerCase())) {
        return prev;
      }
      return [...prev, created].sort((a, b) => a.name.localeCompare(b.name));
    });
    return created;
  }, []);

  // Transaction Classification
  const classifyTransaction = useCallback(
    async (id: string, categoryName: string, fundId?: string) => {
      try {
        // Ensure category exists
        let cat = categories.find(c => c.name.toLowerCase() === categoryName.trim().toLowerCase());
        if (!cat) {
          cat = await createCategory(categoryName.trim());
        }

        const res = await fetch(`/api/transactions/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            categoryId: cat.id,
            fundId: fundId || null,
            classificationState: 'CLASSIFIED',
          }),
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Failed to classify transaction');
        }

        setTransactions(prev =>
          prev.map(tx => (tx.id === id ? { ...data.transaction, category: cat, fund: funds.find(f => f.id === fundId) || null } : tx))
        );
        showToast(`Đã phân loại thành công vào "${cat.name}"`, 'success');
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Lỗi phân loại giao dịch', 'error');
        throw err;
      }
    },
    [categories, createCategory, funds, showToast]
  );

  const deleteTransaction = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/transactions/${id}`, { method: 'DELETE' });
        if (res.ok) {
          setTransactions(prev => prev.filter(t => t.id !== id));
          showToast('Đã xóa giao dịch', 'info');
        }
      } catch {
        showToast('Lỗi xóa giao dịch', 'error');
      }
    },
    [showToast]
  );

  // Fund Operations
  const createFund = useCallback(
    async (name: string, monthlyAllocation: number) => {
      try {
        const res = await fetch('/api/funds', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, monthlyAllocation }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Lỗi tạo quỹ');
        }
        setFunds(prev => [...prev, data.fund]);
        showToast(`Đã tạo quỹ "${data.fund.name}"`, 'success');
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Lỗi tạo quỹ', 'error');
        throw err;
      }
    },
    [showToast]
  );

  const editFund = useCallback(
    async (id: string, updates: { name?: string; monthlyAllocation?: number }) => {
      try {
        const res = await fetch(`/api/funds/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Lỗi cập nhật quỹ');
        }
        setFunds(prev => prev.map(f => (f.id === id ? data.fund : f)));
        showToast('Đã cập nhật quỹ', 'success');
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Lỗi cập nhật quỹ', 'error');
        throw err;
      }
    },
    [showToast]
  );

  const deleteFund = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/funds/${id}`, { method: 'DELETE' });
        if (res.ok) {
          setFunds(prev => prev.filter(f => f.id !== id));
          showToast('Đã xóa quỹ', 'info');
        }
      } catch {
        showToast('Lỗi xóa quỹ', 'error');
      }
    },
    [showToast]
  );

  // Email Sync
  const syncEmail = useCallback(
    async (params?: {
      accountId?: string;
      fromDate?: string;
      toDate?: string;
      isDemoMode?: boolean;
      pageToken?: string;
      accountContinuationTokens?: Record<string, string>;
    }) => {
      setIsSyncing(true);
      try {
        const res = await fetch('/api/email/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params || {}),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Lỗi quét email');
        }

        const stats: SyncResultStats = data.stats;
        if (stats.truncated) {
          showToast(
            `Đã nhập một phần lịch sử: +${stats.totalNew} biến động mới. Vẫn còn email cần quét.`,
            'info'
          );
        } else {
          showToast(
            `Quét hoàn tất: +${stats.totalNew} biến động mới, ${stats.totalDuplicates} đã tồn tại`,
            'success'
          );
        }
        await refreshData();
        return stats;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Lỗi quét email';
        showToast(msg, 'error');
        return null;
      } finally {
        setIsSyncing(false);
      }
    },
    [refreshData, showToast]
  );

  // Disconnect Gmail
  const disconnectGmail = useCallback(
    async (accountId: string) => {
      try {
        const res = await fetch('/api/google/disconnect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountId }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Lỗi ngắt kết nối Gmail');
        }
        setGmailAccounts(prev => prev.filter(a => a.id !== accountId));
        showToast(data.message || 'Đã ngắt kết nối Gmail', 'info');
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Lỗi ngắt kết nối', 'error');
      }
    },
    [showToast]
  );

  // Close Month Snapshot
  const closeMonth = useCallback(
    (month: string) => {
      const snapshot = calculateMonthlySnapshot(month, transactions, funds);
      setMonthlySnapshots(prev => {
        const filtered = prev.filter(s => s.month !== month);
        return [...filtered, snapshot].sort((a, b) => a.month.localeCompare(b.month));
      });
      showToast(`Đã chốt sổ và lưu báo cáo tháng ${month}`, 'success');
    },
    [transactions, funds, showToast]
  );

  // Paper Trading
  const savePaperTrade = useCallback((tradeData: Omit<PaperTradeScenario, 'id' | 'createdAt'>) => {
    const newTrade: PaperTradeScenario = {
      ...tradeData,
      id: generateId(),
      createdAt: new Date().toISOString(),
    };
    setPaperTrades(prev => [newTrade, ...prev]);
    showToast('Đã lưu kịch bản mô phỏng giao dịch', 'success');
  }, [showToast]);

  const deletePaperTrade = useCallback((id: string) => {
    setPaperTrades(prev => prev.filter(t => t.id !== id));
    showToast('Đã xóa kịch bản mô phỏng', 'info');
  }, [showToast]);

  // Data Management: Clear Financial Data (keeps Gmail connections)
  const clearFinancialData = useCallback(async () => {
    try {
      const res = await fetch('/api/data/clear-financial', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Lỗi xóa dữ liệu tài chính');
      }
      setTransactions([]);
      setFunds([]);
      setCategories([]);
      setMonthlySnapshots([]);
      showToast(data.message || 'Đã xóa dữ liệu tài chính', 'info');
      await refreshData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi xóa dữ liệu', 'error');
    }
  }, [refreshData, showToast]);

  // Data Management: Factory Reset (wipes everything)
  const factoryReset = useCallback(async () => {
    try {
      const res = await fetch('/api/data/factory-reset', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Lỗi khôi phục hệ thống');
      }
      setTransactions([]);
      setFunds([]);
      setCategories([]);
      setGmailAccounts([]);
      setMonthlySnapshots([]);
      showToast(data.message || 'Đã khôi phục cài đặt gốc', 'info');
      await refreshData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi khôi phục hệ thống', 'error');
    }
  }, [refreshData, showToast]);

  const value = useMemo(
    () => ({
      transactions,
      funds,
      categories,
      gmailAccounts,
      monthlySnapshots,
      paperTrades,
      activeTab,
      selectedMonth,
      toast,
      isSyncing,
      classifyingTransaction,
      balance,
      currentMonthCashflow,
      selectedMonthCashflow,
      fundStatuses,
      unclassifiedTransactions,
      setActiveTab,
      setSelectedMonth,
      setClassifyingTransaction,
      showToast,
      isOwnerAuthenticated,
      unlockCockpit,
      lockCockpit,
      refreshData,
      classifyTransaction,
      deleteTransaction,
      createFund,
      editFund,
      deleteFund,
      createCategory,
      syncEmail,
      disconnectGmail,
      closeMonth,
      savePaperTrade,
      deletePaperTrade,
      clearFinancialData,
      factoryReset,
    }),
    [
      transactions,
      funds,
      categories,
      gmailAccounts,
      monthlySnapshots,
      paperTrades,
      activeTab,
      selectedMonth,
      toast,
      isSyncing,
      classifyingTransaction,
      balance,
      currentMonthCashflow,
      selectedMonthCashflow,
      fundStatuses,
      unclassifiedTransactions,
      isOwnerAuthenticated,
      unlockCockpit,
      lockCockpit,
      setActiveTab,
      setSelectedMonth,
      setClassifyingTransaction,
      showToast,
      refreshData,
      classifyTransaction,
      deleteTransaction,
      createFund,
      editFund,
      deleteFund,
      createCategory,
      syncEmail,
      disconnectGmail,
      closeMonth,
      savePaperTrade,
      deletePaperTrade,
      clearFinancialData,
      factoryReset,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextType {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
