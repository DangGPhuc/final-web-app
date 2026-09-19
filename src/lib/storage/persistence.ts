/**
 * Storage persistence service — load/save AppDataSnapshot with versioned schema
 */

import type { StorageAdapter } from './storage';
import type { AppDataSnapshot, AppSettings } from '@/types';

export const STORAGE_KEY = 'personal_finance_v3';
export const SCHEMA_VERSION = 3;

const DEFAULT_SETTINGS: AppSettings = {
  openingBalance: 0,
  defaultCurrency: 'VND',
  trustedSenders: [],
  autoPostMinConfidence: 0.8,
};

export function createEmptySnapshot(): AppDataSnapshot {
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    transactions: [],
    funds: [],
    monthlySnapshots: [],
    merchantRules: [],
    emailParserRules: [],
    paperTrades: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

export type LoadResult =
  | { status: 'OK'; data: AppDataSnapshot }
  | { status: 'EMPTY'; data: AppDataSnapshot }
  | { status: 'MIGRATION'; data: AppDataSnapshot; message: string }
  | { status: 'ERROR'; error: string };

export function loadSnapshot(adapter: StorageAdapter, key: string = STORAGE_KEY): LoadResult {
  let raw: string | null;
  try {
    raw = adapter.getItem(key);
  } catch {
    return { status: 'ERROR', error: 'Không thể đọc dữ liệu từ bộ nhớ cục bộ' };
  }

  if (!raw) {
    return { status: 'EMPTY', data: createEmptySnapshot() };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 'ERROR', error: 'Dữ liệu lưu trữ không phải JSON hợp lệ' };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { status: 'ERROR', error: 'Dữ liệu lưu trữ không hợp lệ' };
  }

  const obj = parsed as Record<string, unknown>;

  // Check for old schema (v2 or earlier with wallets/budgets)
  if (obj.wallets || obj.budgets || (obj.schemaVersion && Number(obj.schemaVersion) < 3)) {
    // Old schema detected — start fresh
    return {
      status: 'MIGRATION',
      data: createEmptySnapshot(),
      message: 'Phát hiện dữ liệu phiên bản cũ. Đã khởi tạo lại với schema mới (v3). Dữ liệu cũ không bị xóa.',
    };
  }

  // Validate v3 schema
  const snapshot = obj as unknown as Partial<AppDataSnapshot>;
  return {
    status: 'OK',
    data: {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: typeof snapshot.exportedAt === 'string' ? snapshot.exportedAt : new Date().toISOString(),
      transactions: Array.isArray(snapshot.transactions) ? snapshot.transactions : [],
      funds: Array.isArray(snapshot.funds) ? snapshot.funds : [],
      monthlySnapshots: Array.isArray(snapshot.monthlySnapshots) ? snapshot.monthlySnapshots : [],
      merchantRules: Array.isArray(snapshot.merchantRules) ? snapshot.merchantRules : [],
      emailParserRules: Array.isArray(snapshot.emailParserRules) ? snapshot.emailParserRules : [],
      paperTrades: Array.isArray(snapshot.paperTrades) ? snapshot.paperTrades : [],
      settings: {
        openingBalance: typeof snapshot.settings?.openingBalance === 'number' ? snapshot.settings.openingBalance : DEFAULT_SETTINGS.openingBalance,
        defaultCurrency: typeof snapshot.settings?.defaultCurrency === 'string' ? snapshot.settings.defaultCurrency : DEFAULT_SETTINGS.defaultCurrency,
        trustedSenders: Array.isArray(snapshot.settings?.trustedSenders) ? snapshot.settings.trustedSenders : DEFAULT_SETTINGS.trustedSenders,
        autoPostMinConfidence: typeof snapshot.settings?.autoPostMinConfidence === 'number' ? snapshot.settings.autoPostMinConfidence : DEFAULT_SETTINGS.autoPostMinConfidence,
      },
    },
  };
}

export function saveSnapshot(adapter: StorageAdapter, data: AppDataSnapshot, key: string = STORAGE_KEY): { ok: boolean; error?: string } {
  try {
    const payload = { ...data, schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString() };
    adapter.setItem(key, JSON.stringify(payload));
    return { ok: true };
  } catch {
    return { ok: false, error: 'Không thể ghi dữ liệu vào bộ nhớ (dung lượng có thể đã đầy)' };
  }
}
