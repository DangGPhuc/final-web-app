/**
 * FinTrack Pro v2 — Storage Service & Persistence Gate
 *
 * Encapsulates all read/write persistence logic behind a pluggable StorageAdapter.
 * Enforces:
 *   1. Non-destructive corruption handling: corrupt storage is never overwritten
 *   2. Quarantine preservation: raw bytes cloned to fintrack_recovery_corrupt_<timestamp>
 *   3. Truthful reporting: recoveryCopySaved tracks if setItem actually succeeded
 *   4. Pre-save validation: validateAndNormalizeAppSnapshot must succeed before setItem
 *   5. Memory-safe raw recovery download support
 */

import {
  ValidatedAppSnapshot,
  validateAndNormalizeAppSnapshot,
} from './storage-schema';

export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export class MemoryStorageAdapter implements StorageAdapter {
  private map = new Map<string, string>();
  public shouldFailSetItem = false;

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.shouldFailSetItem) {
      throw new Error('QuotaExceededError: storage is full');
    }
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }
}

export type LoadStorageResult =
  | { status: 'OK'; data?: ValidatedAppSnapshot }
  | {
      status: 'RECOVERY_REQUIRED';
      error: string;
      recoveryKey?: string;
      recoveryCopySaved: boolean;
      recoveryRawData: string;
    };

export type PersistStorageResult =
  | { ok: true; status: 'OK' }
  | { ok: false; status: 'SAVE_ERROR'; error: string };

/**
 * Safely load snapshot from adapter.
 * Leaves the primary storageKey untouched if corruption or schema validation fails.
 */
export function loadStorageSnapshot(
  adapter: StorageAdapter,
  storageKey: string
): LoadStorageResult {
  let raw: string | null = null;
  try {
    raw = adapter.getItem(storageKey);
  } catch (e) {
    return {
      status: 'RECOVERY_REQUIRED',
      error: 'Không thể đọc dữ liệu từ bộ nhớ cục bộ',
      recoveryCopySaved: false,
      recoveryRawData: '',
    };
  }

  if (!raw) {
    return { status: 'OK' };
  }

  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const recoveryKey = `fintrack_recovery_corrupt_${Date.now()}`;
    let recoveryCopySaved = false;
    try {
      adapter.setItem(recoveryKey, raw);
      recoveryCopySaved = true;
    } catch {
      recoveryCopySaved = false;
    }

    return {
      status: 'RECOVERY_REQUIRED',
      error: 'Dữ liệu lưu trữ không thể đọc được (JSON không hợp lệ).',
      recoveryKey,
      recoveryCopySaved,
      recoveryRawData: raw,
    };
  }

  // Validate snapshot schema
  const res = validateAndNormalizeAppSnapshot(parsed);
  if (!res.ok) {
    const recoveryKey = `fintrack_recovery_corrupt_${Date.now()}`;
    let recoveryCopySaved = false;
    try {
      adapter.setItem(recoveryKey, raw);
      recoveryCopySaved = true;
    } catch {
      recoveryCopySaved = false;
    }

    return {
      status: 'RECOVERY_REQUIRED',
      error: `Dữ liệu không vượt qua kiểm tra tính toàn vẹn: ${res.error}`,
      recoveryKey,
      recoveryCopySaved,
      recoveryRawData: raw,
    };
  }

  return { status: 'OK', data: res.data };
}

/**
 * Safely persist snapshot to adapter.
 * Performs pre-save validation gate: if the in-memory payload is invalid,
 * it refuses to overwrite storage and returns SAVE_ERROR.
 */
export function persistStorageSnapshot(
  adapter: StorageAdapter,
  storageKey: string,
  payload: unknown
): PersistStorageResult {
  const validationRes = validateAndNormalizeAppSnapshot(payload);
  if (!validationRes.ok) {
    return {
      ok: false,
      status: 'SAVE_ERROR',
      error: `Từ chối lưu dữ liệu không hợp lệ: ${validationRes.error}`,
    };
  }

  try {
    adapter.setItem(storageKey, JSON.stringify(payload));
    return { ok: true, status: 'OK' };
  } catch (e) {
    return {
      ok: false,
      status: 'SAVE_ERROR',
      error: 'Không thể ghi dữ liệu vào bộ nhớ (dung lượng lưu trữ có thể đã đầy).',
    };
  }
}
