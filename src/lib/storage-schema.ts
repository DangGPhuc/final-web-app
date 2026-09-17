/**
 * FinTrack Pro v2 — Storage Schema Validation & Migration
 *
 * This module is the single gatekeeper for all persisted data entering the app,
 * whether from localStorage, a backup JSON import, or pre-save in-memory verification.
 *
 * SCHEMA VERSION HISTORY
 * ─────────────────────
 * Version 0 (legacy / unversioned): Original FinTrack v2 snapshots without
 *   a schemaVersion field. Migrated to v1.
 * Version 1 (current): Schema versioning, split TRANSFER validation by transferKind,
 *   strict category referential integrity, system transaction invariants,
 *   bill ↔ payment bidirectional integrity, and receipt data format/size constraints.
 */

import {
  Wallet,
  WalletType,
  Transaction,
  TransactionType,
  Category,
  Budget,
  RecurringBill,
  BillFrequency,
  BillStatus,
  SavingsGoal,
  IncomeBudgetPlanner,
  TransactionOrigin,
  TransferKind,
} from '@/types';

/** Current storage schema version. */
export const SCHEMA_VERSION = 1;

/** Maximum import payload size (bytes). Payloads larger than this are rejected. */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024; // 5 MB

/** Maximum local receipt image size in bytes (1 MB binary equivalent). */
export const LOCAL_RECEIPT_MAX_BYTES = 1 * 1024 * 1024; // 1 MB

/** Maximum base64 Data URL string length allowed for local storage. */
export const LOCAL_RECEIPT_MAX_STRING_LENGTH = Math.ceil((LOCAL_RECEIPT_MAX_BYTES * 4) / 3) + 128;

/** Untrusted payload caps to prevent memory/CPU exhaustion attacks. */
export const MAX_COLLECTION_LIMITS = {
  categories: 100,
  wallets: 100,
  goals: 100,
  bills: 200,
  budgets: 500,
  transactions: 10000,
  tagsPerTransaction: 20,
  maxStringLength: 1000,
  maxNameLength: 150,
  maxTagLength: 50,
} as const;

export interface ValidatedAppSnapshot {
  wallets: Wallet[];
  transactions: Transaction[];
  categories: Category[];
  budgets: Budget[];
  bills: RecurringBill[];
  goals: SavingsGoal[];
  planner: IncomeBudgetPlanner;
}

export type SnapshotValidationResult =
  | { ok: true; data: ValidatedAppSnapshot }
  | { ok: false; error: string };

/** Storage lifecycle state exposed to UI */
export type StorageStatus = 'LOADING' | 'OK' | 'RECOVERY_REQUIRED' | 'SAVE_ERROR';

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

export function getUtf8ByteLength(str: string): number {
  return new TextEncoder().encode(str).byteLength;
}

const VALID_WALLET_TYPES: WalletType[] = ['CASH', 'BANK', 'CREDIT', 'SAVINGS'];
const VALID_TRANSACTION_TYPES: TransactionType[] = ['EXPENSE', 'INCOME', 'TRANSFER'];
const VALID_BILL_FREQUENCIES: BillFrequency[] = ['MONTHLY', 'QUARTERLY', 'YEARLY'];
const VALID_BILL_STATUSES: BillStatus[] = ['PAID', 'UNPAID'];
const VALID_TRANSACTION_ORIGINS: TransactionOrigin[] = ['MANUAL', 'GOAL', 'BILL_PAYMENT'];
const VALID_TRANSFER_KINDS: TransferKind[] = [
  'WALLET_TRANSFER',
  'CREDIT_PAYMENT',
  'GOAL_DEPOSIT',
  'GOAL_WITHDRAWAL',
];

const VALID_RECEIPT_DATA_URL_REGEX = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

function validatePersistedReceipt(
  val: unknown,
  txId: string
): { ok: true; url?: string } | { ok: false; error: string } {
  if (val === undefined || val === null || val === '') {
    return { ok: true, url: undefined };
  }
  if (typeof val !== 'string') {
    return {
      ok: false,
      error: `Biên lai của giao dịch "${txId}" phải là chuỗi ký tự Data URL hợp lệ`,
    };
  }
  const trimmed = val.trim();
  if (trimmed.length > LOCAL_RECEIPT_MAX_STRING_LENGTH) {
    return {
      ok: false,
      error: `Ảnh biên lai của giao dịch "${txId}" vượt quá giới hạn lưu trữ cục bộ (${LOCAL_RECEIPT_MAX_BYTES / (1024 * 1024)} MB)`,
    };
  }
  const lower = trimmed.toLowerCase();
  if (
    lower.includes('javascript:') ||
    lower.includes('image/svg') ||
    lower.includes('<svg') ||
    lower.includes('<html') ||
    lower.includes('http://') ||
    lower.includes('https://')
  ) {
    return {
      ok: false,
      error: `Ảnh biên lai của giao dịch "${txId}" chứa nội dung hoặc định dạng không an toàn (SVG/HTML/URL)`,
    };
  }
  if (!VALID_RECEIPT_DATA_URL_REGEX.test(trimmed)) {
    return {
      ok: false,
      error: `Ảnh biên lai của giao dịch "${txId}" không phải là Data URL hợp lệ (chỉ chấp nhận JPEG, PNG, WebP)`,
    };
  }
  return { ok: true, url: trimmed };
}

// ─────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────

/**
 * Validate and normalize an application data snapshot.
 */
export function validateAndNormalizeAppSnapshot(input: unknown): SnapshotValidationResult {
  if (!isObject(input)) {
    return { ok: false, error: 'Dữ liệu snapshot không phải là một đối tượng JSON hợp lệ' };
  }

  // Schema version detection
  const rawVersion = input.schemaVersion;

  if (rawVersion === undefined || rawVersion === null) {
    // Legacy (v0 / unversioned) snapshot — migrate to v1
    return validateV1(input);
  }

  if (typeof rawVersion !== 'number' || !Number.isInteger(rawVersion) || rawVersion < 1) {
    return { ok: false, error: `Phiên bản schema không hợp lệ: ${rawVersion}` };
  }

  if (rawVersion > SCHEMA_VERSION) {
    return {
      ok: false,
      error: `Phiên bản schema (${rawVersion}) mới hơn phiên bản ứng dụng hỗ trợ (${SCHEMA_VERSION}). Vui lòng cập nhật ứng dụng.`,
    };
  }

  return validateV1(input);
}

// ─────────────────────────────────────────────────────────────
// V1 Validator
// ─────────────────────────────────────────────────────────────

function validateV1(input: Record<string, unknown>): SnapshotValidationResult {
  // ── 1. CATEGORIES ─────────────────────────────────────────
  if (!Array.isArray(input.categories)) {
    return { ok: false, error: 'Danh mục (categories) phải là một danh sách' };
  }
  if (input.categories.length > MAX_COLLECTION_LIMITS.categories) {
    return {
      ok: false,
      error: `Số lượng danh mục vượt quá giới hạn tối đa (${input.categories.length} > ${MAX_COLLECTION_LIMITS.categories})`,
    };
  }

  const categoryMap = new Map<string, Category>();
  const expenseCategoryIds = new Set<string>();
  const incomeCategoryIds = new Set<string>();
  const validatedCategories: Category[] = [];

  for (let i = 0; i < input.categories.length; i++) {
    const c = input.categories[i];
    if (!isObject(c)) {
      return { ok: false, error: `Danh mục tại vị trí ${i} không hợp lệ` };
    }
    if (typeof c.id !== 'string' || !c.id.trim()) {
      return { ok: false, error: `Danh mục tại vị trí ${i} thiếu ID hợp lệ` };
    }
    if (categoryMap.has(c.id)) {
      return { ok: false, error: `ID danh mục trùng lặp: ${c.id}` };
    }
    if (typeof c.name !== 'string' || !c.name.trim()) {
      return { ok: false, error: `Tên danh mục "${c.id}" không được để trống` };
    }
    if (c.name.trim().length > MAX_COLLECTION_LIMITS.maxNameLength) {
      return { ok: false, error: `Tên danh mục "${c.id}" vượt quá độ dài cho phép` };
    }
    if (c.type !== 'EXPENSE' && c.type !== 'INCOME') {
      return { ok: false, error: `Loại danh mục "${c.id}" phải là EXPENSE hoặc INCOME` };
    }

    const validatedCategory: Category = {
      id: c.id,
      name: c.name.trim(),
      type: c.type,
      icon: typeof c.icon === 'string' ? c.icon : 'Tag',
      color: typeof c.color === 'string' ? c.color : '#64748b',
    };

    categoryMap.set(c.id, validatedCategory);
    if (c.type === 'EXPENSE') {
      expenseCategoryIds.add(c.id);
    } else {
      incomeCategoryIds.add(c.id);
    }
    validatedCategories.push(validatedCategory);
  }

  // ── 2. WALLETS ────────────────────────────────────────────
  if (!Array.isArray(input.wallets)) {
    return { ok: false, error: 'Ví tiền (wallets) phải là một danh sách' };
  }
  if (input.wallets.length > MAX_COLLECTION_LIMITS.wallets) {
    return {
      ok: false,
      error: `Số lượng ví vượt quá giới hạn tối đa (${input.wallets.length} > ${MAX_COLLECTION_LIMITS.wallets})`,
    };
  }

  const walletMap = new Map<string, Wallet>();
  const validatedWallets: Wallet[] = [];
  for (let i = 0; i < input.wallets.length; i++) {
    const w = input.wallets[i];
    if (!isObject(w)) {
      return { ok: false, error: `Ví tại vị trí ${i} không hợp lệ` };
    }
    if (typeof w.id !== 'string' || !w.id.trim()) {
      return { ok: false, error: `Ví tại vị trí ${i} thiếu ID hợp lệ` };
    }
    if (walletMap.has(w.id)) {
      return { ok: false, error: `ID ví trùng lặp: ${w.id}` };
    }
    if (typeof w.name !== 'string' || !w.name.trim()) {
      return { ok: false, error: `Tên ví "${w.id}" không được để trống` };
    }
    if (w.name.trim().length > MAX_COLLECTION_LIMITS.maxNameLength) {
      return { ok: false, error: `Tên ví "${w.id}" vượt quá độ dài cho phép` };
    }
    if (!VALID_WALLET_TYPES.includes(w.type as WalletType)) {
      return { ok: false, error: `Loại ví "${w.id}" không hợp lệ (${w.type})` };
    }
    if (typeof w.balance !== 'number' || !Number.isFinite(w.balance) || w.balance < 0) {
      return { ok: false, error: `Số dư/dư nợ của ví "${w.name}" phải là số hữu hạn không âm (>= 0)` };
    }
    if (w.type === 'CREDIT') {
      if (typeof w.creditLimit !== 'number' || !Number.isFinite(w.creditLimit) || w.creditLimit <= 0) {
        return { ok: false, error: `Hạn mức thẻ tín dụng "${w.name}" phải là số hữu hạn lớn hơn 0` };
      }
      if (w.balance > w.creditLimit) {
        return { ok: false, error: `Dư nợ thẻ "${w.name}" (${w.balance}) vượt quá hạn mức (${w.creditLimit})` };
      }
    }
    if (w.type === 'SAVINGS' && w.interestRate !== undefined) {
      if (typeof w.interestRate !== 'number' || !Number.isFinite(w.interestRate) || w.interestRate < 0) {
        return { ok: false, error: `Lãi suất sổ tiết kiệm "${w.name}" phải là số hữu hạn không âm` };
      }
    }
    const validatedWallet: Wallet = {
      id: w.id,
      name: w.name.trim(),
      type: w.type as WalletType,
      balance: w.balance,
      initialBalance:
        typeof w.initialBalance === 'number' && Number.isFinite(w.initialBalance)
          ? w.initialBalance
          : w.balance,
      currency: typeof w.currency === 'string' ? w.currency : 'VND',
      color: typeof w.color === 'string' ? w.color : '#0ea5e9',
      icon: typeof w.icon === 'string' ? w.icon : 'Wallet',
      bankName: typeof w.bankName === 'string' ? w.bankName : undefined,
      accountNumber: typeof w.accountNumber === 'string' ? w.accountNumber : undefined,
      creditLimit: w.type === 'CREDIT' ? (w.creditLimit as number) : undefined,
      interestRate:
        w.type === 'SAVINGS' && typeof w.interestRate === 'number' ? w.interestRate : undefined,
      isExcludedFromTotal: Boolean(w.isExcludedFromTotal),
      createdAt: typeof w.createdAt === 'string' ? w.createdAt : new Date().toISOString(),
    };
    walletMap.set(w.id, validatedWallet);
    validatedWallets.push(validatedWallet);
  }

  // ── 3. GOALS ──────────────────────────────────────────────
  if (!Array.isArray(input.goals)) {
    return { ok: false, error: 'Mục tiêu (goals) phải là một danh sách' };
  }
  if (input.goals.length > MAX_COLLECTION_LIMITS.goals) {
    return {
      ok: false,
      error: `Số lượng mục tiêu vượt quá giới hạn tối đa (${input.goals.length} > ${MAX_COLLECTION_LIMITS.goals})`,
    };
  }

  const goalMap = new Map<string, SavingsGoal>();
  const validatedGoals: SavingsGoal[] = [];
  for (let i = 0; i < input.goals.length; i++) {
    const g = input.goals[i];
    if (!isObject(g)) {
      return { ok: false, error: `Mục tiêu tại vị trí ${i} không hợp lệ` };
    }
    if (typeof g.id !== 'string' || !g.id.trim()) {
      return { ok: false, error: `Mục tiêu tại vị trí ${i} thiếu ID hợp lệ` };
    }
    if (goalMap.has(g.id)) {
      return { ok: false, error: `ID mục tiêu trùng lặp: ${g.id}` };
    }
    if (typeof g.name !== 'string' || !g.name.trim()) {
      return { ok: false, error: `Tên mục tiêu "${g.id}" không được để trống` };
    }
    if (g.name.trim().length > MAX_COLLECTION_LIMITS.maxNameLength) {
      return { ok: false, error: `Tên mục tiêu "${g.id}" vượt quá độ dài cho phép` };
    }
    if (typeof g.targetAmount !== 'number' || !Number.isFinite(g.targetAmount) || g.targetAmount <= 0) {
      return { ok: false, error: `Số tiền mục tiêu "${g.id}" phải là số hữu hạn lớn hơn 0` };
    }
    if (typeof g.currentAmount !== 'number' || !Number.isFinite(g.currentAmount) || g.currentAmount < 0) {
      return { ok: false, error: `Số tiền hiện có của mục tiêu "${g.id}" phải là số hữu hạn không âm` };
    }
    if (typeof g.deadline !== 'string' || isNaN(new Date(g.deadline).getTime())) {
      return { ok: false, error: `Hạn hoàn thành của mục tiêu "${g.id}" không hợp lệ` };
    }

    const validatedHistory: SavingsGoal['history'] = [];
    if (g.history !== undefined) {
      if (!Array.isArray(g.history)) {
        return { ok: false, error: `Lịch sử của mục tiêu "${g.id}" phải là một danh sách` };
      }
      for (let j = 0; j < g.history.length; j++) {
        const h = g.history[j];
        if (!isObject(h)) {
          return { ok: false, error: `Lịch sử mục tiêu "${g.id}" tại dòng ${j} không hợp lệ` };
        }
        if (typeof h.id !== 'string' || !h.id.trim()) {
          return { ok: false, error: `Lịch sử mục tiêu "${g.id}" thiếu ID hợp lệ tại dòng ${j}` };
        }
        if (typeof h.amount !== 'number' || !Number.isFinite(h.amount) || h.amount <= 0) {
          return { ok: false, error: `Số tiền trong lịch sử mục tiêu "${g.id}" phải lớn hơn 0 tại dòng ${j}` };
        }
        if (h.type !== 'DEPOSIT' && h.type !== 'WITHDRAW') {
          return { ok: false, error: `Loại lịch sử "${h.type}" trong mục tiêu "${g.id}" không hợp lệ` };
        }
        if (h.walletId !== undefined && typeof h.walletId === 'string' && !walletMap.has(h.walletId)) {
          return { ok: false, error: `Lịch sử mục tiêu "${g.id}" tham chiếu đến ví không tồn tại: ${h.walletId}` };
        }
        validatedHistory.push({
          id: h.id,
          date: typeof h.date === 'string' ? h.date : new Date().toISOString(),
          amount: h.amount,
          type: h.type,
          walletId: typeof h.walletId === 'string' ? h.walletId : undefined,
          note: typeof h.note === 'string' ? h.note : undefined,
        });
      }
    }

    const validatedGoal: SavingsGoal = {
      id: g.id,
      name: g.name.trim(),
      targetAmount: g.targetAmount,
      currentAmount: g.currentAmount,
      deadline: g.deadline,
      color: typeof g.color === 'string' ? g.color : '#0ea5e9',
      icon: typeof g.icon === 'string' ? g.icon : 'Target',
      category: typeof g.category === 'string' ? g.category : undefined,
      history: validatedHistory,
      createdAt: typeof g.createdAt === 'string' ? g.createdAt : new Date().toISOString(),
    };
    goalMap.set(g.id, validatedGoal);
    validatedGoals.push(validatedGoal);
  }

  // ── 4. BILLS ──────────────────────────────────────────────
  if (!Array.isArray(input.bills)) {
    return { ok: false, error: 'Hóa đơn (bills) phải là một danh sách' };
  }
  if (input.bills.length > MAX_COLLECTION_LIMITS.bills) {
    return {
      ok: false,
      error: `Số lượng hóa đơn vượt quá giới hạn tối đa (${input.bills.length} > ${MAX_COLLECTION_LIMITS.bills})`,
    };
  }

  const billMap = new Map<string, RecurringBill>();
  const validatedBills: RecurringBill[] = [];
  for (let i = 0; i < input.bills.length; i++) {
    const bill = input.bills[i];
    if (!isObject(bill)) {
      return { ok: false, error: `Hóa đơn tại vị trí ${i} không hợp lệ` };
    }
    if (typeof bill.id !== 'string' || !bill.id.trim()) {
      return { ok: false, error: `Hóa đơn tại vị trí ${i} thiếu ID hợp lệ` };
    }
    if (billMap.has(bill.id)) {
      return { ok: false, error: `ID hóa đơn trùng lặp: ${bill.id}` };
    }
    if (typeof bill.name !== 'string' || !bill.name.trim()) {
      return { ok: false, error: `Tên hóa đơn "${bill.id}" không được để trống` };
    }
    if (bill.name.trim().length > MAX_COLLECTION_LIMITS.maxNameLength) {
      return { ok: false, error: `Tên hóa đơn "${bill.id}" vượt quá độ dài cho phép` };
    }
    if (typeof bill.amount !== 'number' || !Number.isFinite(bill.amount) || bill.amount <= 0) {
      return { ok: false, error: `Số tiền hóa đơn "${bill.id}" phải là số hữu hạn lớn hơn 0` };
    }
    if (
      typeof bill.dueDay !== 'number' ||
      !Number.isInteger(bill.dueDay) ||
      bill.dueDay < 1 ||
      bill.dueDay > 31
    ) {
      return { ok: false, error: `Ngày đến hạn của hóa đơn "${bill.id}" phải là số nguyên từ 1 đến 31` };
    }
    if (!VALID_BILL_FREQUENCIES.includes(bill.frequency as BillFrequency)) {
      return { ok: false, error: `Tần suất hóa đơn "${bill.id}" không hợp lệ (${bill.frequency})` };
    }
    if (!VALID_BILL_STATUSES.includes(bill.status as BillStatus)) {
      return { ok: false, error: `Trạng thái hóa đơn "${bill.id}" không hợp lệ (${bill.status})` };
    }
    if (bill.walletId !== undefined && typeof bill.walletId === 'string' && !walletMap.has(bill.walletId)) {
      return {
        ok: false,
        error: `Hóa đơn "${bill.id}" tham chiếu đến ví không tồn tại (walletId: ${bill.walletId})`,
      };
    }

    // Bill category must exist and be an EXPENSE category
    const billCategoryId = typeof bill.categoryId === 'string' ? bill.categoryId : 'cat-bills';
    if (!categoryMap.has(billCategoryId)) {
      return {
        ok: false,
        error: `Hóa đơn "${bill.id}" tham chiếu đến danh mục không tồn tại (${billCategoryId})`,
      };
    }
    const billCat = categoryMap.get(billCategoryId)!;
    if (billCat.type !== 'EXPENSE') {
      return {
        ok: false,
        error: `Hóa đơn "${bill.id}" tham chiếu danh mục thu nhập "${billCat.name}". Chỉ danh mục EXPENSE được phép.`,
      };
    }

    const validatedBill: RecurringBill = {
      id: bill.id,
      name: bill.name.trim(),
      amount: bill.amount,
      categoryId: billCategoryId,
      categoryName: billCat.name,
      walletId: typeof bill.walletId === 'string' ? bill.walletId : undefined,
      dueDay: bill.dueDay,
      frequency: bill.frequency as BillFrequency,
      status: bill.status as BillStatus,
      lastPaidDate: typeof bill.lastPaidDate === 'string' ? bill.lastPaidDate : undefined,
      note: typeof bill.note === 'string' ? bill.note : undefined,
      reminderDaysBefore: typeof bill.reminderDaysBefore === 'number' ? bill.reminderDaysBefore : 3,
    };
    billMap.set(bill.id, validatedBill);
    validatedBills.push(validatedBill);
  }

  // ── 5. TRANSACTIONS ───────────────────────────────────────
  if (!Array.isArray(input.transactions)) {
    return { ok: false, error: 'Giao dịch (transactions) phải là một danh sách' };
  }
  if (input.transactions.length > MAX_COLLECTION_LIMITS.transactions) {
    return {
      ok: false,
      error: `Số lượng giao dịch vượt quá giới hạn tối đa (${input.transactions.length} > ${MAX_COLLECTION_LIMITS.transactions})`,
    };
  }

  const txIds = new Set<string>();
  const billPaymentTxCount = new Map<string, number>();
  const validatedTransactions: Transaction[] = [];

  for (let i = 0; i < input.transactions.length; i++) {
    const t = input.transactions[i];
    if (!isObject(t)) {
      return { ok: false, error: `Giao dịch tại vị trí ${i} không hợp lệ` };
    }
    if (typeof t.id !== 'string' || !t.id.trim()) {
      return { ok: false, error: `Giao dịch tại vị trí ${i} thiếu ID hợp lệ` };
    }
    if (txIds.has(t.id)) {
      return { ok: false, error: `ID giao dịch trùng lặp: ${t.id}` };
    }
    txIds.add(t.id);

    if (!VALID_TRANSACTION_TYPES.includes(t.type as TransactionType)) {
      return { ok: false, error: `Loại giao dịch "${t.id}" không hợp lệ (${t.type})` };
    }
    if (typeof t.amount !== 'number' || !Number.isFinite(t.amount) || t.amount <= 0) {
      return { ok: false, error: `Số tiền của giao dịch "${t.id}" phải là số hữu hạn lớn hơn 0` };
    }
    if (typeof t.date !== 'string' || isNaN(new Date(t.date).getTime())) {
      return { ok: false, error: `Ngày của giao dịch "${t.id}" không hợp lệ` };
    }
    if (typeof t.walletId !== 'string' || !walletMap.has(t.walletId)) {
      return {
        ok: false,
        error: `Giao dịch "${t.id}" tham chiếu đến ví không tồn tại (walletId: ${t.walletId})`,
      };
    }
    const srcWallet = walletMap.get(t.walletId)!;

    // ── Category Referential Integrity ──────────────────────
    let categoryId: string | undefined = undefined;
    let categoryName: string | undefined = undefined;

    if (t.type === 'EXPENSE') {
      if (t.categoryId !== undefined && t.categoryId !== null && t.categoryId !== '') {
        if (typeof t.categoryId !== 'string' || !categoryMap.has(t.categoryId)) {
          return {
            ok: false,
            error: `Giao dịch chi tiêu "${t.id}" tham chiếu đến danh mục không tồn tại (${t.categoryId})`,
          };
        }
        const cat = categoryMap.get(t.categoryId)!;
        if (cat.type !== 'EXPENSE') {
          return {
            ok: false,
            error: `Giao dịch chi tiêu "${t.id}" tham chiếu đến danh mục thu nhập "${cat.name}" (${t.categoryId}). Chỉ danh mục EXPENSE được phép.`,
          };
        }
        categoryId = cat.id;
        categoryName =
          typeof t.categoryName === 'string' && t.categoryName.trim() ? t.categoryName.trim() : cat.name;
      }
    } else if (t.type === 'INCOME') {
      if (srcWallet.type === 'CREDIT') {
        return {
          ok: false,
          error: `Giao dịch thu nhập "${t.id}" trực tiếp vào thẻ tín dụng không được hỗ trợ`,
        };
      }
      if (t.categoryId !== undefined && t.categoryId !== null && t.categoryId !== '') {
        if (typeof t.categoryId !== 'string' || !categoryMap.has(t.categoryId)) {
          return {
            ok: false,
            error: `Giao dịch thu nhập "${t.id}" tham chiếu đến danh mục không tồn tại (${t.categoryId})`,
          };
        }
        const cat = categoryMap.get(t.categoryId)!;
        if (cat.type !== 'INCOME') {
          return {
            ok: false,
            error: `Giao dịch thu nhập "${t.id}" tham chiếu đến danh mục chi tiêu "${cat.name}" (${t.categoryId}). Chỉ danh mục INCOME được phép.`,
          };
        }
        categoryId = cat.id;
        categoryName =
          typeof t.categoryName === 'string' && t.categoryName.trim() ? t.categoryName.trim() : cat.name;
      }
    } else if (t.type === 'TRANSFER') {
      // Cleanse transfer category fields to prevent stale spending semantics
      if (t.categoryId !== undefined && t.categoryId !== null && t.categoryId !== '') {
        if (typeof t.categoryId !== 'string' || !categoryMap.has(t.categoryId)) {
          return {
            ok: false,
            error: `Giao dịch chuyển khoản "${t.id}" tham chiếu đến danh mục không tồn tại (${t.categoryId})`,
          };
        }
      }
      categoryId = undefined;
      categoryName = undefined;
    }

    // ── TRANSFER validation split by transferKind ─────────────
    let toWalletId: string | undefined = undefined;
    let toWalletName: string | undefined = undefined;
    let transferKind: TransferKind | undefined = undefined;
    let fee = 0;

    if (t.type === 'TRANSFER') {
      let rawKind = t.transferKind as string | undefined;
      if (!rawKind && typeof t.toWalletId === 'string' && walletMap.has(t.toWalletId)) {
        const dest = walletMap.get(t.toWalletId)!;
        rawKind = dest.type === 'CREDIT' ? 'CREDIT_PAYMENT' : 'WALLET_TRANSFER';
      }
      if (!rawKind || !VALID_TRANSFER_KINDS.includes(rawKind as TransferKind)) {
        return {
          ok: false,
          error: `Giao dịch chuyển khoản "${t.id}" có transferKind không hợp lệ hoặc bị thiếu (${rawKind})`,
        };
      }
      transferKind = rawKind as TransferKind;

      if (transferKind === 'WALLET_TRANSFER' || transferKind === 'CREDIT_PAYMENT') {
        if (typeof t.toWalletId !== 'string' || !walletMap.has(t.toWalletId)) {
          return {
            ok: false,
            error: `Giao dịch chuyển khoản "${t.id}" (${transferKind}) thiếu ví nhận hoặc ví nhận không tồn tại`,
          };
        }
        if (t.toWalletId === t.walletId) {
          return {
            ok: false,
            error: `Giao dịch chuyển khoản "${t.id}" có ví nhận trùng ví gửi`,
          };
        }
        if (srcWallet.type === 'CREDIT') {
          return {
            ok: false,
            error: `Giao dịch "${t.id}" chuyển khoản từ thẻ tín dụng là không được phép`,
          };
        }
        const destWallet = walletMap.get(t.toWalletId)!;
        if (transferKind === 'CREDIT_PAYMENT' && destWallet.type !== 'CREDIT') {
          return {
            ok: false,
            error: `Giao dịch "${t.id}" khai báo là CREDIT_PAYMENT nhưng ví nhận không phải thẻ tín dụng`,
          };
        }
        if (transferKind === 'WALLET_TRANSFER' && destWallet.type === 'CREDIT') {
          return {
            ok: false,
            error: `Giao dịch "${t.id}" khai báo là WALLET_TRANSFER nhưng ví nhận là thẻ tín dụng`,
          };
        }
        toWalletId = destWallet.id;
        toWalletName = destWallet.name;
        if (t.fee !== undefined) {
          if (typeof t.fee !== 'number' || !Number.isFinite(t.fee) || t.fee < 0) {
            return { ok: false, error: `Phí chuyển khoản của giao dịch "${t.id}" không hợp lệ` };
          }
          fee = t.fee;
        }
      } else if (transferKind === 'GOAL_DEPOSIT') {
        if (srcWallet.type === 'CREDIT') {
          return {
            ok: false,
            error: `Giao dịch "${t.id}" nạp tiền vào mục tiêu từ thẻ tín dụng là không được phép`,
          };
        }
        if (t.origin !== 'GOAL') {
          return {
            ok: false,
            error: `Giao dịch GOAL_DEPOSIT "${t.id}" phải có origin là "GOAL" (nhận được: ${t.origin})`,
          };
        }
        if (typeof t.goalId !== 'string' || !t.goalId.trim()) {
          return { ok: false, error: `Giao dịch GOAL_DEPOSIT "${t.id}" thiếu goalId` };
        }
        if (typeof t.originId !== 'string' || !t.originId.trim()) {
          return { ok: false, error: `Giao dịch GOAL_DEPOSIT "${t.id}" thiếu originId` };
        }
        if (t.goalId !== t.originId) {
          return {
            ok: false,
            error: `Giao dịch GOAL_DEPOSIT "${t.id}" có goalId (${t.goalId}) không khớp với originId (${t.originId})`,
          };
        }
        if (!goalMap.has(t.goalId)) {
          return {
            ok: false,
            error: `Giao dịch GOAL_DEPOSIT "${t.id}" tham chiếu mục tiêu không tồn tại (${t.goalId})`,
          };
        }
      } else if (transferKind === 'GOAL_WITHDRAWAL') {
        if (srcWallet.type === 'CREDIT') {
          return {
            ok: false,
            error: `Giao dịch "${t.id}" rút tiền từ mục tiêu vào thẻ tín dụng là không được phép`,
          };
        }
        if (t.origin !== 'GOAL') {
          return {
            ok: false,
            error: `Giao dịch GOAL_WITHDRAWAL "${t.id}" phải có origin là "GOAL" (nhận được: ${t.origin})`,
          };
        }
        if (typeof t.goalId !== 'string' || !t.goalId.trim()) {
          return { ok: false, error: `Giao dịch GOAL_WITHDRAWAL "${t.id}" thiếu goalId` };
        }
        if (typeof t.originId !== 'string' || !t.originId.trim()) {
          return { ok: false, error: `Giao dịch GOAL_WITHDRAWAL "${t.id}" thiếu originId` };
        }
        if (t.goalId !== t.originId) {
          return {
            ok: false,
            error: `Giao dịch GOAL_WITHDRAWAL "${t.id}" có goalId (${t.goalId}) không khớp với originId (${t.originId})`,
          };
        }
        if (!goalMap.has(t.goalId)) {
          return {
            ok: false,
            error: `Giao dịch GOAL_WITHDRAWAL "${t.id}" tham chiếu mục tiêu không tồn tại (${t.goalId})`,
          };
        }
      }
    }

    // ── System Transaction Invariant: origin === 'GOAL' ──────
    if (t.origin === 'GOAL') {
      if (
        t.type !== 'TRANSFER' ||
        (t.transferKind !== 'GOAL_DEPOSIT' && t.transferKind !== 'GOAL_WITHDRAWAL')
      ) {
        return {
          ok: false,
          error: `Giao dịch origin "GOAL" "${t.id}" phải là TRANSFER với transferKind là GOAL_DEPOSIT hoặc GOAL_WITHDRAWAL`,
        };
      }
    }

    // ── System Transaction Invariant: origin === 'BILL_PAYMENT' ─
    if (t.origin === 'BILL_PAYMENT') {
      if (t.type !== 'EXPENSE') {
        return {
          ok: false,
          error: `Giao dịch thanh toán hóa đơn "${t.id}" phải có loại EXPENSE (nhận được: ${t.type})`,
        };
      }
      if (typeof t.originId !== 'string' || !billMap.has(t.originId)) {
        return {
          ok: false,
          error: `Giao dịch thanh toán hóa đơn "${t.id}" tham chiếu đến hóa đơn không tồn tại (originId: ${t.originId})`,
        };
      }
      const linkedBill = billMap.get(t.originId)!;
      if (linkedBill.status !== 'PAID') {
        return {
          ok: false,
          error: `Giao dịch thanh toán hóa đơn "${t.id}" tham chiếu đến hóa đơn "${linkedBill.name}" có trạng thái UNPAID`,
        };
      }
      if (t.amount !== linkedBill.amount) {
        return {
          ok: false,
          error: `Giao dịch thanh toán hóa đơn "${t.id}" có số tiền (${t.amount}) không khớp với số tiền hóa đơn (${linkedBill.amount})`,
        };
      }
      if (linkedBill.walletId && t.walletId !== linkedBill.walletId) {
        return {
          ok: false,
          error: `Giao dịch thanh toán hóa đơn "${t.id}" có ví (${t.walletId}) không khớp với ví thanh toán hóa đơn (${linkedBill.walletId})`,
        };
      }
      billPaymentTxCount.set(t.originId, (billPaymentTxCount.get(t.originId) || 0) + 1);
    }

    // ── Receipt Data URL Validation ──────────────────────────
    const receiptRes = validatePersistedReceipt(t.receiptImage, t.id);
    if (!receiptRes.ok) {
      return receiptRes;
    }

    // ── Tags & String length limits ──────────────────────────
    const note = typeof t.note === 'string' ? t.note : '';
    if (note.length > MAX_COLLECTION_LIMITS.maxStringLength) {
      return { ok: false, error: `Ghi chú của giao dịch "${t.id}" vượt quá độ dài cho phép` };
    }

    let tags: string[] = [];
    if (Array.isArray(t.tags)) {
      if (t.tags.length > MAX_COLLECTION_LIMITS.tagsPerTransaction) {
        return {
          ok: false,
          error: `Số lượng nhãn của giao dịch "${t.id}" vượt quá giới hạn (${MAX_COLLECTION_LIMITS.tagsPerTransaction})`,
        };
      }
      tags = t.tags
        .filter((tag): tag is string => typeof tag === 'string')
        .map((tag) => tag.trim().slice(0, MAX_COLLECTION_LIMITS.maxTagLength));
    }

    const origin: TransactionOrigin =
      typeof t.origin === 'string' && VALID_TRANSACTION_ORIGINS.includes(t.origin as TransactionOrigin)
        ? (t.origin as TransactionOrigin)
        : 'MANUAL';

    validatedTransactions.push({
      id: t.id,
      type: t.type as TransactionType,
      amount: t.amount,
      walletId: t.walletId,
      walletName: srcWallet.name,
      toWalletId,
      toWalletName,
      transferKind,
      fee,
      categoryId,
      categoryName,
      date: t.date,
      note,
      tags,
      receiptImage: receiptRes.url,
      origin,
      originId: typeof t.originId === 'string' ? t.originId : undefined,
      goalId: typeof t.goalId === 'string' ? t.goalId : undefined,
      goalName:
        typeof t.goalId === 'string' && goalMap.has(t.goalId)
          ? goalMap.get(t.goalId)!.name
          : typeof t.goalName === 'string'
            ? t.goalName
            : undefined,
      createdAt: typeof t.createdAt === 'string' ? t.createdAt : t.date,
    });
  }

  // ── 6. BILL ↔ PAYMENT BIDIRECTIONAL RECONCILIATION ────────
  for (const bill of validatedBills) {
    const paymentCount = billPaymentTxCount.get(bill.id) || 0;
    if (bill.status === 'PAID') {
      if (paymentCount === 0) {
        return {
          ok: false,
          error: `Hóa đơn "${bill.name}" trạng thái PAID nhưng không có giao dịch thanh toán liên kết`,
        };
      }
      if (paymentCount > 1) {
        return {
          ok: false,
          error: `Hóa đơn "${bill.name}" có nhiều hơn một giao dịch thanh toán liên kết (${paymentCount})`,
        };
      }
    } else {
      // bill.status === 'UNPAID'
      if (paymentCount > 0) {
        return {
          ok: false,
          error: `Hóa đơn "${bill.name}" trạng thái UNPAID nhưng có giao dịch thanh toán liên kết`,
        };
      }
    }
  }

  // ── 7. BUDGETS ────────────────────────────────────────────
  if (!Array.isArray(input.budgets)) {
    return { ok: false, error: 'Ngân sách (budgets) phải là một danh sách' };
  }
  if (input.budgets.length > MAX_COLLECTION_LIMITS.budgets) {
    return {
      ok: false,
      error: `Số lượng ngân sách vượt quá giới hạn tối đa (${input.budgets.length} > ${MAX_COLLECTION_LIMITS.budgets})`,
    };
  }

  const budgetIds = new Set<string>();
  const budgetCategoryMonthSet = new Set<string>();
  const validatedBudgets: Budget[] = [];
  for (let i = 0; i < input.budgets.length; i++) {
    const b = input.budgets[i];
    if (!isObject(b)) {
      return { ok: false, error: `Ngân sách tại vị trí ${i} không hợp lệ` };
    }
    if (typeof b.id !== 'string' || !b.id.trim()) {
      return { ok: false, error: `Ngân sách tại vị trí ${i} thiếu ID hợp lệ` };
    }
    if (budgetIds.has(b.id)) {
      return { ok: false, error: `ID ngân sách trùng lặp: ${b.id}` };
    }
    budgetIds.add(b.id);

    if (typeof b.categoryId !== 'string' || !categoryMap.has(b.categoryId)) {
      return {
        ok: false,
        error: `Ngân sách "${b.id}" tham chiếu đến danh mục không tồn tại (${b.categoryId})`,
      };
    }
    if (!expenseCategoryIds.has(b.categoryId)) {
      return {
        ok: false,
        error: `Ngân sách "${b.id}" không thể dùng danh mục thu nhập (${b.categoryId}). Chỉ danh mục EXPENSE được phép.`,
      };
    }
    if (typeof b.categoryName !== 'string' || !b.categoryName.trim()) {
      return { ok: false, error: `Tên danh mục của ngân sách "${b.id}" không được để trống` };
    }
    if (typeof b.amount !== 'number' || !Number.isFinite(b.amount) || b.amount <= 0) {
      return { ok: false, error: `Số tiền của ngân sách "${b.id}" phải là số hữu hạn lớn hơn 0` };
    }
    if (typeof b.month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(b.month)) {
      return { ok: false, error: `Tháng của ngân sách "${b.id}" không hợp lệ (YYYY-MM)` };
    }
    const catMonthKey = `${b.categoryId}__${b.month}`;
    if (budgetCategoryMonthSet.has(catMonthKey)) {
      return {
        ok: false,
        error: `Trùng lặp ngân sách cho danh mục "${b.categoryId}" trong tháng ${b.month}`,
      };
    }
    budgetCategoryMonthSet.add(catMonthKey);
    validatedBudgets.push({
      id: b.id,
      categoryId: b.categoryId,
      categoryName: b.categoryName.trim(),
      amount: b.amount,
      month: b.month,
      alertThreshold80: Boolean(b.alertThreshold80),
      alertThreshold100: Boolean(b.alertThreshold100),
    });
  }

  // ── 8. PLANNER ────────────────────────────────────────────
  if (!isObject(input.planner)) {
    return { ok: false, error: 'Kế hoạch 50/30/20 (planner) phải là một đối tượng' };
  }
  const pl = input.planner;
  if (typeof pl.monthlyIncome !== 'number' || !Number.isFinite(pl.monthlyIncome) || pl.monthlyIncome < 0) {
    return { ok: false, error: 'Thu nhập tháng trong kế hoạch 50/30/20 phải là số hữu hạn không âm' };
  }
  const pList = [pl.needsPercent, pl.wantsPercent, pl.savingsPercent];
  for (const p of pList) {
    if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 100) {
      return { ok: false, error: 'Tỷ lệ phân bổ ngân sách trong kế hoạch phải từ 0% đến 100%' };
    }
  }
  const totalPercent =
    (pl.needsPercent as number) + (pl.wantsPercent as number) + (pl.savingsPercent as number);
  if (Math.abs(totalPercent - 100) > 0.01) {
    return {
      ok: false,
      error: `Tổng tỷ lệ phân bổ trong kế hoạch 50/30/20 phải bằng 100% (hiện tại: ${totalPercent}%)`,
    };
  }
  const validatedPlanner: IncomeBudgetPlanner = {
    monthlyIncome: pl.monthlyIncome,
    needsPercent: pl.needsPercent as number,
    wantsPercent: pl.wantsPercent as number,
    savingsPercent: pl.savingsPercent as number,
    notes: typeof pl.notes === 'string' ? pl.notes.slice(0, MAX_COLLECTION_LIMITS.maxStringLength) : undefined,
  };

  return {
    ok: true,
    data: {
      categories: validatedCategories,
      wallets: validatedWallets,
      transactions: validatedTransactions,
      budgets: validatedBudgets,
      bills: validatedBills,
      goals: validatedGoals,
      planner: validatedPlanner,
    },
  };
}
