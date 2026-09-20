/**
 * Storage persistence service — handles UI preferences and legacy migration
 */

import type { StorageAdapter } from './storage';

export const STORAGE_KEY = 'personal_finance_v3';
export const SCHEMA_VERSION = 3;

export interface LegacyAppDataSnapshot {
  schemaVersion: number;
  exportedAt: string;
  transactions: unknown[];
  funds: unknown[];
  monthlySnapshots: unknown[];
  paperTrades: unknown[];
}

export function createEmptySnapshot(): LegacyAppDataSnapshot {
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    transactions: [],
    funds: [],
    monthlySnapshots: [],
    paperTrades: [],
  };
}

export type LoadResult =
  | { status: 'OK'; data: LegacyAppDataSnapshot }
  | { status: 'EMPTY'; data: LegacyAppDataSnapshot }
  | { status: 'MIGRATION'; data: LegacyAppDataSnapshot; message: string }
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
    return {
      status: 'MIGRATION',
      data: createEmptySnapshot(),
      message: 'Phát hiện dữ liệu phiên bản cũ. Đã khởi tạo lại với schema mới (v3). Dữ liệu cũ không bị xóa.',
    };
  }

  return {
    status: 'OK',
    data: {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : new Date().toISOString(),
      transactions: Array.isArray(obj.transactions) ? obj.transactions : [],
      funds: Array.isArray(obj.funds) ? obj.funds : [],
      monthlySnapshots: Array.isArray(obj.monthlySnapshots) ? obj.monthlySnapshots : [],
      paperTrades: Array.isArray(obj.paperTrades) ? obj.paperTrades : [],
    },
  };
}

export function saveSnapshot(
  adapter: StorageAdapter,
  data: LegacyAppDataSnapshot,
  key: string = STORAGE_KEY
): { ok: boolean; error?: string } {
  try {
    const payload = { ...data, schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString() };
    adapter.setItem(key, JSON.stringify(payload));
    return { ok: true };
  } catch {
    return { ok: false, error: 'Không thể ghi dữ liệu vào bộ nhớ' };
  }
}
