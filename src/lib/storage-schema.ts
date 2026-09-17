/**
 * FinTrack Pro v2 — Storage Schema Validation & Migration
 *
 * This module is the single gatekeeper for all persisted data entering the app,
 * whether from localStorage or a backup JSON import.
 *
 * SCHEMA VERSION HISTORY
 * ─────────────────────
 * Version 0 (legacy / unversioned): Original FinTrack v2 snapshots without
 *   a schemaVersion field. Migrated to v1 by treating all data as-is.
 * Version 1 (current): Adds schemaVersion field, splits TRANSFER validation
 *   by transferKind (WALLET_TRANSFER, CREDIT_PAYMENT, GOAL_DEPOSIT, GOAL_WITHDRAWAL).
 *   Budget categoryId must reference an EXPENSE category.
 *
 * UPGRADE RULES
 * ─────────────
 * - Unknown future schemaVersion (> SCHEMA_VERSION): REJECT – never silently
 *   reinterpret data from a newer schema we don't understand.
 * - Missing schemaVersion: legacy migration path (v0 → v1).
 * - schemaVersion === SCHEMA_VERSION: normal validation.
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

/** Current storage schema version. Bump this when adding migration logic. */
export const SCHEMA_VERSION = 1;

/** Maximum import payload size (bytes). Payloads larger than this are rejected. */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024; // 5 MB

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

// ─────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────

/**
 * Validate and normalize an application data snapshot (from localStorage or
 * backup JSON). Handles schema version detection and migration.
 *
 * NEVER call this after already having destructured the input — always pass
 * the raw parsed value so version detection works correctly.
 */
export function validateAndNormalizeAppSnapshot(input: unknown): SnapshotValidationResult {
  if (!isObject(input)) {
    return { ok: false, error: 'Dữ liệu snapshot không phải là một đối tượng JSON hợp lệ' };
  }

  // ── Schema version detection ──────────────────────────────
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

  // rawVersion === 1 (or any supported version ≤ SCHEMA_VERSION)
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
  const categoryIds = new Set<string>();
  const expenseCategoryIds = new Set<string>();
  const validatedCategories: Category[] = [];
  for (let i = 0; i < input.categories.length; i++) {
    const c = input.categories[i];
    if (!isObject(c)) {
      return { ok: false, error: `Danh mục tại vị trí ${i} không hợp lệ` };
    }
    if (typeof c.id !== 'string' || !c.id.trim()) {
      return { ok: false, error: `Danh mục tại vị trí ${i} thiếu ID hợp lệ` };
    }
    if (categoryIds.has(c.id)) {
      return { ok: false, error: `ID danh mục trùng lặp: ${c.id}` };
    }
    categoryIds.add(c.id);
    if (c.type === 'EXPENSE') expenseCategoryIds.add(c.id);

    if (typeof c.name !== 'string' || !c.name.trim()) {
      return { ok: false, error: `Tên danh mục "${c.id}" không được để trống` };
    }
    if (c.type !== 'EXPENSE' && c.type !== 'INCOME') {
      return { ok: false, error: `Loại danh mục "${c.id}" phải là EXPENSE hoặc INCOME` };
    }
    validatedCategories.push({
      id: c.id,
      name: c.name.trim(),
      type: c.type,
      icon: typeof c.icon === 'string' ? c.icon : 'Tag',
      color: typeof c.color === 'string' ? c.color : '#64748b',
    });
  }

  // ── 2. WALLETS ────────────────────────────────────────────
  if (!Array.isArray(input.wallets)) {
    return { ok: false, error: 'Ví tiền (wallets) phải là một danh sách' };
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

  // ── 3. GOALS (needed before transactions for GOAL transfer ref-int) ───
  if (!Array.isArray(input.goals)) {
    return { ok: false, error: 'Mục tiêu (goals) phải là một danh sách' };
  }
  const goalIds = new Set<string>();
  const validatedGoals: SavingsGoal[] = [];
  for (let i = 0; i < input.goals.length; i++) {
    const g = input.goals[i];
    if (!isObject(g)) {
      return { ok: false, error: `Mục tiêu tại vị trí ${i} không hợp lệ` };
    }
    if (typeof g.id !== 'string' || !g.id.trim()) {
      return { ok: false, error: `Mục tiêu tại vị trí ${i} thiếu ID hợp lệ` };
    }
    if (goalIds.has(g.id)) {
      return { ok: false, error: `ID mục tiêu trùng lặp: ${g.id}` };
    }
    goalIds.add(g.id);
    if (typeof g.name !== 'string' || !g.name.trim()) {
      return { ok: false, error: `Tên mục tiêu "${g.id}" không được để trống` };
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
    validatedGoals.push({
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
    });
  }

  // ── 4. TRANSACTIONS ───────────────────────────────────────
  if (!Array.isArray(input.transactions)) {
    return { ok: false, error: 'Giao dịch (transactions) phải là một danh sách' };
  }
  const txIds = new Set<string>();
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

    // ── TRANSFER: validate by transferKind ─────────────────
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
        // ── Wallet-to-wallet / bank→credit ────────────────
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
        // ── Goal deposit: wallet → goal ────────────────────
        // walletId = source asset wallet (not CREDIT)
        if (srcWallet.type === 'CREDIT') {
          return {
            ok: false,
            error: `Giao dịch "${t.id}" nạp tiền vào mục tiêu từ thẻ tín dụng là không được phép`,
          };
        }
        // goalId or originId required, and referenced goal must exist
        const goalRef = (typeof t.goalId === 'string' ? t.goalId : undefined) ||
          (typeof t.originId === 'string' ? t.originId : undefined);
        if (!goalRef || !goalIds.has(goalRef)) {
          return {
            ok: false,
            error: `Giao dịch GOAL_DEPOSIT "${t.id}" thiếu hoặc tham chiếu mục tiêu không tồn tại (goalId/originId: ${goalRef})`,
          };
        }
        // toWalletId is NOT required — no validation needed
      } else if (transferKind === 'GOAL_WITHDRAWAL') {
        // ── Goal withdrawal: goal → wallet ─────────────────
        // walletId = destination asset wallet (not CREDIT)
        if (srcWallet.type === 'CREDIT') {
          return {
            ok: false,
            error: `Giao dịch "${t.id}" rút tiền từ mục tiêu vào thẻ tín dụng là không được phép`,
          };
        }
        const goalRef = (typeof t.goalId === 'string' ? t.goalId : undefined) ||
          (typeof t.originId === 'string' ? t.originId : undefined);
        if (!goalRef || !goalIds.has(goalRef)) {
          return {
            ok: false,
            error: `Giao dịch GOAL_WITHDRAWAL "${t.id}" thiếu hoặc tham chiếu mục tiêu không tồn tại (goalId/originId: ${goalRef})`,
          };
        }
        // toWalletId is NOT required
      }
    } else {
      // EXPENSE / INCOME
      if (t.type === 'INCOME' && srcWallet.type === 'CREDIT') {
        return {
          ok: false,
          error: `Giao dịch thu nhập "${t.id}" trực tiếp vào thẻ tín dụng không được hỗ trợ`,
        };
      }
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
      categoryId: typeof t.categoryId === 'string' ? t.categoryId : undefined,
      categoryName: typeof t.categoryName === 'string' ? t.categoryName : undefined,
      date: t.date,
      note: typeof t.note === 'string' ? t.note : '',
      tags: Array.isArray(t.tags)
        ? t.tags.filter((tag): tag is string => typeof tag === 'string')
        : [],
      receiptImage: typeof t.receiptImage === 'string' ? t.receiptImage : undefined,
      origin,
      originId: typeof t.originId === 'string' ? t.originId : undefined,
      goalId: typeof t.goalId === 'string' ? t.goalId : undefined,
      goalName: typeof t.goalName === 'string' ? t.goalName : undefined,
      createdAt: typeof t.createdAt === 'string' ? t.createdAt : t.date,
    });
  }

  // ── 5. BUDGETS ────────────────────────────────────────────
  if (!Array.isArray(input.budgets)) {
    return { ok: false, error: 'Ngân sách (budgets) phải là một danh sách' };
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

    if (typeof b.categoryId !== 'string' || !categoryIds.has(b.categoryId)) {
      return {
        ok: false,
        error: `Ngân sách "${b.id}" tham chiếu đến danh mục không tồn tại (${b.categoryId})`,
      };
    }
    // ── §5: category must be EXPENSE type ────────────────────
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

  // ── 6. BILLS ──────────────────────────────────────────────
  if (!Array.isArray(input.bills)) {
    return { ok: false, error: 'Hóa đơn (bills) phải là một danh sách' };
  }
  const billIds = new Set<string>();
  const validatedBills: RecurringBill[] = [];
  for (let i = 0; i < input.bills.length; i++) {
    const bill = input.bills[i];
    if (!isObject(bill)) {
      return { ok: false, error: `Hóa đơn tại vị trí ${i} không hợp lệ` };
    }
    if (typeof bill.id !== 'string' || !bill.id.trim()) {
      return { ok: false, error: `Hóa đơn tại vị trí ${i} thiếu ID hợp lệ` };
    }
    if (billIds.has(bill.id)) {
      return { ok: false, error: `ID hóa đơn trùng lặp: ${bill.id}` };
    }
    billIds.add(bill.id);
    if (typeof bill.name !== 'string' || !bill.name.trim()) {
      return { ok: false, error: `Tên hóa đơn "${bill.id}" không được để trống` };
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
    if (bill.status === 'PAID') {
      const linkedTxs = validatedTransactions.filter(
        (t) => t.origin === 'BILL_PAYMENT' && t.originId === bill.id
      );
      if (linkedTxs.length === 0) {
        return {
          ok: false,
          error: `Hóa đơn "${bill.name}" trạng thái PAID nhưng không có giao dịch thanh toán liên kết`,
        };
      }
      if (linkedTxs.length > 1) {
        return {
          ok: false,
          error: `Hóa đơn "${bill.name}" có nhiều hơn một giao dịch thanh toán liên kết (${linkedTxs.length})`,
        };
      }
    }
    validatedBills.push({
      id: bill.id,
      name: bill.name.trim(),
      amount: bill.amount,
      categoryId: typeof bill.categoryId === 'string' ? bill.categoryId : 'cat-bills',
      categoryName: typeof bill.categoryName === 'string' ? bill.categoryName : undefined,
      walletId: typeof bill.walletId === 'string' ? bill.walletId : undefined,
      dueDay: bill.dueDay,
      frequency: bill.frequency as BillFrequency,
      status: bill.status as BillStatus,
      lastPaidDate: typeof bill.lastPaidDate === 'string' ? bill.lastPaidDate : undefined,
      note: typeof bill.note === 'string' ? bill.note : undefined,
      reminderDaysBefore: typeof bill.reminderDaysBefore === 'number' ? bill.reminderDaysBefore : 3,
    });
  }

  // ── 7. PLANNER ────────────────────────────────────────────
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
    notes: typeof pl.notes === 'string' ? pl.notes : undefined,
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
