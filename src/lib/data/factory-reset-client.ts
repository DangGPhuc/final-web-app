import type { BankTransaction, Fund, Category, GmailAccountInfo, MonthlySnapshot, PaperTradeScenario } from '@/types';
import { DEMO_PAPER_TRADES } from '@/lib/mock-data';

/**
 * State setters required by executeFactoryReset to perform a complete in-memory purge.
 */
export interface FactoryResetStateSetters {
  setTransactions: (val: BankTransaction[]) => void;
  setFunds: (val: Fund[]) => void;
  setCategories: (val: Category[]) => void;
  setGmailAccounts: (val: GmailAccountInfo[]) => void;
  setMonthlySnapshots: (val: MonthlySnapshot[]) => void;
  setPaperTrades: (val: PaperTradeScenario[]) => void;
  setClassifyingTransaction: (val: BankTransaction | null) => void;
  setIsSyncing: (val: boolean) => void;
  setIsOwnerAuthenticated: (val: boolean) => void;
  showToast: (text: string, type?: 'success' | 'error' | 'info') => void;
}

/**
 * Client-side Factory Reset executor:
 * 1. Calls POST /api/data/factory-reset to wipe database records and clear owner cookie.
 * 2. Purges all in-memory domain and transient state.
 * 3. Sets isOwnerAuthenticated to false (causing UI to immediately display Owner Lock Screen).
 * 4. Strictly avoids calling refreshData() after reset.
 */
export async function executeFactoryReset(
  setters: FactoryResetStateSetters,
  fetchFn: typeof fetch = fetch
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetchFn('/api/data/factory-reset', { method: 'POST' });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Lỗi khôi phục hệ thống');
    }
    setters.setTransactions([]);
    setters.setFunds([]);
    setters.setCategories([]);
    setters.setGmailAccounts([]);
    setters.setMonthlySnapshots([]);
    setters.setPaperTrades(DEMO_PAPER_TRADES);
    setters.setClassifyingTransaction(null);
    setters.setIsSyncing(false);
    setters.setIsOwnerAuthenticated(false);
    setters.showToast(data.message || 'Đã khôi phục cài đặt gốc', 'info');
    return { success: true };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Lỗi khôi phục hệ thống';
    setters.showToast(errorMsg, 'error');
    return { success: false, error: errorMsg };
  }
}
