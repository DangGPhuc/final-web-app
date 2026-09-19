'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import type {
  Transaction,
  Fund,
  FundStatus,
  MonthlySnapshot,
  MerchantRule,
  PaperTradeScenario,
  AppSettings,
  AppTab,
  EmailConnectionState,
  ToastNotification,
  AppDataSnapshot,
} from '@/types';
import {
  calculateBalance,
  calculateMonthlyCashflow,
  calculateAllFundStatuses,
  calculateMonthlySnapshot,
  getCurrentYearMonth,
  generateId,
  classifyTransaction,
  type MonthlyCashflow,
} from '@/lib/finance/calculations';
import { LocalStorageAdapter } from '@/lib/storage/local-storage-adapter';
import {
  loadSnapshot,
  saveSnapshot,
  createEmptySnapshot,
  SCHEMA_VERSION,
} from '@/lib/storage/persistence';
import {
  DEMO_FUNDS,
  DEMO_TRANSACTIONS,
  DEMO_MONTHLY_SNAPSHOTS,
  DEMO_MERCHANT_RULES,
  DEMO_PAPER_TRADES,
} from '@/lib/mock-data';

interface AppContextType {
  // State
  transactions: Transaction[];
  funds: Fund[];
  monthlySnapshots: MonthlySnapshot[];
  merchantRules: MerchantRule[];
  paperTrades: PaperTradeScenario[];
  settings: AppSettings;
  emailConnection: EmailConnectionState;
  activeTab: AppTab;
  selectedMonth: string;
  quickAddOpen: boolean;
  toast: ToastNotification | null;

  // Derived metrics
  balance: number;
  currentMonthCashflow: MonthlyCashflow;
  selectedMonthCashflow: MonthlyCashflow;
  fundStatuses: FundStatus[];
  needsReviewTransactions: Transaction[];

  // Navigation & UI
  setActiveTab: (tab: AppTab) => void;
  setSelectedMonth: (month: string) => void;
  setQuickAddOpen: (open: boolean) => void;
  showToast: (text: string, type?: 'success' | 'error' | 'info') => void;

  // Transaction Operations
  addTransaction: (tx: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>) => void;
  editTransaction: (id: string, updates: Partial<Transaction>) => void;
  deleteTransaction: (id: string) => void;
  approveTransaction: (id: string) => void;
  ignoreTransaction: (id: string) => void;

  // Fund Operations
  createFund: (fund: Omit<Fund, 'id' | 'createdAt' | 'active'>) => void;
  editFund: (id: string, updates: Partial<Fund>) => void;
  deleteFund: (id: string) => void;

  // Month Snapshot / Close Operations
  closeMonth: (month: string) => void;

  // Merchant Rules
  addMerchantRule: (rule: Omit<MerchantRule, 'id' | 'createdAt'>) => void;
  deleteMerchantRule: (id: string) => void;

  // Paper Trading Operations
  savePaperTrade: (trade: Omit<PaperTradeScenario, 'id' | 'createdAt'>) => void;
  deletePaperTrade: (id: string) => void;

  // Settings & Sync
  updateSettings: (settings: Partial<AppSettings>) => void;
  syncEmail: (useDemoIfUnconfigured?: boolean) => Promise<void>;
  seedDemoData: () => void;
  clearData: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const storageAdapter = new LocalStorageAdapter();

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState<AppTab>('dashboard');
  const [selectedMonth, setSelectedMonth] = useState<string>(() => getCurrentYearMonth());
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [toast, setToast] = useState<ToastNotification | null>(null);

  // Core domain data
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [funds, setFunds] = useState<Fund[]>([]);
  const [monthlySnapshots, setMonthlySnapshots] = useState<MonthlySnapshot[]>([]);
  const [merchantRules, setMerchantRules] = useState<MerchantRule[]>([]);
  const [paperTrades, setPaperTrades] = useState<PaperTradeScenario[]>([]);
  const [settings, setSettings] = useState<AppSettings>({
    openingBalance: 0,
    defaultCurrency: 'VND',
    trustedSenders: ['vietcombank@vcb.com.vn', 'alert@techcombank.com.vn'],
    autoPostMinConfidence: 0.8,
  });

  // Email connection state
  const [emailConnection, setEmailConnection] = useState<EmailConnectionState>({
    provider: 'gmail',
    connected: false,
    syncStatus: 'idle',
  });

  const showToast = useCallback((text: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = generateId();
    setToast({ id, text, type });
    setTimeout(() => {
      setToast(prev => (prev?.id === id ? null : prev));
    }, 3500);
  }, []);

  // Initialize from storage adapter on mount
  useEffect(() => {
    const result = loadSnapshot(storageAdapter);
    if (result.status === 'OK') {
      setTransactions(result.data.transactions);
      setFunds(result.data.funds);
      setMonthlySnapshots(result.data.monthlySnapshots);
      setMerchantRules(result.data.merchantRules);
      setPaperTrades(result.data.paperTrades);
      setSettings(result.data.settings);
    } else if (result.status === 'MIGRATION') {
      showToast(result.message, 'info');
    }
    setIsLoaded(true);

    // Check email status
    fetch('/api/email/status')
      .then(res => res.json())
      .then(data => {
        setEmailConnection(prev => ({
          ...prev,
          connected: data.connected ?? false,
          email: data.email,
        }));
      })
      .catch(() => {
        // Network or offline, keep default
      });
  }, [showToast]);

  // Persist snapshot whenever domain data changes
  useEffect(() => {
    if (!isLoaded) return;
    const snapshot: AppDataSnapshot = {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      transactions,
      funds,
      monthlySnapshots,
      merchantRules,
      emailParserRules: [],
      paperTrades,
      settings,
    };
    saveSnapshot(storageAdapter, snapshot);
  }, [isLoaded, transactions, funds, monthlySnapshots, merchantRules, paperTrades, settings]);

  // Pure derived calculations
  const balance = useMemo(() => {
    return calculateBalance(settings.openingBalance, transactions);
  }, [settings.openingBalance, transactions]);

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

  const needsReviewTransactions = useMemo(() => {
    return transactions.filter(tx => tx.status === 'NEEDS_REVIEW');
  }, [transactions]);

  // Transaction Operations
  const addTransaction = useCallback((txData: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>) => {
    const now = new Date().toISOString();
    // Check auto classification if category is not set or default
    let assignedCategory = txData.category;
    let assignedFundId = txData.fundId;

    if (!assignedCategory || assignedCategory === 'Khác') {
      const classified = classifyTransaction(txData.description, txData.counterparty, merchantRules);
      assignedCategory = classified.category;
      if (!assignedFundId && classified.fundId) {
        assignedFundId = classified.fundId;
      }
    }

    const newTx: Transaction = {
      ...txData,
      id: generateId(),
      category: assignedCategory,
      fundId: assignedFundId,
      createdAt: now,
      updatedAt: now,
    };

    setTransactions(prev => [newTx, ...prev]);
    showToast('Đã ghi nhận giao dịch', 'success');
  }, [merchantRules, showToast]);

  const editTransaction = useCallback((id: string, updates: Partial<Transaction>) => {
    setTransactions(prev =>
      prev.map(tx => {
        if (tx.id !== id) return tx;
        return {
          ...tx,
          ...updates,
          updatedAt: new Date().toISOString(),
        };
      })
    );
    showToast('Đã cập nhật giao dịch', 'success');
  }, [showToast]);

  const deleteTransaction = useCallback((id: string) => {
    setTransactions(prev => prev.filter(tx => tx.id !== id));
    showToast('Đã xóa giao dịch', 'info');
  }, [showToast]);

  const approveTransaction = useCallback((id: string) => {
    editTransaction(id, { status: 'POSTED' });
    showToast('Đã duyệt giao dịch', 'success');
  }, [editTransaction, showToast]);

  const ignoreTransaction = useCallback((id: string) => {
    editTransaction(id, { status: 'IGNORED' });
    showToast('Đã bỏ qua giao dịch email', 'info');
  }, [editTransaction, showToast]);

  // Fund Operations
  const createFund = useCallback((fundData: Omit<Fund, 'id' | 'createdAt' | 'active'>) => {
    const newFund: Fund = {
      ...fundData,
      id: generateId(),
      createdAt: new Date().toISOString(),
      active: true,
    };
    setFunds(prev => [...prev, newFund]);
    showToast(`Đã tạo quỹ "${newFund.name}"`, 'success');
  }, [showToast]);

  const editFund = useCallback((id: string, updates: Partial<Fund>) => {
    setFunds(prev =>
      prev.map(f => (f.id === id ? { ...f, ...updates } : f))
    );
    showToast('Đã cập nhật quỹ', 'success');
  }, [showToast]);

  const deleteFund = useCallback((id: string) => {
    setFunds(prev => prev.filter(f => f.id !== id));
    showToast('Đã xóa quỹ', 'info');
  }, [showToast]);

  // Close month snapshot
  const closeMonth = useCallback((month: string) => {
    const snapshot = calculateMonthlySnapshot(month, transactions, funds);
    setMonthlySnapshots(prev => {
      const filtered = prev.filter(s => s.month !== month);
      return [...filtered, snapshot].sort((a, b) => a.month.localeCompare(b.month));
    });
    showToast(`Đã chốt sổ và lưu báo cáo tháng ${month}`, 'success');
  }, [transactions, funds, showToast]);

  // Merchant Rules
  const addMerchantRule = useCallback((ruleData: Omit<MerchantRule, 'id' | 'createdAt'>) => {
    const newRule: MerchantRule = {
      ...ruleData,
      id: generateId(),
      createdAt: new Date().toISOString(),
    };
    setMerchantRules(prev => [...prev, newRule]);
    showToast(`Đã lưu quy tắc cho từ khóa "${newRule.pattern}"`, 'success');
  }, [showToast]);

  const deleteMerchantRule = useCallback((id: string) => {
    setMerchantRules(prev => prev.filter(r => r.id !== id));
    showToast('Đã xóa quy tắc', 'info');
  }, [showToast]);

  // Paper Trading Operations
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

  // Settings
  const updateSettings = useCallback((newSettings: Partial<AppSettings>) => {
    setSettings(prev => ({ ...prev, ...newSettings }));
    showToast('Đã lưu cài đặt', 'success');
  }, [showToast]);

  // Email Sync via API
  const syncEmail = useCallback(async (useDemoIfUnconfigured = true) => {
    setEmailConnection(prev => ({ ...prev, syncStatus: 'syncing', syncError: undefined }));
    try {
      const res = await fetch('/api/email/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          existingTransactions: transactions,
          merchantRules,
          trustedSenders: settings.trustedSenders,
          autoPostMinConfidence: settings.autoPostMinConfidence,
          useDemoIfUnconfigured,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Lỗi đồng bộ email');
      }

      if (data.transactions?.length > 0) {
        setTransactions(prev => [...data.transactions, ...prev]);
        showToast(
          `Đồng bộ hoàn tất: +${data.stats.totalNew} giao dịch mới${
            data.stats.totalNeedsReview > 0 ? ` (${data.stats.totalNeedsReview} cần duyệt)` : ''
          }`,
          'success'
        );
      } else {
        showToast('Không có giao dịch mới từ email', 'info');
      }

      setEmailConnection(prev => ({
        ...prev,
        syncStatus: 'idle',
        lastSyncAt: data.syncedAt || new Date().toISOString(),
      }));
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Lỗi đồng bộ email';
      setEmailConnection(prev => ({
        ...prev,
        syncStatus: 'error',
        syncError: errorMsg,
      }));
      showToast(errorMsg, 'error');
    }
  }, [transactions, merchantRules, settings, showToast]);

  // Seed Demo Data for development / evaluation
  const seedDemoData = useCallback(() => {
    setFunds(DEMO_FUNDS);
    setTransactions(DEMO_TRANSACTIONS);
    setMonthlySnapshots(DEMO_MONTHLY_SNAPSHOTS);
    setMerchantRules(DEMO_MERCHANT_RULES);
    setPaperTrades(DEMO_PAPER_TRADES);
    setSettings({
      openingBalance: 5000000,
      defaultCurrency: 'VND',
      trustedSenders: ['vietcombank@vcb.com.vn', 'alert@techcombank.com.vn'],
      autoPostMinConfidence: 0.8,
    });
    showToast('Đã nạp dữ liệu mẫu thành công', 'success');
  }, [showToast]);

  // Clear data
  const clearData = useCallback(() => {
    const empty = createEmptySnapshot();
    setTransactions(empty.transactions);
    setFunds(empty.funds);
    setMonthlySnapshots(empty.monthlySnapshots);
    setMerchantRules(empty.merchantRules);
    setPaperTrades(empty.paperTrades);
    setSettings(empty.settings);
    storageAdapter.removeItem('personal_finance_v3');
    showToast('Đã xóa toàn bộ dữ liệu cục bộ', 'info');
  }, [showToast]);

  const value = useMemo(
    () => ({
      transactions,
      funds,
      monthlySnapshots,
      merchantRules,
      paperTrades,
      settings,
      emailConnection,
      activeTab,
      selectedMonth,
      quickAddOpen,
      toast,
      balance,
      currentMonthCashflow,
      selectedMonthCashflow,
      fundStatuses,
      needsReviewTransactions,
      setActiveTab,
      setSelectedMonth,
      setQuickAddOpen,
      showToast,
      addTransaction,
      editTransaction,
      deleteTransaction,
      approveTransaction,
      ignoreTransaction,
      createFund,
      editFund,
      deleteFund,
      closeMonth,
      addMerchantRule,
      deleteMerchantRule,
      savePaperTrade,
      deletePaperTrade,
      updateSettings,
      syncEmail,
      seedDemoData,
      clearData,
    }),
    [
      transactions,
      funds,
      monthlySnapshots,
      merchantRules,
      paperTrades,
      settings,
      emailConnection,
      activeTab,
      selectedMonth,
      quickAddOpen,
      toast,
      balance,
      currentMonthCashflow,
      selectedMonthCashflow,
      fundStatuses,
      needsReviewTransactions,
      setActiveTab,
      setSelectedMonth,
      setQuickAddOpen,
      showToast,
      addTransaction,
      editTransaction,
      deleteTransaction,
      approveTransaction,
      ignoreTransaction,
      createFund,
      editFund,
      deleteFund,
      closeMonth,
      addMerchantRule,
      deleteMerchantRule,
      savePaperTrade,
      deletePaperTrade,
      updateSettings,
      syncEmail,
      seedDemoData,
      clearData,
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
