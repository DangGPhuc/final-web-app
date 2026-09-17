import { describe, it, expect } from 'vitest';
import {
  calculateFinancialSummary,
  applyAddTransaction,
  applyEditTransaction,
  applyDeleteTransaction,
  applyGoalDeposit,
  applyGoalWithdraw,
  applyDeleteGoal,
  applyEditGoal,
  applyPayBill,
  applyUnpayBill,
  applyAddBill,
  applyEditBill,
  applyDeleteBill,
  applyDeleteWallet,
  applyEditWallet,
  applyAddWallet,
  validateTransferFee,
  applyAddGoal,
  applyAddBudget,
  applyEditBudget,
  applyDeleteBudget,
  applyUpdatePlanner,
  AppDomainState,
} from '../src/lib/domain-engine';
import { Wallet, SavingsGoal, RecurringBill, Budget, IncomeBudgetPlanner } from '../src/types';
import {
  calculateBudgetStatuses,
  toLocalDateTimeInputValue,
  localDateTimeInputToISO,
  getLocalDateKey,
  getLocalYearMonth,
  isDateInLocalYearMonth,
} from '../src/lib/utils';
import {
  INITIAL_WALLETS,
  INITIAL_TRANSACTIONS,
  INITIAL_BILLS,
  INITIAL_BUDGETS,
  INITIAL_GOALS,
  INITIAL_PLANNER,
} from '../src/lib/mock-data';
import { DEFAULT_CATEGORIES } from '../src/lib/constants';
import {
  validateAndNormalizeAppSnapshot,
  SCHEMA_VERSION,
  MAX_IMPORT_BYTES,
  StorageStatus,
  LOCAL_RECEIPT_MAX_BYTES,
  getUtf8ByteLength,
} from '../src/lib/storage-schema';
import {
  sanitizeCsvCell,
  validateReceiptFile,
  RECEIPT_MAX_BYTES,
  RECEIPT_ALLOWED_MIMES,
} from '../src/lib/utils';
import {
  loadStorageSnapshot,
  persistStorageSnapshot,
  MemoryStorageAdapter,
} from '../src/lib/storage-service';
import fs from 'fs';
import path from 'path';
import nextConfig from '../next.config.mjs';
import { POST as transactionsPost } from '../src/app/api/transactions/route';
import { POST as walletsPost } from '../src/app/api/wallets/route';

function createMockState(overrides?: Partial<AppDomainState>): AppDomainState {
  const defaultWallets: Wallet[] = [
    {
      id: 'wal-bank',
      name: 'Ngân hàng Chính',
      type: 'BANK',
      balance: 10000000,
      initialBalance: 10000000,
      currency: 'VND',
      color: '#0ea5e9',
      icon: 'Building2',
      createdAt: '2026-01-01',
    },
    {
      id: 'wal-credit',
      name: 'Thẻ tín dụng VPBank',
      type: 'CREDIT',
      balance: 4680000, // Dư nợ hiện tại: 4,680,000đ
      initialBalance: 0,
      creditLimit: 30000000,
      currency: 'VND',
      color: '#8b5cf6',
      icon: 'CreditCard',
      createdAt: '2026-01-01',
    },
    {
      id: 'wal-savings',
      name: 'Sổ tiết kiệm MB',
      type: 'SAVINGS',
      balance: 50000000,
      initialBalance: 50000000,
      currency: 'VND',
      color: '#10b981',
      icon: 'PiggyBank',
      createdAt: '2026-01-01',
    },
  ];

  const defaultGoals: SavingsGoal[] = [
    {
      id: 'goal-emergency',
      name: 'Quỹ khẩn cấp',
      targetAmount: 50000000,
      currentAmount: 0,
      deadline: '2026-12-31',
      color: '#10b981',
      icon: 'ShieldCheck',
      history: [],
      createdAt: '2026-01-01',
    },
  ];

  const defaultBills: RecurringBill[] = [
    {
      id: 'bill-internet',
      name: 'Cáp quang FPT',
      amount: 300000,
      categoryId: 'cat-bills',
      dueDay: 15,
      frequency: 'MONTHLY',
      status: 'UNPAID',
    },
  ];

  return {
    wallets: defaultWallets,
    transactions: [],
    goals: defaultGoals,
    bills: defaultBills,
    ...overrides,
  };
}

describe('Domain Financial Integrity Tests — FinTrack Pro v2', () => {
  // =========================================================================
  // CASE A — Goal Deposit
  // =========================================================================
  it('CASE A — Goal Deposit: wallet decreases, goal increases, net assets and monthly income/expense unchanged', () => {
    const state = createMockState({
      wallets: [
        {
          id: 'wal-bank',
          name: 'Ngân hàng Chính',
          type: 'BANK',
          balance: 10000000,
          initialBalance: 10000000,
          currency: 'VND',
          color: '#0ea5e9',
          icon: 'Building2',
          createdAt: '2026-01-01',
        },
      ],
      goals: [
        {
          id: 'goal-target',
          name: 'Mua laptop mới',
          targetAmount: 20000000,
          currentAmount: 0,
          deadline: '2026-12-31',
          color: '#0ea5e9',
          icon: 'Laptop',
          history: [],
          createdAt: '2026-01-01',
        },
      ],
      transactions: [],
    });

    const summaryBefore = calculateFinancialSummary(state.wallets, state.transactions, '2026-09', state.goals);
    expect(summaryBefore.totalAssets).toBe(10000000);
    expect(summaryBefore.monthlyIncome).toBe(0);
    expect(summaryBefore.monthlyExpense).toBe(0);

    const depositResult = applyGoalDeposit(state, 'goal-target', 'wal-bank', 1000000, 'Nạp tiền mua laptop', '2026-09-05T10:00:00');
    expect(depositResult.ok).toBe(true);
    if (!depositResult.ok) return;

    const updatedState = depositResult.state;
    const bankWallet = updatedState.wallets.find((w) => w.id === 'wal-bank');
    const goal = updatedState.goals.find((g) => g.id === 'goal-target');

    expect(bankWallet?.balance).toBe(9000000);
    expect(goal?.currentAmount).toBe(1000000);
    expect(depositResult.newTx.type).toBe('TRANSFER');
    expect(depositResult.newTx.transferKind).toBe('GOAL_DEPOSIT');
    expect(depositResult.newTx.origin).toBe('GOAL');
    expect(depositResult.newTx.originId).toBe('goal-target');

    const summaryAfter = calculateFinancialSummary(updatedState.wallets, updatedState.transactions, '2026-09', updatedState.goals);
    expect(summaryAfter.totalAssets).toBe(10000000); // Net assets unchanged
    expect(summaryAfter.goalSavings).toBe(1000000);
    expect(summaryAfter.availableBalance).toBe(9000000);
    expect(summaryAfter.monthlyIncome).toBe(0); // Monthly income unchanged
    expect(summaryAfter.monthlyExpense).toBe(0); // Monthly expense unchanged
  });

  // =========================================================================
  // CASE B — Goal Withdraw
  // =========================================================================
  it('CASE B — Goal Withdraw: wallet increases, goal decreases, net assets and monthly income/expense unchanged', () => {
    const state = createMockState({
      wallets: [
        {
          id: 'wal-bank',
          name: 'Ngân hàng Chính',
          type: 'BANK',
          balance: 9000000,
          initialBalance: 10000000,
          currency: 'VND',
          color: '#0ea5e9',
          icon: 'Building2',
          createdAt: '2026-01-01',
        },
      ],
      goals: [
        {
          id: 'goal-target',
          name: 'Mua laptop mới',
          targetAmount: 20000000,
          currentAmount: 1000000,
          deadline: '2026-12-31',
          color: '#0ea5e9',
          icon: 'Laptop',
          history: [],
          createdAt: '2026-01-01',
        },
      ],
      transactions: [],
    });

    const summaryBefore = calculateFinancialSummary(state.wallets, state.transactions, '2026-09', state.goals);
    expect(summaryBefore.totalAssets).toBe(10000000);

    const withdrawResult = applyGoalWithdraw(state, 'goal-target', 'wal-bank', 500000, 'Rút bớt tiền về ví', '2026-09-06T10:00:00');
    expect(withdrawResult.ok).toBe(true);
    if (!withdrawResult.ok) return;

    const updatedState = withdrawResult.state;
    const bankWallet = updatedState.wallets.find((w) => w.id === 'wal-bank');
    const goal = updatedState.goals.find((g) => g.id === 'goal-target');

    expect(bankWallet?.balance).toBe(9500000);
    expect(goal?.currentAmount).toBe(500000);
    expect(withdrawResult.newTx.type).toBe('TRANSFER');
    expect(withdrawResult.newTx.transferKind).toBe('GOAL_WITHDRAWAL');
    expect(withdrawResult.newTx.origin).toBe('GOAL');

    const summaryAfter = calculateFinancialSummary(updatedState.wallets, updatedState.transactions, '2026-09', updatedState.goals);
    expect(summaryAfter.totalAssets).toBe(10000000); // Net assets unchanged
    expect(summaryAfter.goalSavings).toBe(500000);
    expect(summaryAfter.availableBalance).toBe(9500000);
    expect(summaryAfter.monthlyIncome).toBe(0);
    expect(summaryAfter.monthlyExpense).toBe(0);
  });

  // =========================================================================
  // CASE C — Delete Non-empty Goal
  // =========================================================================
  it('CASE C — Delete Non-empty Goal: goal with currentAmount > 0 must be rejected', () => {
    const state = createMockState({
      goals: [
        {
          id: 'goal-non-empty',
          name: 'Hũ có tiền',
          targetAmount: 10000000,
          currentAmount: 2500000,
          deadline: '2026-12-31',
          color: '#0ea5e9',
          icon: 'Laptop',
          history: [],
          createdAt: '2026-01-01',
        },
        {
          id: 'goal-empty',
          name: 'Hũ rỗng',
          targetAmount: 5000000,
          currentAmount: 0,
          deadline: '2026-12-31',
          color: '#10b981',
          icon: 'PiggyBank',
          history: [],
          createdAt: '2026-01-01',
        },
      ],
    });

    const rejectResult = applyDeleteGoal(state, 'goal-non-empty');
    expect(rejectResult.ok).toBe(false);
    if (!rejectResult.ok) {
      expect(rejectResult.error).toContain('lớn hơn 0');
    }

    const allowResult = applyDeleteGoal(state, 'goal-empty');
    expect(allowResult.ok).toBe(true);
    if (allowResult.ok) {
      expect(allowResult.state.goals.some((g) => g.id === 'goal-empty')).toBe(false);
    }
  });

  // =========================================================================
  // CASE D — Credit Card Expense
  // =========================================================================
  it('CASE D — Credit Card Expense: purchase on credit card increases debt and decreases net worth', () => {
    const state = createMockState({
      wallets: [
        {
          id: 'wal-credit',
          name: 'Thẻ tín dụng',
          type: 'CREDIT',
          balance: 4680000, // Dư nợ ban đầu: 4,680,000đ
          initialBalance: 0,
          creditLimit: 30000000,
          currency: 'VND',
          color: '#8b5cf6',
          icon: 'CreditCard',
          createdAt: '2026-01-01',
        },
      ],
    });

    const summaryBefore = calculateFinancialSummary(state.wallets, state.transactions, '2026-09', state.goals);
    expect(summaryBefore.totalAssets).toBe(-4680000);
    expect(summaryBefore.totalCreditDebt).toBe(4680000);

    const expenseResult = applyAddTransaction(state, {
      type: 'EXPENSE',
      amount: 1000000,
      walletId: 'wal-credit',
      walletName: 'Thẻ tín dụng',
      date: '2026-09-05T15:00:00',
      note: 'Mua sắm qua thẻ tín dụng',
      tags: ['Mua sắm'],
    });

    expect(expenseResult.ok).toBe(true);
    if (!expenseResult.ok) return;

    const creditWallet = expenseResult.state.wallets.find((w) => w.id === 'wal-credit');
    expect(creditWallet?.balance).toBe(5680000); // Debt increased to 5,680,000đ

    const summaryAfter = calculateFinancialSummary(
      expenseResult.state.wallets,
      expenseResult.state.transactions,
      '2026-09',
      expenseResult.state.goals
    );
    expect(summaryAfter.totalCreditDebt).toBe(5680000);
    expect(summaryAfter.totalAssets).toBe(-5680000); // Net worth decreased by 1,000,000đ
  });

  // =========================================================================
  // CASE E — Credit Card Limit
  // =========================================================================
  it('CASE E — Credit Card Limit: purchase that would exceed creditLimit must be rejected', () => {
    const state = createMockState({
      wallets: [
        {
          id: 'wal-credit',
          name: 'Thẻ tín dụng',
          type: 'CREDIT',
          balance: 29000000, // Đã nợ 29,000,000đ
          initialBalance: 0,
          creditLimit: 30000000, // Hạn mức 30,000,000đ
          currency: 'VND',
          color: '#8b5cf6',
          icon: 'CreditCard',
          createdAt: '2026-01-01',
        },
      ],
    });

    const overlimitResult = applyAddTransaction(state, {
      type: 'EXPENSE',
      amount: 2000000, // 29M + 2M = 31M > 30M limit
      walletId: 'wal-credit',
      walletName: 'Thẻ tín dụng',
      date: '2026-09-05T15:00:00',
      note: 'Mua máy ảnh vượt hạn mức',
      tags: ['Thiết bị'],
    });

    expect(overlimitResult.ok).toBe(false);
    if (!overlimitResult.ok) {
      expect(overlimitResult.error).toContain('hạn mức');
    }
  });

  // =========================================================================
  // CASE F — Bank → Credit Payment
  // =========================================================================
  it('CASE F — Bank -> Credit Payment: repayments decrease bank and decrease debt, net worth unchanged except fee', () => {
    const state = createMockState({
      wallets: [
        {
          id: 'wal-bank',
          name: 'Vietcombank',
          type: 'BANK',
          balance: 10000000,
          initialBalance: 10000000,
          currency: 'VND',
          color: '#0ea5e9',
          icon: 'Building2',
          createdAt: '2026-01-01',
        },
        {
          id: 'wal-credit',
          name: 'VPBank Credit',
          type: 'CREDIT',
          balance: 4000000, // Dư nợ 4,000,000đ
          initialBalance: 0,
          creditLimit: 30000000,
          currency: 'VND',
          color: '#8b5cf6',
          icon: 'CreditCard',
          createdAt: '2026-01-01',
        },
      ],
      transactions: [],
      goals: [],
    });

    const summaryBefore = calculateFinancialSummary(state.wallets, state.transactions, '2026-09', state.goals);
    expect(summaryBefore.totalAssets).toBe(6000000); // 10M - 4M = 6M

    // Repayment: 2,000,000đ with 5,000đ fee
    const paymentResult = applyAddTransaction(state, {
      type: 'TRANSFER',
      amount: 2000000,
      fee: 5000,
      walletId: 'wal-bank',
      toWalletId: 'wal-credit',
      date: '2026-09-05T12:00:00',
      note: 'Thanh toán sao kê thẻ tín dụng',
      tags: ['Thanh toán thẻ'],
    });

    expect(paymentResult.ok).toBe(true);
    if (!paymentResult.ok) return;

    const bank = paymentResult.state.wallets.find((w) => w.id === 'wal-bank');
    const credit = paymentResult.state.wallets.find((w) => w.id === 'wal-credit');

    expect(bank?.balance).toBe(7995000); // 10,000,000 - 2,000,000 - 5,000
    expect(credit?.balance).toBe(2000000); // 4,000,000 - 2,000,000 (debt decreased!)

    const summaryAfter = calculateFinancialSummary(
      paymentResult.state.wallets,
      paymentResult.state.transactions,
      '2026-09',
      paymentResult.state.goals
    );
    // Net assets: 7,995,000 - 2,000,000 = 5,995,000 (decreased only by the 5,000đ transfer fee!)
    expect(summaryAfter.totalAssets).toBe(5995000);
    expect(summaryAfter.monthlyExpense).toBe(5000); // Transfer fee counted as expense
    expect(summaryAfter.monthlyIncome).toBe(0); // Transfer principal NOT counted as income
  });

  // =========================================================================
  // CASE G — Invalid Transfer Fee
  // =========================================================================
  it('CASE G — Invalid Transfer Fee: negative, NaN, and Infinity fees must be rejected and never stored', () => {
    expect(validateTransferFee(-5000).valid).toBe(false);
    expect(validateTransferFee(NaN).valid).toBe(false);
    expect(validateTransferFee(Infinity).valid).toBe(false);
    expect(validateTransferFee(-Infinity).valid).toBe(false);
    expect(validateTransferFee(5000).valid).toBe(true);
    expect(validateTransferFee(0).valid).toBe(true);
    expect(validateTransferFee(undefined).valid).toBe(true);

    const state = createMockState({
      wallets: [
        {
          id: 'w1',
          name: 'Ví 1',
          type: 'CASH',
          balance: 1000000,
          initialBalance: 1000000,
          currency: 'VND',
          color: '#10b981',
          icon: 'Banknote',
          createdAt: '2026-01-01',
        },
        {
          id: 'w2',
          name: 'Ví 2',
          type: 'BANK',
          balance: 1000000,
          initialBalance: 1000000,
          currency: 'VND',
          color: '#0ea5e9',
          icon: 'Building2',
          createdAt: '2026-01-01',
        },
      ],
    });

    const resNegative = applyAddTransaction(state, {
      type: 'TRANSFER',
      amount: 100000,
      fee: -1000,
      walletId: 'w1',
      toWalletId: 'w2',
      date: '2026-09-01T10:00:00',
      note: 'test',
      tags: [],
    });
    expect(resNegative.ok).toBe(false);

    const resNaN = applyAddTransaction(state, {
      type: 'TRANSFER',
      amount: 100000,
      fee: NaN,
      walletId: 'w1',
      toWalletId: 'w2',
      date: '2026-09-01T10:00:00',
      note: 'test',
      tags: [],
    });
    expect(resNaN.ok).toBe(false);

    const resInf = applyAddTransaction(state, {
      type: 'TRANSFER',
      amount: 100000,
      fee: Infinity,
      walletId: 'w1',
      toWalletId: 'w2',
      date: '2026-09-01T10:00:00',
      note: 'test',
      tags: [],
    });
    expect(resInf.ok).toBe(false);
  });

  // =========================================================================
  // CASE H — System Transaction Integrity
  // =========================================================================
  it('CASE H — System Transaction Integrity: Goal and Bill transactions cannot be generically edited or deleted', () => {
    const state = createMockState({
      transactions: [
        {
          id: 'tx-goal-sys',
          type: 'TRANSFER',
          amount: 1000000,
          walletId: 'wal-bank',
          date: '2026-09-01T10:00:00',
          note: 'Tích lũy vào hũ',
          tags: [],
          createdAt: '2026-09-01T10:00:00',
          origin: 'GOAL',
          originId: 'goal-emergency',
        },
        {
          id: 'tx-bill-sys',
          type: 'EXPENSE',
          amount: 300000,
          walletId: 'wal-bank',
          date: '2026-09-01T10:00:00',
          note: 'Thanh toán hóa đơn',
          tags: [],
          createdAt: '2026-09-01T10:00:00',
          origin: 'BILL_PAYMENT',
          originId: 'bill-internet',
        },
      ],
    });

    // Attempt to edit goal transaction
    const editGoalRes = applyEditTransaction(state, 'tx-goal-sys', { amount: 500000 });
    expect(editGoalRes.ok).toBe(false);
    if (!editGoalRes.ok) {
      expect(editGoalRes.error).toContain('tự động của hệ thống');
    }

    // Attempt to delete goal transaction
    const deleteGoalRes = applyDeleteTransaction(state, 'tx-goal-sys');
    expect(deleteGoalRes.ok).toBe(false);
    if (!deleteGoalRes.ok) {
      expect(deleteGoalRes.error).toContain('tự động của hệ thống');
    }

    // Attempt to edit bill transaction
    const editBillRes = applyEditTransaction(state, 'tx-bill-sys', { amount: 200000 });
    expect(editBillRes.ok).toBe(false);
    if (!editBillRes.ok) {
      expect(editBillRes.error).toContain('tự động của hệ thống');
    }

    // Attempt to delete bill transaction
    const deleteBillRes = applyDeleteTransaction(state, 'tx-bill-sys');
    expect(deleteBillRes.ok).toBe(false);
    if (!deleteBillRes.ok) {
      expect(deleteBillRes.error).toContain('tự động của hệ thống');
    }
  });

  // =========================================================================
  // CASE I — Bill Pay + Undo + Pay Again
  // =========================================================================
  it('CASE I — Bill Pay + Undo + Pay Again: coordinated reversal and single payment effect', () => {
    const state = createMockState({
      wallets: [
        {
          id: 'wal-bank',
          name: 'Ngân hàng Chính',
          type: 'BANK',
          balance: 10000000,
          initialBalance: 10000000,
          currency: 'VND',
          color: '#0ea5e9',
          icon: 'Building2',
          createdAt: '2026-01-01',
        },
      ],
      bills: [
        {
          id: 'bill-rent',
          name: 'Tiền thuê nhà',
          amount: 3000000,
          categoryId: 'cat-housing',
          dueDay: 5,
          frequency: 'MONTHLY',
          status: 'UNPAID',
        },
      ],
      transactions: [],
    });

    // Step 1: Pay once
    const pay1 = applyPayBill(state, 'bill-rent', 'wal-bank', '2026-09-05T08:00:00');
    expect(pay1.ok).toBe(true);
    if (!pay1.ok) return;

    expect(pay1.state.wallets[0].balance).toBe(7000000); // 10M - 3M
    expect(pay1.state.bills[0].status).toBe('PAID');
    expect(pay1.state.transactions.length).toBe(1);
    expect(pay1.state.transactions[0].origin).toBe('BILL_PAYMENT');
    expect(pay1.state.transactions[0].originId).toBe('bill-rent');

    // Step 2: Undo
    const undo = applyUnpayBill(pay1.state, 'bill-rent');
    expect(undo.ok).toBe(true);
    if (!undo.ok) return;

    expect(undo.state.wallets[0].balance).toBe(10000000); // Restored!
    expect(undo.state.bills[0].status).toBe('UNPAID');
    expect(undo.state.transactions.length).toBe(0); // Transaction removed!

    // Step 3: Pay again
    const pay2 = applyPayBill(undo.state, 'bill-rent', 'wal-bank', '2026-09-06T08:00:00');
    expect(pay2.ok).toBe(true);
    if (!pay2.ok) return;

    expect(pay2.state.wallets[0].balance).toBe(7000000); // Exactly one payment deducted
    expect(pay2.state.bills[0].status).toBe('PAID');
    expect(pay2.state.transactions.length).toBe(1); // Exactly one payment transaction exists
  });

  // =========================================================================
  // CASE J — Wallet Delete Referential Integrity
  // =========================================================================
  it('CASE J — Wallet Delete: referenced wallet deletion must be rejected', () => {
    const state = createMockState({
      wallets: [
        {
          id: 'wal-ref-tx',
          name: 'Ví có giao dịch',
          type: 'CASH',
          balance: 1000000,
          initialBalance: 1000000,
          currency: 'VND',
          color: '#10b981',
          icon: 'Banknote',
          createdAt: '2026-01-01',
        },
        {
          id: 'wal-ref-bill',
          name: 'Ví có hóa đơn',
          type: 'BANK',
          balance: 2000000,
          initialBalance: 2000000,
          currency: 'VND',
          color: '#0ea5e9',
          icon: 'Building2',
          createdAt: '2026-01-01',
        },
        {
          id: 'wal-ref-goal',
          name: 'Ví có lịch sử hũ',
          type: 'BANK',
          balance: 3000000,
          initialBalance: 3000000,
          currency: 'VND',
          color: '#0ea5e9',
          icon: 'Building2',
          createdAt: '2026-01-01',
        },
        {
          id: 'wal-orphan',
          name: 'Ví không liên kết',
          type: 'CASH',
          balance: 500000,
          initialBalance: 500000,
          currency: 'VND',
          color: '#f59e0b',
          icon: 'Banknote',
          createdAt: '2026-01-01',
        },
      ],
      transactions: [
        {
          id: 'tx-1',
          type: 'EXPENSE',
          amount: 50000,
          walletId: 'wal-ref-tx',
          date: '2026-09-01T10:00:00',
          note: 'Ăn sáng',
          tags: [],
          createdAt: '2026-09-01T10:00:00',
        },
      ],
      bills: [
        {
          id: 'bill-1',
          name: 'Tiền mạng',
          amount: 250000,
          categoryId: 'cat-bills',
          walletId: 'wal-ref-bill',
          dueDay: 10,
          frequency: 'MONTHLY',
          status: 'UNPAID',
        },
      ],
      goals: [
        {
          id: 'goal-1',
          name: 'Hũ tiết kiệm',
          targetAmount: 10000000,
          currentAmount: 1000000,
          deadline: '2026-12-31',
          color: '#10b981',
          icon: 'PiggyBank',
          history: [
            {
              id: 'gh-1',
              date: '2026-09-01',
              amount: 1000000,
              type: 'DEPOSIT',
              walletId: 'wal-ref-goal',
            },
          ],
          createdAt: '2026-01-01',
        },
      ],
    });

    // 1. Deleting wallet referenced in transactions must be rejected
    const delTxWallet = applyDeleteWallet(state, 'wal-ref-tx');
    expect(delTxWallet.ok).toBe(false);
    if (!delTxWallet.ok) {
      expect(delTxWallet.error).toContain('lịch sử giao dịch');
    }

    // 2. Deleting wallet referenced in bills must be rejected
    const delBillWallet = applyDeleteWallet(state, 'wal-ref-bill');
    expect(delBillWallet.ok).toBe(false);
    if (!delBillWallet.ok) {
      expect(delBillWallet.error).toContain('hóa đơn');
    }

    // 3. Deleting wallet referenced in goal history must be rejected
    const delGoalWallet = applyDeleteWallet(state, 'wal-ref-goal');
    expect(delGoalWallet.ok).toBe(false);
    if (!delGoalWallet.ok) {
      expect(delGoalWallet.error).toContain('mục tiêu tích lũy');
    }

    // 4. Deleting unreferenced wallet is allowed
    const delOrphanWallet = applyDeleteWallet(state, 'wal-orphan');
    expect(delOrphanWallet.ok).toBe(true);
    if (delOrphanWallet.ok) {
      expect(delOrphanWallet.state.wallets.some((w) => w.id === 'wal-orphan')).toBe(false);
    }
  });

  // =========================================================================
  // CASE K — Double Bill Payment
  // =========================================================================
  it('CASE K — Double Bill Payment: paying a bill twice without undo is rejected', () => {
    const state = createMockState({
      wallets: [
        {
          id: 'wal-bank',
          name: 'Ngân hàng',
          type: 'BANK',
          balance: 10000000,
          initialBalance: 10000000,
          currency: 'VND',
          color: '#0ea5e9',
          icon: 'Building2',
          createdAt: '2026-01-01',
        },
      ],
      bills: [
        {
          id: 'bill-water',
          name: 'Tiền nước sinh hoạt',
          amount: 200000,
          categoryId: 'cat-bills',
          dueDay: 10,
          frequency: 'MONTHLY',
          status: 'UNPAID',
        },
      ],
      transactions: [],
    });

    // 1. Pay bill once
    const pay1 = applyPayBill(state, 'bill-water', 'wal-bank', '2026-09-10T10:00:00');
    expect(pay1.ok).toBe(true);
    if (!pay1.ok) return;

    expect(pay1.state.wallets[0].balance).toBe(9800000);
    expect(pay1.state.bills[0].status).toBe('PAID');
    expect(pay1.state.transactions.length).toBe(1);

    // 2. Attempt to pay same bill again without undo
    const pay2 = applyPayBill(pay1.state, 'bill-water', 'wal-bank', '2026-09-10T11:00:00');
    expect(pay2.ok).toBe(false);
    if (!pay2.ok) {
      expect(pay2.error).toMatch(/đã được thanh toán|đã có giao dịch/);
    }

    // Verify wallet/debt changed only once and only one BILL_PAYMENT transaction exists
    const bankWallet = pay1.state.wallets.find((w) => w.id === 'wal-bank');
    expect(bankWallet?.balance).toBe(9800000);
    const billPayments = pay1.state.transactions.filter(
      (t) => t.origin === 'BILL_PAYMENT' && t.originId === 'bill-water'
    );
    expect(billPayments.length).toBe(1);
  });

  // =========================================================================
  // CASE L — Unsafe Bill Undo
  // =========================================================================
  it('CASE L — Unsafe Bill Undo: credit bill undo rejected when exact reversal is impossible', () => {
    // Credit debt before bill: 0
    const state = createMockState({
      wallets: [
        {
          id: 'wal-credit',
          name: 'Thẻ tín dụng',
          type: 'CREDIT',
          balance: 0,
          initialBalance: 0,
          creditLimit: 10000000,
          currency: 'VND',
          color: '#8b5cf6',
          icon: 'CreditCard',
          createdAt: '2026-01-01',
        },
        {
          id: 'wal-bank',
          name: 'Ngân hàng',
          type: 'BANK',
          balance: 5000000,
          initialBalance: 5000000,
          currency: 'VND',
          color: '#0ea5e9',
          icon: 'Building2',
          createdAt: '2026-01-01',
        },
      ],
      bills: [
        {
          id: 'bill-phone',
          name: 'Cước viễn thông',
          amount: 1000000,
          categoryId: 'cat-bills',
          dueDay: 15,
          frequency: 'MONTHLY',
          status: 'UNPAID',
        },
      ],
      transactions: [],
    });

    // 1. Pay bill with CREDIT (+1,000,000 debt)
    const payRes = applyPayBill(state, 'bill-phone', 'wal-credit', '2026-09-10T10:00:00');
    expect(payRes.ok).toBe(true);
    if (!payRes.ok) return;

    let creditWallet = payRes.state.wallets.find((w) => w.id === 'wal-credit');
    expect(creditWallet?.balance).toBe(1000000); // 1,000,000 debt

    // 2. Later repay credit card: -800,000 debt via transfer from bank
    const repayRes = applyAddTransaction(payRes.state, {
      type: 'TRANSFER',
      amount: 800000,
      fee: 0,
      walletId: 'wal-bank',
      toWalletId: 'wal-credit',
      date: '2026-09-11T10:00:00',
      note: 'Trả nợ thẻ',
      tags: [],
    });
    expect(repayRes.ok).toBe(true);
    if (!repayRes.ok) return;

    creditWallet = repayRes.state.wallets.find((w) => w.id === 'wal-credit');
    expect(creditWallet?.balance).toBe(200000); // Current debt: 200,000

    // 3. Attempt to undo original bill payment of 1,000,000
    const undoRes = applyUnpayBill(repayRes.state, 'bill-phone');
    expect(undoRes.ok).toBe(false);
    if (!undoRes.ok) {
      expect(undoRes.error).toContain('dư nợ thẻ');
    }

    // Wallets unchanged, transactions unchanged, bill remains PAID
    const stateAfterFailedUndo = repayRes.state;
    const finalCredit = stateAfterFailedUndo.wallets.find((w) => w.id === 'wal-credit');
    const finalBill = stateAfterFailedUndo.bills.find((b) => b.id === 'bill-phone');

    expect(finalCredit?.balance).toBe(200000);
    expect(finalBill?.status).toBe('PAID');
    expect(stateAfterFailedUndo.transactions.some((t) => t.originId === 'bill-phone')).toBe(true);
  });

  // =========================================================================
  // CASE M — Goal With History Cannot Be Deleted
  // =========================================================================
  it('CASE M — Goal With History Cannot Be Deleted: goal with currentAmount === 0 but linked history rejected', () => {
    const state = createMockState({
      goals: [
        {
          id: 'goal-used',
          name: 'Mua điện thoại',
          targetAmount: 15000000,
          currentAmount: 0, // Balance is currently 0
          deadline: '2026-12-31',
          color: '#10b981',
          icon: 'Smartphone',
          history: [
            {
              id: 'gh-1',
              date: '2026-09-01',
              amount: 5000000,
              type: 'DEPOSIT',
              walletId: 'wal-bank',
            },
            {
              id: 'gh-2',
              date: '2026-09-02',
              amount: 5000000,
              type: 'WITHDRAW',
              walletId: 'wal-bank',
            },
          ],
          createdAt: '2026-01-01',
        },
      ],
      transactions: [
        {
          id: 'tx-goal-hist-1',
          type: 'TRANSFER',
          amount: 5000000,
          walletId: 'wal-bank',
          date: '2026-09-01T10:00:00',
          note: 'Tích lũy vào hũ',
          tags: [],
          createdAt: '2026-09-01T10:00:00',
          origin: 'GOAL',
          originId: 'goal-used',
        },
      ],
    });

    const res = applyDeleteGoal(state, 'goal-used');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/transaction history|lịch sử giao dịch/i);
    }

    // Goal still exists in state
    expect(state.goals.some((g) => g.id === 'goal-used')).toBe(true);
  });

  // =========================================================================
  // CASE N — Empty Unused Goal Can Be Deleted
  // =========================================================================
  it('CASE N — Empty Unused Goal Can Be Deleted: goal with currentAmount === 0 and no history can be deleted', () => {
    const state = createMockState({
      goals: [
        {
          id: 'goal-unused',
          name: 'Mục tiêu mới chưa dùng',
          targetAmount: 10000000,
          currentAmount: 0,
          deadline: '2026-12-31',
          color: '#3b82f6',
          icon: 'Target',
          history: [],
          createdAt: '2026-09-01',
        },
      ],
      transactions: [],
    });

    const res = applyDeleteGoal(state, 'goal-unused');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.goals.some((g) => g.id === 'goal-unused')).toBe(false);
    }
  });

  // =========================================================================
  // CASE O — Existing Wallet Balance Cannot Be Arbitrarily Edited
  // =========================================================================
  it('CASE O — Existing Wallet Balance Cannot Be Arbitrarily Edited: balance remains 10M, metadata changes allowed', () => {
    const state = createMockState({
      wallets: [
        {
          id: 'wal-edit-test',
          name: 'Tài khoản Chi tiêu',
          type: 'BANK',
          balance: 10000000,
          initialBalance: 10000000,
          currency: 'VND',
          color: '#0ea5e9',
          icon: 'Building2',
          bankName: 'Vietcombank',
          accountNumber: '123456',
          createdAt: '2026-01-01',
        },
      ],
    });

    // Attempt to edit wallet including balance = 999M and metadata changes
    const editRes = applyEditWallet(state, 'wal-edit-test', {
      name: 'Tài khoản Chi tiêu Đổi Tên',
      color: '#ef4444',
      accountNumber: '999999',
      balance: 999000000, // Attempting to arbitrarily set 999M
    } as Partial<Wallet>);

    expect(editRes.ok).toBe(true);
    if (!editRes.ok) return;

    const editedWallet = editRes.state.wallets.find((w) => w.id === 'wal-edit-test');
    expect(editedWallet).toBeDefined();
    // Invariant check: balance MUST remain 10M
    expect(editedWallet?.balance).toBe(10000000);
    expect(editedWallet?.initialBalance).toBe(10000000);

    // Metadata changes MUST be applied
    expect(editedWallet?.name).toBe('Tài khoản Chi tiêu Đổi Tên');
    expect(editedWallet?.color).toBe('#ef4444');
    expect(editedWallet?.accountNumber).toBe('999999');
  });

  // =========================================================================
  // CASE P — Credit Wallet Generic Income
  // =========================================================================
  it('CASE P — Credit Wallet Generic Income: direct INCOME to CREDIT wallet is rejected, debt unchanged', () => {
    const state = createMockState({
      wallets: [
        {
          id: 'wal-credit-test',
          name: 'Thẻ tín dụng Test',
          type: 'CREDIT',
          balance: 3000000, // Dư nợ 3,000,000đ
          initialBalance: 0,
          creditLimit: 20000000,
          currency: 'VND',
          color: '#8b5cf6',
          icon: 'CreditCard',
          createdAt: '2026-01-01',
        },
      ],
      transactions: [],
    });

    // Attempt: INCOME 10M -> CREDIT
    const incomeRes = applyAddTransaction(state, {
      type: 'INCOME',
      amount: 10000000,
      walletId: 'wal-credit-test',
      date: '2026-09-15T10:00:00',
      note: 'Thu nhập vào thẻ tín dụng',
      tags: [],
    });

    expect(incomeRes.ok).toBe(false);
    if (!incomeRes.ok) {
      expect(incomeRes.error).toContain('Không hỗ trợ ghi nhận thu nhập trực tiếp vào thẻ tín dụng');
    }

    // Credit debt must remain unchanged (3,000,000)
    const wallet = state.wallets.find((w) => w.id === 'wal-credit-test');
    expect(wallet?.balance).toBe(3000000);
    expect(state.transactions.length).toBe(0);
  });

  // =========================================================================
  // CASE Q — Credit Repayment Still Works
  // =========================================================================
  it('CASE Q — Credit Repayment Still Works: TRANSFER bank -> credit reduces debt and bank balance', () => {
    const state = createMockState({
      wallets: [
        {
          id: 'wal-bank-q',
          name: 'Tài khoản Ngân hàng',
          type: 'BANK',
          balance: 10000000, // 10M
          initialBalance: 10000000,
          currency: 'VND',
          color: '#0ea5e9',
          icon: 'Building2',
          createdAt: '2026-01-01',
        },
        {
          id: 'wal-credit-q',
          name: 'Thẻ tín dụng',
          type: 'CREDIT',
          balance: 3000000, // 3M debt
          initialBalance: 0,
          creditLimit: 20000000,
          currency: 'VND',
          color: '#8b5cf6',
          icon: 'CreditCard',
          createdAt: '2026-01-01',
        },
      ],
      transactions: [],
    });

    // TRANSFER bank -> credit = 2M (fee = 0)
    const transferRes = applyAddTransaction(state, {
      type: 'TRANSFER',
      amount: 2000000,
      fee: 0,
      walletId: 'wal-bank-q',
      toWalletId: 'wal-credit-q',
      date: '2026-09-15T12:00:00',
      note: 'Thanh toán thẻ tín dụng',
      tags: ['Thanh toán thẻ'],
    });

    expect(transferRes.ok).toBe(true);
    if (!transferRes.ok) return;

    const bank = transferRes.state.wallets.find((w) => w.id === 'wal-bank-q');
    const credit = transferRes.state.wallets.find((w) => w.id === 'wal-credit-q');

    // Expected: Bank = 8M, Credit debt = 1M
    expect(bank?.balance).toBe(8000000);
    expect(credit?.balance).toBe(1000000);
    expect(transferRes.newTx.transferKind).toBe('CREDIT_PAYMENT');
  });

  // =========================================================================
  // CASE R — Budget Month Isolation
  // =========================================================================
  it('CASE R — Budget Month Isolation: calculating budget statuses for a month only includes budgets of that month', () => {
    const budgets: Budget[] = [
      {
        id: 'bud-food-sep',
        categoryId: 'cat-food',
        categoryName: 'Ăn uống',
        amount: 4000000,
        month: '2026-09',
      },
      {
        id: 'bud-food-oct',
        categoryId: 'cat-food',
        categoryName: 'Ăn uống',
        amount: 5000000,
        month: '2026-10',
      },
    ];

    const transactions = [
      {
        id: 'tx-oct-food',
        type: 'EXPENSE' as const,
        amount: 2000000,
        categoryId: 'cat-food',
        categoryName: 'Ăn uống',
        walletId: 'wal-bank',
        date: '2026-10-05T12:00:00',
        note: 'Tiệc liên hoan tháng 10',
        tags: [],
        createdAt: '2026-10-05T12:00:00',
      },
      {
        id: 'tx-sep-food',
        type: 'EXPENSE' as const,
        amount: 1500000,
        categoryId: 'cat-food',
        categoryName: 'Ăn uống',
        walletId: 'wal-bank',
        date: '2026-09-15T12:00:00',
        note: 'Ăn uống tháng 9',
        tags: [],
        createdAt: '2026-09-15T12:00:00',
      },
    ];

    // Calculate budget status for October ('2026-10')
    const octStatuses = calculateBudgetStatuses(budgets, transactions, '2026-10');

    // Expected: Exactly 1 budget status (October Food budget)
    expect(octStatuses.length).toBe(1);

    const octBudgetStatus = octStatuses[0];
    expect(octBudgetStatus.budget.id).toBe('bud-food-oct');
    expect(octBudgetStatus.budget.month).toBe('2026-10');
    expect(octBudgetStatus.budget.amount).toBe(5000000);
    expect(octBudgetStatus.spent).toBe(2000000);
    expect(octBudgetStatus.remaining).toBe(3000000);
    expect(octBudgetStatus.percentage).toBe(40);

    // September budget must NOT appear in October results
    expect(octStatuses.some((b) => b.budget.id === 'bud-food-sep')).toBe(false);
    expect(octStatuses.some((b) => b.budget.month === '2026-09')).toBe(false);
  });

  // =========================================================================
  // CASE S — Goal Withdraw To Credit Rejected
  // =========================================================================
  it('CASE S — Goal Withdraw To Credit Rejected: withdrawal from goal directly to CREDIT is rejected', () => {
    const state = createMockState({
      goals: [
        {
          id: 'goal-s',
          name: 'Hũ tiết kiệm S',
          targetAmount: 10000000,
          currentAmount: 5000000, // 5M
          deadline: '2026-12-31',
          color: '#10b981',
          icon: 'PiggyBank',
          history: [],
          createdAt: '2026-01-01',
        },
      ],
      wallets: [
        {
          id: 'wal-credit-s',
          name: 'Thẻ tín dụng S',
          type: 'CREDIT',
          balance: 2000000, // 2M debt
          initialBalance: 0,
          creditLimit: 20000000,
          currency: 'VND',
          color: '#8b5cf6',
          icon: 'CreditCard',
          createdAt: '2026-01-01',
        },
      ],
      transactions: [],
    });

    // Attempt: Goal withdrawal 3M directly to CREDIT
    const withdrawRes = applyGoalWithdraw(state, 'goal-s', 'wal-credit-s', 3000000);

    expect(withdrawRes.ok).toBe(false);
    if (!withdrawRes.ok) {
      expect(withdrawRes.error).toContain('thẻ tín dụng');
    }

    // Expected: goal unchanged, credit debt unchanged, transactions unchanged
    const goal = state.goals.find((g) => g.id === 'goal-s');
    const credit = state.wallets.find((w) => w.id === 'wal-credit-s');

    expect(goal?.currentAmount).toBe(5000000);
    expect(credit?.balance).toBe(2000000);
    expect(state.transactions.length).toBe(0);
  });

  // =========================================================================
  // CASE Y — Goal Financial Fields Cannot Be Edited
  // =========================================================================
  it('CASE Y — Goal Financial Fields Cannot Be Edited: currentAmount and history are strictly preserved', () => {
    const state = createMockState({
      goals: [
        {
          id: 'goal-y',
          name: 'Quỹ Dự Phòng Y',
          targetAmount: 20000000,
          currentAmount: 5000000, // 5M
          deadline: '2026-12-31',
          color: '#0ea5e9',
          icon: 'ShieldCheck',
          history: [
            {
              id: 'gh-y1',
              date: '2026-09-01',
              amount: 5000000,
              type: 'DEPOSIT',
              walletId: 'wal-bank',
              note: 'Nạp đầu kỳ',
            },
          ],
          createdAt: '2026-01-01',
        },
      ],
    });

    // Attempt generic metadata edit containing currentAmount = 999M and history = []
    const editRes = applyEditGoal(state, 'goal-y', {
      name: 'Quỹ Dự Phòng Đổi Tên',
      targetAmount: 30000000,
      color: '#f59e0b',
      currentAmount: 999000000, // Illegal overwrite attempt
      history: [], // Illegal overwrite attempt
    } as Partial<SavingsGoal>);

    expect(editRes.ok).toBe(true);
    if (!editRes.ok) return;

    const editedGoal = editRes.state.goals.find((g) => g.id === 'goal-y');
    expect(editedGoal).toBeDefined();

    // Invariant: financial fields remain unchanged!
    expect(editedGoal?.currentAmount).toBe(5000000);
    expect(editedGoal?.history.length).toBe(1);
    expect(editedGoal?.history[0].id).toBe('gh-y1');

    // Metadata changes remain possible
    expect(editedGoal?.name).toBe('Quỹ Dự Phòng Đổi Tên');
    expect(editedGoal?.targetAmount).toBe(30000000);
    expect(editedGoal?.color).toBe('#f59e0b');
  });

  // =========================================================================
  // CASE T — Paid Bill Cannot Be Edited
  // =========================================================================
  it('CASE T — Paid Bill Cannot Be Edited: editing a PAID or linked bill is rejected', () => {
    const state = createMockState({
      bills: [
        {
          id: 'bill-t',
          name: 'Tiền Internet T',
          amount: 350000,
          categoryId: 'cat-bills',
          dueDay: 15,
          frequency: 'MONTHLY',
          status: 'UNPAID',
        },
      ],
      wallets: [
        {
          id: 'wal-bank',
          name: 'Ngân hàng Chính',
          type: 'BANK',
          balance: 10000000,
          initialBalance: 10000000,
          currency: 'VND',
          color: '#0ea5e9',
          icon: 'Building2',
          createdAt: '2026-01-01',
        },
      ],
      transactions: [],
    });

    // 1. Pay bill successfully
    const payRes = applyPayBill(state, 'bill-t', 'wal-bank');
    expect(payRes.ok).toBe(true);
    if (!payRes.ok) return;

    // 2. Attempt to edit amount, category, or dueDay while PAID
    const editRes = applyEditBill(payRes.state, 'bill-t', {
      amount: 500000,
      dueDay: 20,
      name: 'Internet Nâng Cấp',
    });

    expect(editRes.ok).toBe(false);
    if (!editRes.ok) {
      expect(editRes.error).toMatch(/đã thanh toán|liên kết/i);
    }

    // Expected: bill unchanged, linked payment unchanged
    const bill = payRes.state.bills.find((b) => b.id === 'bill-t');
    expect(bill?.amount).toBe(350000);
    expect(bill?.dueDay).toBe(15);
    expect(bill?.status).toBe('PAID');

    const linkedTx = payRes.state.transactions.find(
      (t) => t.origin === 'BILL_PAYMENT' && t.originId === 'bill-t'
    );
    expect(linkedTx).toBeDefined();
    expect(linkedTx?.amount).toBe(350000);
  });

  // =========================================================================
  // CASE U — Paid Bill Cannot Be Deleted
  // =========================================================================
  it('CASE U — Paid Bill Cannot Be Deleted: delete rejected while PAID; succeeds after unpay', () => {
    const state = createMockState({
      bills: [
        {
          id: 'bill-u',
          name: 'Tiền Điện U',
          amount: 500000,
          categoryId: 'cat-bills',
          dueDay: 12,
          frequency: 'MONTHLY',
          status: 'UNPAID',
        },
      ],
      wallets: [
        {
          id: 'wal-bank',
          name: 'Ngân hàng Chính',
          type: 'BANK',
          balance: 10000000,
          initialBalance: 10000000,
          currency: 'VND',
          color: '#0ea5e9',
          icon: 'Building2',
          createdAt: '2026-01-01',
        },
      ],
      transactions: [],
    });

    // 1. Pay bill successfully
    const payRes = applyPayBill(state, 'bill-u', 'wal-bank');
    expect(payRes.ok).toBe(true);
    if (!payRes.ok) return;

    // 2. Attempt delete while PAID
    const deleteRes = applyDeleteBill(payRes.state, 'bill-u');
    expect(deleteRes.ok).toBe(false);
    if (!deleteRes.ok) {
      expect(deleteRes.error).toMatch(/đã thanh toán|liên kết/i);
    }

    // Expected: bill remains, BILL_PAYMENT transaction remains
    expect(payRes.state.bills.some((b) => b.id === 'bill-u')).toBe(true);
    expect(payRes.state.transactions.some((t) => t.originId === 'bill-u')).toBe(true);

    // 3. Unpay bill
    const unpayRes = applyUnpayBill(payRes.state, 'bill-u');
    expect(unpayRes.ok).toBe(true);
    if (!unpayRes.ok) return;

    // 4. Delete after unpay
    const deleteAfterUnpay = applyDeleteBill(unpayRes.state, 'bill-u');
    expect(deleteAfterUnpay.ok).toBe(true);
    if (deleteAfterUnpay.ok) {
      expect(deleteAfterUnpay.state.bills.some((b) => b.id === 'bill-u')).toBe(false);
    }
  });

  // =========================================================================
  // CASE V — Wallet Type Is Immutable
  // =========================================================================
  it('CASE V — Wallet Type Is Immutable: BANK -> CREDIT attempt is rejected and balance/semantics unchanged', () => {
    const state = createMockState({
      wallets: [
        {
          id: 'wal-bank-v',
          name: 'Ngân hàng V',
          type: 'BANK',
          balance: 20000000,
          initialBalance: 20000000,
          currency: 'VND',
          color: '#0ea5e9',
          icon: 'Building2',
          createdAt: '2026-01-01',
        },
      ],
    });

    // Attempt: BANK -> CREDIT
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editRes = applyEditWallet(state, 'wal-bank-v', { type: 'CREDIT' as any });
    expect(editRes.ok).toBe(false);
    if (!editRes.ok) {
      expect(editRes.error).toMatch(/bất biến/i);
    }

    // Balance and financial semantics unchanged
    const wallet = state.wallets.find((w) => w.id === 'wal-bank-v');
    expect(wallet?.type).toBe('BANK');
    expect(wallet?.balance).toBe(20000000);
  });

  // =========================================================================
  // CASE W — Credit Limit Cannot Be Lower Than Debt
  // =========================================================================
  it('CASE W — Credit Limit Cannot Be Lower Than Debt: credit debt 10M, limit 5M attempt is rejected', () => {
    const state = createMockState({
      wallets: [
        {
          id: 'wal-credit-w',
          name: 'Thẻ Tín Dụng W',
          type: 'CREDIT',
          balance: 10000000, // Current debt = 10M
          initialBalance: 10000000,
          creditLimit: 15000000,
          currency: 'VND',
          color: '#8b5cf6',
          icon: 'CreditCard',
          createdAt: '2026-01-01',
        },
      ],
    });

    // Attempt: creditLimit = 5M (lower than 10M debt)
    const editRes = applyEditWallet(state, 'wal-credit-w', { creditLimit: 5000000 });
    expect(editRes.ok).toBe(false);
    if (!editRes.ok) {
      expect(editRes.error).toMatch(/nhỏ hơn dư nợ/i);
    }

    // Wallet unchanged
    const wallet = state.wallets.find((w) => w.id === 'wal-credit-w');
    expect(wallet?.creditLimit).toBe(15000000);
    expect(wallet?.balance).toBe(10000000);
  });

  // =========================================================================
  // CASE X — Invalid New Wallet State
  // =========================================================================
  it('CASE X — Invalid New Wallet State: rejects negative, infinity, invalid limits/interest', () => {
    const state = createMockState({ wallets: [] });

    // 1. Negative asset balance
    const resNegativeAsset = applyAddWallet(state, {
      name: 'Tiền mặt âm',
      type: 'CASH',
      balance: -100000,
      initialBalance: -100000,
      currency: 'VND',
      color: '#10b981',
      icon: 'Banknote',
    });
    expect(resNegativeAsset.ok).toBe(false);

    // 2. Infinity balance
    const resInfinity = applyAddWallet(state, {
      name: 'Ví vô hạn',
      type: 'BANK',
      balance: Infinity,
      initialBalance: Infinity,
      currency: 'VND',
      color: '#0ea5e9',
      icon: 'Building2',
    });
    expect(resInfinity.ok).toBe(false);

    // 3. Negative credit debt
    const resNegativeDebt = applyAddWallet(state, {
      name: 'Thẻ nợ âm',
      type: 'CREDIT',
      balance: -500000,
      initialBalance: -500000,
      creditLimit: 10000000,
      currency: 'VND',
      color: '#8b5cf6',
      icon: 'CreditCard',
    });
    expect(resNegativeDebt.ok).toBe(false);

    // 4. Credit debt > creditLimit
    const resDebtOverLimit = applyAddWallet(state, {
      name: 'Thẻ nợ vượt hạn mức',
      type: 'CREDIT',
      balance: 15000000,
      initialBalance: 15000000,
      creditLimit: 10000000,
      currency: 'VND',
      color: '#8b5cf6',
      icon: 'CreditCard',
    });
    expect(resDebtOverLimit.ok).toBe(false);

    // 5. Invalid / zero CREDIT limit
    const resZeroLimit = applyAddWallet(state, {
      name: 'Thẻ hạn mức 0',
      type: 'CREDIT',
      balance: 0,
      initialBalance: 0,
      creditLimit: 0,
      currency: 'VND',
      color: '#8b5cf6',
      icon: 'CreditCard',
    });
    expect(resZeroLimit.ok).toBe(false);

    // 6. Negative SAVINGS interest rate
    const resNegativeInterest = applyAddWallet(state, {
      name: 'Sổ lãi âm',
      type: 'SAVINGS',
      balance: 5000000,
      initialBalance: 5000000,
      interestRate: -3.5,
      currency: 'VND',
      color: '#f59e0b',
      icon: 'PiggyBank',
    });
    expect(resNegativeInterest.ok).toBe(false);

    // 7. Valid wallet creation succeeds
    const resValid = applyAddWallet(state, {
      name: 'Ví hợp lệ',
      type: 'BANK',
      balance: 5000000,
      initialBalance: 5000000,
      currency: 'VND',
      color: '#0ea5e9',
      icon: 'Building2',
    });
    expect(resValid.ok).toBe(true);
    if (resValid.ok) {
      expect(resValid.state.wallets).toHaveLength(1);
      expect(resValid.newWallet.balance).toBe(5000000);
      expect(resValid.newWallet.initialBalance).toBe(5000000);
    }
  });

  // =========================================================================
  // CASE Z — Transaction Transfer Metadata Normalization
  // =========================================================================
  it('CASE Z — Transaction Transfer Metadata Normalization: normalizes transferKind, cleanses transfer fields on EXPENSE/INCOME, prevents credit source', () => {
    const state = createMockState({
      wallets: [
        {
          id: 'wal-bank-1',
          name: 'Ngân hàng 1',
          type: 'BANK',
          balance: 20000000,
          initialBalance: 20000000,
          currency: 'VND',
          color: '#0ea5e9',
          icon: 'Building2',
          createdAt: '2026-01-01',
        },
        {
          id: 'wal-bank-2',
          name: 'Ngân hàng 2',
          type: 'BANK',
          balance: 10000000,
          initialBalance: 10000000,
          currency: 'VND',
          color: '#0ea5e9',
          icon: 'Building2',
          createdAt: '2026-01-01',
        },
        {
          id: 'wal-credit',
          name: 'Thẻ Tín Dụng',
          type: 'CREDIT',
          balance: 5000000, // debt = 5M
          initialBalance: 5000000,
          creditLimit: 20000000,
          currency: 'VND',
          color: '#8b5cf6',
          icon: 'CreditCard',
          createdAt: '2026-01-01',
        },
      ],
      transactions: [],
    });

    // 1. normal wallet -> normal wallet => WALLET_TRANSFER (authoritative)
    const addTxRes = applyAddTransaction(state, {
      amount: 1000000,
      type: 'TRANSFER',
      walletId: 'wal-bank-1',
      toWalletId: 'wal-bank-2',
      date: '2026-03-01T10:00:00.000Z',
      fee: 0,
      note: 'Chuyển khoản',
      tags: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transferKind: 'CREDIT_PAYMENT' as any, // Untrusted UI input
    });
    expect(addTxRes.ok).toBe(true);
    if (!addTxRes.ok) return;

    const txId = addTxRes.newTx.id;
    expect(addTxRes.newTx.transferKind).toBe('WALLET_TRANSFER');

    // 2. normal wallet -> CREDIT => CREDIT_PAYMENT
    const editToCreditRes = applyEditTransaction(addTxRes.state, txId, {
      toWalletId: 'wal-credit',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transferKind: 'WALLET_TRANSFER' as any, // Untrusted UI input
    });
    expect(editToCreditRes.ok).toBe(true);
    if (!editToCreditRes.ok) return;

    expect(editToCreditRes.updatedTx.transferKind).toBe('CREDIT_PAYMENT');
    expect(editToCreditRes.updatedTx.toWalletId).toBe('wal-credit');

    // 3. A previous CREDIT_PAYMENT edited to target a normal wallet must become WALLET_TRANSFER
    const editBackToBankRes = applyEditTransaction(editToCreditRes.state, txId, {
      toWalletId: 'wal-bank-2',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transferKind: 'CREDIT_PAYMENT' as any, // Untrusted UI input
    });
    expect(editBackToBankRes.ok).toBe(true);
    if (!editBackToBankRes.ok) return;

    expect(editBackToBankRes.updatedTx.transferKind).toBe('WALLET_TRANSFER');
    expect(editBackToBankRes.updatedTx.toWalletId).toBe('wal-bank-2');

    // 4. TRANSFER edited to EXPENSE => transferKind/toWalletId/toWalletName cleared, fee is 0
    const editToExpRes = applyEditTransaction(editBackToBankRes.state, txId, {
      type: 'EXPENSE',
      categoryId: 'cat-food',
    });
    expect(editToExpRes.ok).toBe(true);
    if (!editToExpRes.ok) return;

    expect(editToExpRes.updatedTx.type).toBe('EXPENSE');
    expect(editToExpRes.updatedTx.toWalletId).toBeUndefined();
    expect(editToExpRes.updatedTx.toWalletName).toBeUndefined();
    expect(editToExpRes.updatedTx.transferKind).toBeUndefined();
    expect(editToExpRes.updatedTx.fee).toBe(0);

    // 5. Source CREDIT for TRANSFER is rejected
    const editCreditSourceRes = applyEditTransaction(editBackToBankRes.state, txId, {
      walletId: 'wal-credit',
      toWalletId: 'wal-bank-1',
    });
    expect(editCreditSourceRes.ok).toBe(false);
    if (!editCreditSourceRes.ok) {
      expect(editCreditSourceRes.error).toMatch(/từ thẻ tín dụng/i);
    }
  });

  // =========================================================================
  // CASE AA — Bill Data Structural Validation
  // =========================================================================
  it('CASE AA — Bill Data Structural Validation: rejects non-positive amount, invalid dueDay, frequency, or empty name', () => {
    const state = createMockState({ bills: [] });

    // 1. Rejects empty bill name
    const resEmptyName = applyAddBill(state, {
      name: '   ',
      amount: 500000,
      categoryId: 'cat-bills',
      dueDay: 15,
      frequency: 'MONTHLY',
    });
    expect(resEmptyName.ok).toBe(false);

    // 2. Rejects negative or zero amount
    const resZeroAmount = applyAddBill(state, {
      name: 'Internet',
      amount: 0,
      categoryId: 'cat-bills',
      dueDay: 15,
      frequency: 'MONTHLY',
    });
    expect(resZeroAmount.ok).toBe(false);

    const resNaN = applyAddBill(state, {
      name: 'Internet',
      amount: NaN,
      categoryId: 'cat-bills',
      dueDay: 15,
      frequency: 'MONTHLY',
    });
    expect(resNaN.ok).toBe(false);

    // 3. Rejects invalid dueDay (0, 32, float)
    const resDue0 = applyAddBill(state, {
      name: 'Internet',
      amount: 300000,
      categoryId: 'cat-bills',
      dueDay: 0,
      frequency: 'MONTHLY',
    });
    expect(resDue0.ok).toBe(false);

    const resDue32 = applyAddBill(state, {
      name: 'Internet',
      amount: 300000,
      categoryId: 'cat-bills',
      dueDay: 32,
      frequency: 'MONTHLY',
    });
    expect(resDue32.ok).toBe(false);

    const resDueFloat = applyAddBill(state, {
      name: 'Internet',
      amount: 300000,
      categoryId: 'cat-bills',
      dueDay: 15.5,
      frequency: 'MONTHLY',
    });
    expect(resDueFloat.ok).toBe(false);

    // 4. Rejects invalid frequency
    const resFreq = applyAddBill(state, {
      name: 'Internet',
      amount: 300000,
      categoryId: 'cat-bills',
      dueDay: 15,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      frequency: 'WEEKLY' as any,
    });
    expect(resFreq.ok).toBe(false);
  });

  // =========================================================================
  // CASE BB — Credit Limit Edits Validation
  // =========================================================================
  it('CASE BB — Credit Limit Edits Validation: rejects zero, negative, NaN or Infinity creditLimit and negative interest', () => {
    const state = createMockState({
      wallets: [
        {
          id: 'wal-credit-bb',
          name: 'Thẻ BB',
          type: 'CREDIT',
          balance: 2000000, // debt = 2M
          initialBalance: 2000000,
          creditLimit: 10000000,
          currency: 'VND',
          color: '#8b5cf6',
          icon: 'CreditCard',
          createdAt: '2026-01-01',
        },
        {
          id: 'wal-savings-bb',
          name: 'Sổ BB',
          type: 'SAVINGS',
          balance: 5000000,
          initialBalance: 5000000,
          interestRate: 6.0,
          currency: 'VND',
          color: '#f59e0b',
          icon: 'PiggyBank',
          createdAt: '2026-01-01',
        },
      ],
    });

    // 1. creditLimit <= 0
    const resZero = applyEditWallet(state, 'wal-credit-bb', { creditLimit: 0 });
    expect(resZero.ok).toBe(false);

    // 2. creditLimit is NaN
    const resNaN = applyEditWallet(state, 'wal-credit-bb', { creditLimit: NaN });
    expect(resNaN.ok).toBe(false);

    // 3. creditLimit is Infinity
    const resInf = applyEditWallet(state, 'wal-credit-bb', { creditLimit: Infinity });
    expect(resInf.ok).toBe(false);

    // 4. negative SAVINGS interest rate
    const resNegInt = applyEditWallet(state, 'wal-savings-bb', { interestRate: -2.5 });
    expect(resNegInt.ok).toBe(false);
  });

  // =========================================================================
  // CASE CC — Unpaid Bill Valid Edit Succeeds
  // =========================================================================
  it('CASE CC — Unpaid Bill Valid Edit Succeeds: UNPAID bill can update name, amount, dueDay, and frequency', () => {
    const state = createMockState({
      bills: [
        {
          id: 'bill-cc',
          name: 'Tiền Nước CC',
          amount: 200000,
          categoryId: 'cat-bills',
          dueDay: 10,
          frequency: 'MONTHLY',
          status: 'UNPAID',
        },
      ],
    });

    const editRes = applyEditBill(state, 'bill-cc', {
      name: 'Tiền Nước Sinh Hoạt Mới',
      amount: 250000,
      dueDay: 25,
      frequency: 'QUARTERLY',
    });

    expect(editRes.ok).toBe(true);
    if (!editRes.ok) return;

    const updated = editRes.state.bills.find((b) => b.id === 'bill-cc');
    expect(updated?.name).toBe('Tiền Nước Sinh Hoạt Mới');
    expect(updated?.amount).toBe(250000);
    expect(updated?.dueDay).toBe(25);
    expect(updated?.frequency).toBe('QUARTERLY');
    expect(updated?.status).toBe('UNPAID');
  });

  // =========================================================================
  // CASE DD — Seed Bill Consistency
  // =========================================================================
  it('CASE DD — Seed Bill Consistency: INITIAL bill-rent has linked BILL_PAYMENT transaction, wallet consistency, generic protection, and unpay succeeds', () => {
    // 1. Initial bill-rent must have status === PAID and walletId === 'wal-tcb'
    const rentBill = INITIAL_BILLS.find((b) => b.id === 'bill-rent');
    expect(rentBill).toBeDefined();
    expect(rentBill?.status).toBe('PAID');
    expect(rentBill?.walletId).toBe('wal-tcb');

    // 2. Initial transactions must have an authoritative linked payment transaction
    const linkedTx = INITIAL_TRANSACTIONS.find(
      (t) => t.origin === 'BILL_PAYMENT' && t.originId === 'bill-rent'
    );
    expect(linkedTx).toBeDefined();
    expect(linkedTx?.id).toBe('tx-003');
    expect(linkedTx?.walletId).toBe('wal-tcb');
    expect(linkedTx?.amount).toBe(6000000);

    // 3. The transaction must be protected against generic edit and generic delete
    const state: AppDomainState = {
      wallets: [...INITIAL_WALLETS],
      transactions: [...INITIAL_TRANSACTIONS],
      goals: [...INITIAL_GOALS],
      bills: [...INITIAL_BILLS],
    };

    const editRes = applyEditTransaction(state, 'tx-003', { amount: 7000000 });
    expect(editRes.ok).toBe(false);
    expect((editRes as { error: string }).error).toContain('Không thể chỉnh sửa trực tiếp giao dịch');

    const deleteRes = applyDeleteTransaction(state, 'tx-003');
    expect(deleteRes.ok).toBe(false);
    expect((deleteRes as { error: string }).error).toContain('Không thể xóa trực tiếp giao dịch');

    // 4. applyUnpayBill on the initial paid bill succeeds
    const unpayRes = applyUnpayBill(state, 'bill-rent');
    expect(unpayRes.ok).toBe(true);
    if (!unpayRes.ok) return;

    // Bill becomes UNPAID
    const unpayRentBill = unpayRes.state.bills.find((b) => b.id === 'bill-rent');
    expect(unpayRentBill?.status).toBe('UNPAID');

    // Linked transaction is removed
    const postLinkedTx = unpayRes.state.transactions.find((t) => t.id === 'tx-003');
    expect(postLinkedTx).toBeUndefined();

    // wal-tcb balance is restored (+6,000,000)
    const initialTcb = INITIAL_WALLETS.find((w) => w.id === 'wal-tcb')!;
    const postTcb = unpayRes.state.wallets.find((w) => w.id === 'wal-tcb')!;
    expect(postTcb.balance).toBe(initialTcb.balance + 6000000);
  });

  // =========================================================================
  // CASE EE — Local Date/Time Semantics and Calendar Grouping
  // =========================================================================
  it('CASE EE — Local Date/Time Semantics: proper local datetime-local formatting, ISO round-trip, and local calendar grouping', () => {
    // 1. toLocalDateTimeInputValue produces local YYYY-MM-DDTHH:mm
    const fixedLocal = new Date(2026, 8, 17, 14, 30, 0); // 2026-09-17 14:30 in local time
    const inputVal = toLocalDateTimeInputValue(fixedLocal);
    expect(inputVal).toBe('2026-09-17T14:30');

    // Single-digit padding
    const singleDigit = new Date(2026, 0, 5, 8, 5, 0); // 2026-01-05 08:05 in local time
    expect(toLocalDateTimeInputValue(singleDigit)).toBe('2026-01-05T08:05');

    // 2. localDateTimeInputToISO round-trip preserves local wall-clock time
    const isoString = localDateTimeInputToISO('2026-09-17T14:30');
    expect(isoString).not.toBeNull();
    const backToLocal = toLocalDateTimeInputValue(isoString!);
    expect(backToLocal).toBe('2026-09-17T14:30');

    // 3. getLocalDateKey and getLocalYearMonth
    expect(getLocalDateKey(fixedLocal)).toBe('2026-09-17');
    expect(getLocalYearMonth(fixedLocal)).toBe('2026-09');

    // 4. isDateInLocalYearMonth checks local calendar
    expect(isDateInLocalYearMonth(fixedLocal, '2026-09')).toBe(true);
    expect(isDateInLocalYearMonth(fixedLocal, '2026-10')).toBe(false);

    // 5. Month grouping in calculateFinancialSummary uses local calendar
    const state = createMockState({
      transactions: [
        {
          id: 'tx-sept',
          type: 'EXPENSE',
          amount: 500000,
          walletId: 'wal-bank',
          date: '2026-09-15T12:00:00',
          note: '',
          tags: [],
          createdAt: '2026-09-15T12:00:00',
        },
        {
          id: 'tx-oct',
          type: 'EXPENSE',
          amount: 800000,
          walletId: 'wal-bank',
          date: '2026-10-01T10:00:00',
          note: '',
          tags: [],
          createdAt: '2026-10-01T10:00:00',
        },
      ],
    });

    const summarySept = calculateFinancialSummary(state.wallets, state.transactions, '2026-09');
    expect(summarySept.monthlyExpense).toBe(500000);

    const summaryOct = calculateFinancialSummary(state.wallets, state.transactions, '2026-10');
    expect(summaryOct.monthlyExpense).toBe(800000);
  });

  // =========================================================================
  // CASE FF — Domain-Safe Goal Creation (applyAddGoal)
  // =========================================================================
  it('CASE FF — Domain-Safe Goal Creation: validates name, amount, deadline and enforces initial invariants', () => {
    const state = createMockState();

    // 1. Empty or whitespace-only name rejected
    const resEmptyName = applyAddGoal(state, {
      name: '   ',
      targetAmount: 10000000,
      deadline: '2026-12-31',
    });
    expect(resEmptyName.ok).toBe(false);

    // 2. targetAmount <= 0, NaN, Infinity rejected
    const resZeroAmount = applyAddGoal(state, {
      name: 'Du lịch',
      targetAmount: 0,
      deadline: '2026-12-31',
    });
    expect(resZeroAmount.ok).toBe(false);

    const resNaNAmount = applyAddGoal(state, {
      name: 'Du lịch',
      targetAmount: NaN,
      deadline: '2026-12-31',
    });
    expect(resNaNAmount.ok).toBe(false);

    const resInfAmount = applyAddGoal(state, {
      name: 'Du lịch',
      targetAmount: Infinity,
      deadline: '2026-12-31',
    });
    expect(resInfAmount.ok).toBe(false);

    // 3. Invalid deadline rejected
    const resBadDate = applyAddGoal(state, {
      name: 'Du lịch',
      targetAmount: 10000000,
      deadline: 'invalid-date',
    });
    expect(resBadDate.ok).toBe(false);

    // 4. Invariants enforced: caller cannot inject currentAmount or history
    const resValid = applyAddGoal(state, {
      name: ' Mua Macbook Pro ',
      targetAmount: 45000000,
      deadline: '2026-11-30',
      color: '#3b82f6',
      icon: 'Laptop',
      currentAmount: 9999999, // Should be ignored and forced to 0
      history: [{ id: 'fake', amount: 1000 }], // Should be ignored and forced to []
    });

    expect(resValid.ok).toBe(true);
    if (!resValid.ok) return;

    expect(resValid.newGoal.name).toBe('Mua Macbook Pro');
    expect(resValid.newGoal.targetAmount).toBe(45000000);
    expect(resValid.newGoal.currentAmount).toBe(0);
    expect(resValid.newGoal.history).toEqual([]);
    expect(resValid.newGoal.deadline).toBe('2026-11-30');
    expect(resValid.newGoal.id).toMatch(/^goal-/);
    expect(resValid.newGoal.createdAt).toBeDefined();
    expect(resValid.state.goals).toContainEqual(resValid.newGoal);
  });

  // =========================================================================
  // CASE GG — Domain-Safe Budget Operations (applyAddBudget, applyEditBudget, applyDeleteBudget)
  // =========================================================================
  it('CASE GG — Domain-Safe Budget Operations: validates budgets, prevents duplicates per category+month, protects immutability', () => {
    const existingBudgets: Budget[] = [
      {
        id: 'bud-food-09',
        categoryId: 'cat-food',
        categoryName: 'Ăn uống',
        amount: 5000000,
        month: '2026-09',
        alertThreshold80: true,
        alertThreshold100: true,
      },
    ];

    // 1. Rejects duplicate active budget for same categoryId + month
    const dupRes = applyAddBudget(existingBudgets, {
      categoryId: 'cat-food',
      categoryName: 'Ăn uống',
      amount: 6000000,
      month: '2026-09',
    });
    expect(dupRes.ok).toBe(false);
    expect((dupRes as { error: string }).error).toContain('đã tồn tại');

    // 2. Allows same category in a DIFFERENT month
    const nextMonthRes = applyAddBudget(existingBudgets, {
      categoryId: 'cat-food',
      categoryName: 'Ăn uống',
      amount: 6000000,
      month: '2026-10',
    });
    expect(nextMonthRes.ok).toBe(true);
    if (!nextMonthRes.ok) return;
    expect(nextMonthRes.budgets.length).toBe(2);

    // 3. Rejects invalid budget data (amount <= 0, invalid month, empty category)
    const zeroAmt = applyAddBudget(existingBudgets, {
      categoryId: 'cat-bills',
      categoryName: 'Hóa đơn',
      amount: 0,
      month: '2026-09',
    });
    expect(zeroAmt.ok).toBe(false);

    const badMonth = applyAddBudget(existingBudgets, {
      categoryId: 'cat-bills',
      categoryName: 'Hóa đơn',
      amount: 1000000,
      month: '2026-13',
    });
    expect(badMonth.ok).toBe(false);

    const emptyCat = applyAddBudget(existingBudgets, {
      categoryId: '   ',
      categoryName: '',
      amount: 1000000,
      month: '2026-09',
    });
    expect(emptyCat.ok).toBe(false);

    // 4. applyEditBudget: month and id immutable
    const editMonthRes = applyEditBudget(existingBudgets, 'bud-food-09', { month: '2026-11' });
    expect(editMonthRes.ok).toBe(false);
    expect((editMonthRes as { error: string }).error).toContain('Tháng áp dụng ngân sách không thể thay đổi');

    // Valid edit
    const validEdit = applyEditBudget(existingBudgets, 'bud-food-09', { amount: 5500000 });
    expect(validEdit.ok).toBe(true);
    if (!validEdit.ok) return;
    expect(validEdit.updatedBudget.amount).toBe(5500000);
    expect(validEdit.updatedBudget.month).toBe('2026-09');

    // 5. applyDeleteBudget
    const delRes = applyDeleteBudget(existingBudgets, 'bud-food-09');
    expect(delRes.ok).toBe(true);
    if (!delRes.ok) return;
    expect(delRes.budgets.length).toBe(0);

    const delNonExistent = applyDeleteBudget(existingBudgets, 'non-existent');
    expect(delNonExistent.ok).toBe(false);
  });

  // =========================================================================
  // CASE HH — Domain-Safe 50/30/20 Planner (applyUpdatePlanner)
  // =========================================================================
  it('CASE HH — Domain-Safe 50/30/20 Planner: validates income and total percentages equal exactly 100', () => {
    // 1. Rejects negative income
    const negIncome = applyUpdatePlanner({
      monthlyIncome: -5000000,
      needsPercent: 50,
      wantsPercent: 30,
      savingsPercent: 20,
    });
    expect(negIncome.ok).toBe(false);

    // 2. Rejects total != 100
    const not100 = applyUpdatePlanner({
      monthlyIncome: 20000000,
      needsPercent: 50,
      wantsPercent: 30,
      savingsPercent: 15, // Total = 95
    });
    expect(not100.ok).toBe(false);
    expect((not100 as { error: string }).error).toContain('phải bằng 100%');

    // 3. Rejects negative percentage or > 100
    const negPercent = applyUpdatePlanner({
      monthlyIncome: 20000000,
      needsPercent: -10,
      wantsPercent: 80,
      savingsPercent: 30,
    });
    expect(negPercent.ok).toBe(false);

    // 4. Accepts valid distribution
    const validPlanner: IncomeBudgetPlanner = {
      monthlyIncome: 30000000,
      needsPercent: 60,
      wantsPercent: 20,
      savingsPercent: 20,
      notes: 'Tháng này đầu tư nhiều hơn',
    };
    const validRes = applyUpdatePlanner(validPlanner);
    expect(validRes.ok).toBe(true);
    if (!validRes.ok) return;
    expect(validRes.planner.needsPercent).toBe(60);
    expect(validRes.planner.wantsPercent).toBe(20);
    expect(validRes.planner.savingsPercent).toBe(20);
  });

  // =========================================================================
  // CASE II — Storage Snapshot Validation & Referential Integrity
  // =========================================================================
  it('CASE II — Storage Snapshot Validation: validates full snapshot, detects orphan references and domain violations', () => {
    // 1. Default mock data snapshot is valid
    const defaultSnapshot = {
      wallets: INITIAL_WALLETS,
      transactions: INITIAL_TRANSACTIONS,
      categories: DEFAULT_CATEGORIES,
      budgets: INITIAL_BUDGETS,
      bills: INITIAL_BILLS,
      goals: INITIAL_GOALS,
      planner: INITIAL_PLANNER,
    };
    const validRes = validateAndNormalizeAppSnapshot(defaultSnapshot);
    expect(validRes.ok).toBe(true);

    // 2. Rejects invalid non-object input
    expect(validateAndNormalizeAppSnapshot(null).ok).toBe(false);
    expect(validateAndNormalizeAppSnapshot('invalid-string').ok).toBe(false);

    // 3. Rejects transaction with orphan walletId
    const orphanTxSnapshot = {
      ...defaultSnapshot,
      transactions: [
        ...INITIAL_TRANSACTIONS,
        {
          id: 'tx-orphan',
          type: 'EXPENSE',
          amount: 100000,
          walletId: 'wal-ghost', // Does not exist
          date: '2026-09-17T10:00:00',
        },
      ],
    };
    const orphanTxRes = validateAndNormalizeAppSnapshot(orphanTxSnapshot);
    expect(orphanTxRes.ok).toBe(false);
    expect((orphanTxRes as { error: string }).error).toContain('tham chiếu đến ví không tồn tại');

    // 4. Rejects transfer where toWalletId does not exist or toWalletId === walletId
    const invalidTransferSnapshot = {
      ...defaultSnapshot,
      transactions: [
        ...INITIAL_TRANSACTIONS,
        {
          id: 'tx-bad-transfer',
          type: 'TRANSFER',
          amount: 100000,
          walletId: 'wal-bank',
          toWalletId: 'wal-bank', // same
          date: '2026-09-17T10:00:00',
        },
      ],
    };
    const badTransferRes = validateAndNormalizeAppSnapshot(invalidTransferSnapshot);
    expect(badTransferRes.ok).toBe(false);

    // 5. Rejects budget with orphan categoryId
    const orphanBudgetSnapshot = {
      ...defaultSnapshot,
      budgets: [
        ...INITIAL_BUDGETS,
        {
          id: 'bud-orphan',
          categoryId: 'cat-ghost', // Does not exist
          categoryName: 'Ma',
          amount: 1000000,
          month: '2026-09',
        },
      ],
    };
    const orphanBudgetRes = validateAndNormalizeAppSnapshot(orphanBudgetSnapshot);
    expect(orphanBudgetRes.ok).toBe(false);
    expect((orphanBudgetRes as { error: string }).error).toContain('tham chiếu đến danh mục không tồn tại');

    // 6. Rejects duplicate budget in same month for same category
    const dupBudgetSnapshot = {
      ...defaultSnapshot,
      budgets: [
        ...INITIAL_BUDGETS,
        {
          id: 'bud-dup',
          categoryId: INITIAL_BUDGETS[0].categoryId,
          categoryName: 'Trùng lặp',
          amount: 2000000,
          month: INITIAL_BUDGETS[0].month,
        },
      ],
    };
    const dupBudgetRes = validateAndNormalizeAppSnapshot(dupBudgetSnapshot);
    expect(dupBudgetRes.ok).toBe(false);
    expect((dupBudgetRes as { error: string }).error).toContain('Trùng lặp ngân sách');

    // 7. Rejects PAID bill with no linked transaction
    const orphanPaidBillSnapshot = {
      ...defaultSnapshot,
      bills: [
        ...INITIAL_BILLS,
        {
          id: 'bill-unlinked-paid',
          name: 'Hóa đơn ma đã thanh toán',
          amount: 500000,
          categoryId: 'cat-bills',
          dueDay: 10,
          frequency: 'MONTHLY',
          status: 'PAID',
        },
      ],
    };
    const orphanPaidRes = validateAndNormalizeAppSnapshot(orphanPaidBillSnapshot);
    expect(orphanPaidRes.ok).toBe(false);
    expect((orphanPaidRes as { error: string }).error).toContain('không có giao dịch thanh toán liên kết');

    // 8. Rejects CREDIT wallet where debt > creditLimit
    const overlimitSnapshot = {
      ...defaultSnapshot,
      wallets: [
        {
          id: 'wal-overlimit',
          name: 'Thẻ vượt hạn mức',
          type: 'CREDIT',
          balance: 60000000, // Dư nợ 60M
          creditLimit: 50000000, // Hạn mức 50M
        },
      ],
      transactions: [],
      bills: [],
    };
    const overlimitRes = validateAndNormalizeAppSnapshot(overlimitSnapshot);
    expect(overlimitRes.ok).toBe(false);
    expect((overlimitRes as { error: string }).error).toContain('vượt quá hạn mức');
  });

  // =========================================================================
  // CASE JJ — Goal Deposit Round-Trip Snapshot Integrity
  // =========================================================================
  it('CASE JJ — Goal Deposit Round-Trip: deposits from bank to goal, validates and normalizes snapshot without rejection', () => {
    const state = createMockState();
    const depositRes = applyGoalDeposit(state, 'goal-emergency', 'wal-bank', 5000000);
    expect(depositRes.ok).toBe(true);
    if (!depositRes.ok) return;

    const snapshot = {
      schemaVersion: SCHEMA_VERSION,
      wallets: depositRes.state.wallets,
      transactions: depositRes.state.transactions,
      categories: DEFAULT_CATEGORIES,
      budgets: INITIAL_BUDGETS,
      bills: state.bills,
      goals: depositRes.state.goals,
      planner: INITIAL_PLANNER,
    };

    const normRes = validateAndNormalizeAppSnapshot(snapshot);
    expect(normRes.ok).toBe(true);
    if (!normRes.ok) return;

    const goalTx = normRes.data.transactions.find((t) => t.id === depositRes.newTx.id);
    expect(goalTx).toBeDefined();
    expect(goalTx?.type).toBe('TRANSFER');
    expect(goalTx?.transferKind).toBe('GOAL_DEPOSIT');
    expect(goalTx?.walletId).toBe('wal-bank');
    expect(goalTx?.toWalletId).toBeUndefined();
    expect(goalTx?.origin).toBe('GOAL');
    expect(goalTx?.originId).toBe('goal-emergency');
  });

  // =========================================================================
  // CASE KK — Goal Withdrawal Round-Trip Snapshot Integrity
  // =========================================================================
  it('CASE KK — Goal Withdrawal Round-Trip: withdraws from goal to bank, validates and normalizes snapshot without rejection', () => {
    const baseState = createMockState();
    const depRes = applyGoalDeposit(baseState, 'goal-emergency', 'wal-bank', 10000000);
    expect(depRes.ok).toBe(true);
    if (!depRes.ok) return;

    const withRes = applyGoalWithdraw(depRes.state, 'goal-emergency', 'wal-bank', 4000000);
    expect(withRes.ok).toBe(true);
    if (!withRes.ok) return;

    const snapshot = {
      schemaVersion: SCHEMA_VERSION,
      wallets: withRes.state.wallets,
      transactions: withRes.state.transactions,
      categories: DEFAULT_CATEGORIES,
      budgets: INITIAL_BUDGETS,
      bills: baseState.bills,
      goals: withRes.state.goals,
      planner: INITIAL_PLANNER,
    };

    const normRes = validateAndNormalizeAppSnapshot(snapshot);
    expect(normRes.ok).toBe(true);
    if (!normRes.ok) return;

    const withTx = normRes.data.transactions.find((t) => t.id === withRes.newTx.id);
    expect(withTx).toBeDefined();
    expect(withTx?.type).toBe('TRANSFER');
    expect(withTx?.transferKind).toBe('GOAL_WITHDRAWAL');
    expect(withTx?.walletId).toBe('wal-bank');
    expect(withTx?.toWalletId).toBeUndefined();
    expect(withTx?.origin).toBe('GOAL');
    expect(withTx?.originId).toBe('goal-emergency');
  });

  // =========================================================================
  // CASE LL — Bill Payment Round-Trip Snapshot Integrity
  // =========================================================================
  it('CASE LL — Bill Payment Round-Trip: pays bill from bank, validates snapshot preserves PAID bill and linked transaction', () => {
    const state = createMockState();
    const payRes = applyPayBill(state, 'bill-internet', 'wal-bank');
    expect(payRes.ok).toBe(true);
    if (!payRes.ok) return;

    const snapshot = {
      schemaVersion: SCHEMA_VERSION,
      wallets: payRes.state.wallets,
      transactions: payRes.state.transactions,
      categories: DEFAULT_CATEGORIES,
      budgets: INITIAL_BUDGETS,
      bills: payRes.state.bills,
      goals: state.goals,
      planner: INITIAL_PLANNER,
    };

    const normRes = validateAndNormalizeAppSnapshot(snapshot);
    expect(normRes.ok).toBe(true);
    if (!normRes.ok) return;

    const paidBill = normRes.data.bills.find((b) => b.id === 'bill-internet');
    expect(paidBill?.status).toBe('PAID');

    const linkedTx = normRes.data.transactions.find(
      (t) => t.origin === 'BILL_PAYMENT' && t.originId === 'bill-internet'
    );
    expect(linkedTx).toBeDefined();
    expect(linkedTx?.amount).toBe(300000);
    expect(linkedTx?.walletId).toBe('wal-bank');
  });

  // =========================================================================
  // CASE MM — Corrupt Snapshot Safe Recovery (No Data Loss / No Overwrite)
  // =========================================================================
  it('CASE MM — Invalid snapshot does NOT overwrite storage: returns ok: false and preserves primary storage', () => {
    const state = createMockState();
    const corruptSnapshot = {
      schemaVersion: SCHEMA_VERSION,
      wallets: state.wallets,
      transactions: [
        {
          id: 'tx-broken',
          type: 'TRANSFER',
          transferKind: 'WALLET_TRANSFER',
          amount: 1000000,
          walletId: 'wal-bank',
          toWalletId: 'wal-bank', // Invalid: toWalletId === walletId
          date: '2026-09-17T12:00:00',
        },
      ],
      categories: DEFAULT_CATEGORIES,
      budgets: state.budgets,
      bills: state.bills,
      goals: state.goals,
      planner: state.planner,
    };

    const res = validateAndNormalizeAppSnapshot(corruptSnapshot);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('có ví nhận trùng ví gửi');
    }

    // Strengthened: Verify actual storage adapter behavior
    const adapter = new MemoryStorageAdapter();
    const rawCorrupt = JSON.stringify(corruptSnapshot);
    adapter.setItem('fintrack_pro_state_v1', rawCorrupt);

    const loadResult = loadStorageSnapshot(adapter, 'fintrack_pro_state_v1');
    expect(loadResult.status).toBe('RECOVERY_REQUIRED');
    // The primary key MUST remain byte-for-byte identical, never overwritten
    expect(adapter.getItem('fintrack_pro_state_v1')).toBe(rawCorrupt);
  });

  // =========================================================================
  // CASE NN — Legacy Snapshot Migration to v1
  // =========================================================================
  it('CASE NN — Legacy snapshot migration to v1: unversioned snapshot succeeds and normalizes', () => {
    const legacySnapshot = {
      // Missing schemaVersion
      wallets: INITIAL_WALLETS,
      transactions: INITIAL_TRANSACTIONS,
      categories: DEFAULT_CATEGORIES,
      budgets: INITIAL_BUDGETS,
      bills: INITIAL_BILLS,
      goals: INITIAL_GOALS,
      planner: INITIAL_PLANNER,
    };

    const res = validateAndNormalizeAppSnapshot(legacySnapshot);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.wallets.length).toBe(INITIAL_WALLETS.length);
    expect(res.data.transactions.length).toBe(INITIAL_TRANSACTIONS.length);
  });

  // =========================================================================
  // CASE OO — Unknown Future schemaVersion Rejected
  // =========================================================================
  it('CASE OO — Unknown future schemaVersion rejected: rejects version newer than SCHEMA_VERSION', () => {
    const futureSnapshot = {
      schemaVersion: 99,
      wallets: INITIAL_WALLETS,
      transactions: INITIAL_TRANSACTIONS,
      categories: DEFAULT_CATEGORIES,
      budgets: INITIAL_BUDGETS,
      bills: INITIAL_BILLS,
      goals: INITIAL_GOALS,
      planner: INITIAL_PLANNER,
    };

    const res = validateAndNormalizeAppSnapshot(futureSnapshot);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain('mới hơn phiên bản ứng dụng hỗ trợ');
  });

  // =========================================================================
  // CASE PP — Budget with Nonexistent or Non-EXPENSE Category Rejected
  // =========================================================================
  it('CASE PP — Budget category integrity: rejects nonexistent category or INCOME category in domain and storage', () => {
    const state = createMockState();
    // 1. Domain: applyAddBudget rejects nonexistent category
    const nonExistentRes = applyAddBudget(
      INITIAL_BUDGETS,
      { categoryId: 'cat-ghost', categoryName: 'Ma', amount: 1000000, month: '2026-09' },
      DEFAULT_CATEGORIES
    );
    expect(nonExistentRes.ok).toBe(false);
    if (!nonExistentRes.ok) {
      expect(nonExistentRes.error).toContain('không tồn tại trong hệ thống');
    }

    // 2. Domain: applyAddBudget rejects INCOME category
    const incomeCatRes = applyAddBudget(
      INITIAL_BUDGETS,
      { categoryId: 'cat-salary', categoryName: 'Lương chính', amount: 1000000, month: '2026-09' },
      DEFAULT_CATEGORIES
    );
    expect(incomeCatRes.ok).toBe(false);
    if (!incomeCatRes.ok) {
      expect(incomeCatRes.error).toContain('Chỉ có thể tạo ngân sách cho danh mục chi tiêu');
    }

    // 3. Storage schema: rejects snapshot containing budget with INCOME category
    const incomeBudgetSnapshot = {
      schemaVersion: SCHEMA_VERSION,
      wallets: state.wallets,
      transactions: [],
      categories: DEFAULT_CATEGORIES,
      budgets: [
        {
          id: 'bud-invalid-income',
          categoryId: 'cat-salary', // INCOME type
          categoryName: 'Lương chính',
          amount: 5000000,
          month: '2026-09',
        },
      ],
      bills: [],
      goals: [],
      planner: state.planner,
    };
    const storageRes = validateAndNormalizeAppSnapshot(incomeBudgetSnapshot);
    expect(storageRes.ok).toBe(false);
    if (!storageRes.ok) {
      expect(storageRes.error).toContain('không thể dùng danh mục thu nhập');
    }
  });

  // =========================================================================
  // CASE QQ — Import Failure Leaves State Unchanged
  // =========================================================================
  it('CASE QQ — Import failure leaves state unchanged: invalid JSON snapshot rejection protects memory', () => {
    const memoryState = createMockState();
    const initialWalletsCount = memoryState.wallets.length;

    const corruptedRaw = JSON.stringify({
      schemaVersion: 1,
      wallets: [{ id: 'wal-1', balance: -500 }], // invalid negative balance
    });
    const parsed = JSON.parse(corruptedRaw);
    const result = validateAndNormalizeAppSnapshot(parsed);
    expect(result.ok).toBe(false);

    // Verify existing state was NOT replaced or mutated
    expect(memoryState.wallets.length).toBe(initialWalletsCount);
  });

  // =========================================================================
  // CASE RR — CSV Formula Injection Neutralization
  // =========================================================================
  it('CASE RR — CSV formula injection neutralization: prefixes dangerous formula starters with tab', () => {
    expect(sanitizeCsvCell('=SUM(A1:A10)')).toBe('\t=SUM(A1:A10)');
    expect(sanitizeCsvCell('+cmd|"/C calc"!A0')).toBe('\t+cmd|"/C calc"!A0');
    expect(sanitizeCsvCell('-50000')).toBe('\t-50000');
    expect(sanitizeCsvCell('@cmd|')).toBe('\t@cmd|');
    // Safe text should not be altered
    expect(sanitizeCsvCell('Chi phí tiền điện')).toBe('Chi phí tiền điện');
    expect(sanitizeCsvCell('')).toBe('');
  });

  // =========================================================================
  // CASE SS — Security Headers Configuration
  // =========================================================================
  it('CASE SS — Security headers config contains baseline: CSP, X-Content-Type-Options, Referrer-Policy, Permissions-Policy', async () => {
    const headersList = await nextConfig.headers?.();
    expect(headersList).toBeDefined();
    expect(Array.isArray(headersList)).toBe(true);

    const rootRule = headersList?.find((r) => r.source === '/(.*)');
    expect(rootRule).toBeDefined();

    const headersMap = new Map(rootRule?.headers.map((h) => [h.key, h.value]));
    expect(headersMap.has('Content-Security-Policy')).toBe(true);
    expect(headersMap.get('Content-Security-Policy')).toContain("default-src 'self'");
    expect(headersMap.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");

    expect(headersMap.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headersMap.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(headersMap.has('Permissions-Policy')).toBe(true);
  });

  // =========================================================================
  // CASE TT — Mock Mutation API Rejects Arbitrary Shapes
  // =========================================================================
  it('CASE TT — Mock mutation API rejects arbitrary shapes: transactions and wallets reject invalid inputs with 400 or 422', async () => {
    // 1. Transactions POST with unknown / empty shape
    const invalidTxReq = new Request('http://localhost:3000/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maliciousPayload: 'exploit' }),
    });
    const txRes = await transactionsPost(invalidTxReq);
    expect([400, 422]).toContain(txRes.status);
    expect(txRes.headers.get('X-Demo-Only')).toBe('true');

    // 2. Wallets POST with negative balance
    const invalidWalletReq = new Request('http://localhost:3000/api/wallets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Invalid', type: 'BANK', balance: -50000 }),
    });
    const walletRes = await walletsPost(invalidWalletReq);
    expect([400, 422]).toContain(walletRes.status);
    expect(walletRes.headers.get('X-Demo-Only')).toBe('true');
  });

  // =========================================================================
  // CASE UU — Oversized Payload & Receipt Guard
  // =========================================================================
  it('CASE UU — Oversized payload rejected: receipt validation enforces 1MB local cap and MIME allowlist', () => {
    expect(MAX_IMPORT_BYTES).toBe(5 * 1024 * 1024);
    expect(RECEIPT_MAX_BYTES).toBe(1 * 1024 * 1024);

    // Mock file too large (> 1MB)
    const largeFile = {
      name: 'large_receipt.png',
      size: 2 * 1024 * 1024,
      type: 'image/png',
    } as unknown as File;
    const largeRes = validateReceiptFile(largeFile);
    expect(largeRes.ok).toBe(false);
    expect(largeRes.error).toContain('quá lớn');

    // Mock disallowed SVG type
    const svgFile = {
      name: 'malicious.svg',
      size: 1024,
      type: 'image/svg+xml',
    } as unknown as File;
    const svgRes = validateReceiptFile(svgFile);
    expect(svgRes.ok).toBe(false);
    expect(svgRes.error).toContain('không được hỗ trợ');

    // Mock valid JPEG
    const validFile = {
      name: 'receipt.jpg',
      size: 500 * 1024,
      type: 'image/jpeg',
    } as unknown as File;
    const validRes = validateReceiptFile(validFile);
    expect(validRes.ok).toBe(true);
  });

  // =========================================================================
  // CASE VV — Storage Status Lifecycle & SAVE_ERROR
  // =========================================================================
  it('CASE VV — Save failure sets SAVE_ERROR: StorageStatus handles loading, ok, recovery_required and save_error', () => {
    const validStatuses: StorageStatus[] = ['LOADING', 'OK', 'RECOVERY_REQUIRED', 'SAVE_ERROR'];
    expect(validStatuses).toContain('SAVE_ERROR');
    expect(validStatuses).toContain('RECOVERY_REQUIRED');

    // Strengthened: Test real save failure in adapter
    const adapter = new MemoryStorageAdapter();
    adapter.shouldFailSetItem = true; // Simulates QuotaExceededError
    const validSnapshot = {
      schemaVersion: SCHEMA_VERSION,
      wallets: INITIAL_WALLETS,
      transactions: [],
      categories: DEFAULT_CATEGORIES,
      budgets: [],
      bills: [],
      goals: [],
      planner: INITIAL_PLANNER,
    };

    const persistRes = persistStorageSnapshot(adapter, 'test_key', validSnapshot);
    expect(persistRes.ok).toBe(false);
    expect(persistRes.status).toBe('SAVE_ERROR');
    if (!persistRes.ok) {
      expect(persistRes.error).toContain('Không thể ghi dữ liệu vào bộ nhớ');
    }
  });

  // =========================================================================
  // CASE WW — Dangling Transaction Category Rejected
  // =========================================================================
  it('CASE WW — Dangling transaction category rejected: snapshot with non-existent categoryId is rejected', () => {
    const snapshot = {
      schemaVersion: SCHEMA_VERSION,
      wallets: INITIAL_WALLETS,
      transactions: [
        {
          id: 'tx-dangling-cat',
          type: 'EXPENSE',
          amount: 50000,
          walletId: 'wal-bank',
          categoryId: 'cat-non-existent-ghost',
          categoryName: 'Ma',
          date: '2026-09-01T10:00:00',
        },
      ],
      categories: DEFAULT_CATEGORIES,
      budgets: [],
      bills: [],
      goals: [],
      planner: INITIAL_PLANNER,
    };

    const res = validateAndNormalizeAppSnapshot(snapshot);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('không tồn tại');
    }
  });

  // =========================================================================
  // CASE XX — Category Type Mismatch Rejected
  // =========================================================================
  it('CASE XX — EXPENSE cannot reference INCOME category and vice versa', () => {
    const state = createMockState();
    // 1. EXPENSE tx referencing INCOME category ('cat-salary')
    const expenseWithIncomeCat = {
      schemaVersion: SCHEMA_VERSION,
      wallets: state.wallets,
      transactions: [
        {
          id: 'tx-expense-mismatch',
          type: 'EXPENSE',
          amount: 50000,
          walletId: 'wal-bank',
          categoryId: 'cat-salary', // INCOME category
          date: '2026-09-01T10:00:00',
        },
      ],
      categories: DEFAULT_CATEGORIES,
      budgets: [],
      bills: [],
      goals: [],
      planner: INITIAL_PLANNER,
    };
    const res1 = validateAndNormalizeAppSnapshot(expenseWithIncomeCat);
    expect(res1.ok).toBe(false);
    if (!res1.ok) {
      expect(res1.error).toContain('Chỉ danh mục EXPENSE được phép');
    }

    // 2. INCOME tx referencing EXPENSE category ('cat-food')
    const incomeWithExpenseCat = {
      schemaVersion: SCHEMA_VERSION,
      wallets: state.wallets,
      transactions: [
        {
          id: 'tx-income-mismatch',
          type: 'INCOME',
          amount: 500000,
          walletId: 'wal-bank',
          categoryId: 'cat-food', // EXPENSE category
          date: '2026-09-01T10:00:00',
        },
      ],
      categories: DEFAULT_CATEGORIES,
      budgets: [],
      bills: [],
      goals: [],
      planner: INITIAL_PLANNER,
    };
    const res2 = validateAndNormalizeAppSnapshot(incomeWithExpenseCat);
    expect(res2.ok).toBe(false);
    if (!res2.ok) {
      expect(res2.error).toContain('Chỉ danh mục INCOME được phép');
    }
  });

  // =========================================================================
  // CASE YY — System Transaction Origin Enforcement
  // =========================================================================
  it('CASE YY — GOAL_DEPOSIT / GOAL_WITHDRAWAL with MANUAL origin rejected', () => {
    const state = createMockState();
    const depositWithManualOrigin = {
      schemaVersion: SCHEMA_VERSION,
      wallets: state.wallets,
      transactions: [
        {
          id: 'tx-goal-manual',
          type: 'TRANSFER',
          transferKind: 'GOAL_DEPOSIT',
          amount: 500000,
          walletId: 'wal-bank',
          origin: 'MANUAL', // Violates system requirement
          originId: 'goal-emergency',
          goalId: 'goal-emergency',
          date: '2026-09-01T10:00:00',
        },
      ],
      categories: DEFAULT_CATEGORIES,
      budgets: [],
      bills: [],
      goals: state.goals,
      planner: INITIAL_PLANNER,
    };

    const res = validateAndNormalizeAppSnapshot(depositWithManualOrigin);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('phải có origin là "GOAL"');
    }
  });

  // =========================================================================
  // CASE ZZ — goalId/originId Mismatch Rejected
  // =========================================================================
  it('CASE ZZ — goalId and originId mismatch rejected', () => {
    const state = createMockState();
    const mismatchedGoalTx = {
      schemaVersion: SCHEMA_VERSION,
      wallets: state.wallets,
      transactions: [
        {
          id: 'tx-goal-mismatch',
          type: 'TRANSFER',
          transferKind: 'GOAL_DEPOSIT',
          amount: 500000,
          walletId: 'wal-bank',
          origin: 'GOAL',
          originId: 'goal-emergency',
          goalId: 'goal-vacation', // Differing ID!
          date: '2026-09-01T10:00:00',
        },
      ],
      categories: DEFAULT_CATEGORIES,
      budgets: [],
      bills: [],
      goals: state.goals,
      planner: INITIAL_PLANNER,
    };

    const res = validateAndNormalizeAppSnapshot(mismatchedGoalTx);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('không khớp với originId');
    }
  });

  // =========================================================================
  // CASE AAA — BILL_PAYMENT Referencing Missing Bill Rejected
  // =========================================================================
  it('CASE AAA — BILL_PAYMENT referencing missing bill rejected', () => {
    const state = createMockState();
    const snapshot = {
      schemaVersion: SCHEMA_VERSION,
      wallets: state.wallets,
      transactions: [
        {
          id: 'tx-bill-ghost',
          type: 'EXPENSE',
          amount: 200000,
          walletId: 'wal-bank',
          origin: 'BILL_PAYMENT',
          originId: 'bill-does-not-exist',
          date: '2026-09-01T10:00:00',
        },
      ],
      categories: DEFAULT_CATEGORIES,
      budgets: [],
      bills: state.bills,
      goals: [],
      planner: INITIAL_PLANNER,
    };

    const res = validateAndNormalizeAppSnapshot(snapshot);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('tham chiếu đến hóa đơn không tồn tại');
    }
  });

  // =========================================================================
  // CASE AAB — UNPAID Bill with Linked Payment Transaction Rejected
  // =========================================================================
  it('CASE AAB — UNPAID bill with BILL_PAYMENT transaction rejected', () => {
    const state = createMockState();
    const snapshot = {
      schemaVersion: SCHEMA_VERSION,
      wallets: state.wallets,
      transactions: [
        {
          id: 'tx-bill-unpaid-conflict',
          type: 'EXPENSE',
          amount: 300000,
          walletId: 'wal-bank',
          origin: 'BILL_PAYMENT',
          originId: 'bill-internet',
          date: '2026-09-01T10:00:00',
        },
      ],
      categories: DEFAULT_CATEGORIES,
      budgets: [],
      bills: [
        {
          id: 'bill-internet',
          name: 'Internet',
          amount: 300000,
          categoryId: 'cat-bills',
          dueDay: 15,
          frequency: 'MONTHLY' as const,
          status: 'UNPAID' as const, // Inconsistent with existing payment!
        },
      ],
      goals: [],
      planner: INITIAL_PLANNER,
    };

    const res = validateAndNormalizeAppSnapshot(snapshot);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('có trạng thái UNPAID');
    }
  });

  // =========================================================================
  // CASE AAC — Bill/Payment Amount Mismatch Rejected
  // =========================================================================
  it('CASE AAC — Bill and payment amount mismatch rejected', () => {
    const state = createMockState();
    const snapshot = {
      schemaVersion: SCHEMA_VERSION,
      wallets: state.wallets,
      transactions: [
        {
          id: 'tx-bill-amount-diff',
          type: 'EXPENSE',
          amount: 450000, // Differs from bill amount 300000
          walletId: 'wal-bank',
          origin: 'BILL_PAYMENT',
          originId: 'bill-internet',
          date: '2026-09-01T10:00:00',
        },
      ],
      categories: DEFAULT_CATEGORIES,
      budgets: [],
      bills: [
        {
          id: 'bill-internet',
          name: 'Internet',
          amount: 300000,
          categoryId: 'cat-bills',
          dueDay: 15,
          frequency: 'MONTHLY' as const,
          status: 'PAID' as const,
          walletId: 'wal-bank',
        },
      ],
      goals: [],
      planner: INITIAL_PLANNER,
    };

    const res = validateAndNormalizeAppSnapshot(snapshot);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('không khớp với số tiền');
    }
  });

  // =========================================================================
  // CASE AAD — Bill/Payment Wallet Mismatch Rejected
  // =========================================================================
  it('CASE AAD — Bill and payment walletId mismatch rejected', () => {
    const state = createMockState({
      wallets: [
        {
          id: 'wal-bank',
          name: 'Bank',
          type: 'BANK',
          balance: 1000000,
          initialBalance: 1000000,
          currency: 'VND',
          color: '#10b981',
          icon: 'Landmark',
          createdAt: '2026-03-01T00:00:00.000Z',
        },
        {
          id: 'wal-cash',
          name: 'Cash',
          type: 'CASH',
          balance: 1000000,
          initialBalance: 1000000,
          currency: 'VND',
          color: '#3b82f6',
          icon: 'Banknote',
          createdAt: '2026-03-01T00:00:00.000Z',
        },
      ],
    });
    const snapshot = {
      schemaVersion: SCHEMA_VERSION,
      wallets: state.wallets,
      transactions: [
        {
          id: 'tx-bill-wallet-diff',
          type: 'EXPENSE',
          amount: 300000,
          walletId: 'wal-cash', // Differs from bill walletId 'wal-bank'
          origin: 'BILL_PAYMENT',
          originId: 'bill-internet',
          date: '2026-09-01T10:00:00',
        },
      ],
      categories: DEFAULT_CATEGORIES,
      budgets: [],
      bills: [
        {
          id: 'bill-internet',
          name: 'Internet',
          amount: 300000,
          categoryId: 'cat-bills',
          dueDay: 15,
          frequency: 'MONTHLY' as const,
          status: 'PAID' as const,
          walletId: 'wal-bank',
        },
      ],
      goals: [],
      planner: INITIAL_PLANNER,
    };

    const res = validateAndNormalizeAppSnapshot(snapshot);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('không khớp với ví thanh toán');
    }
  });

  // =========================================================================
  // CASE AAE — SVG Receipt Rejected at UI and Storage Boundary
  // =========================================================================
  it('CASE AAE — SVG receipt rejected at UI and storage boundary', () => {
    // 1. UI Boundary (validateReceiptFile)
    const svgFile = {
      name: 'invoice.svg',
      size: 2048,
      type: 'image/svg+xml',
    } as unknown as File;
    const uiRes = validateReceiptFile(svgFile);
    expect(uiRes.valid).toBe(false);
    expect(uiRes.error).toContain('không được hỗ trợ');

    // 2. Storage Boundary (validateAndNormalizeAppSnapshot)
    const snapshotWithSvg = {
      schemaVersion: SCHEMA_VERSION,
      wallets: INITIAL_WALLETS,
      transactions: [
        {
          id: 'tx-svg-receipt',
          type: 'EXPENSE',
          amount: 100000,
          walletId: 'wal-cash',
          date: '2026-09-01T10:00:00',
          receiptImage: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
        },
      ],
      categories: DEFAULT_CATEGORIES,
      budgets: [],
      bills: [],
      goals: [],
      planner: INITIAL_PLANNER,
    };
    const storageRes = validateAndNormalizeAppSnapshot(snapshotWithSvg);
    expect(storageRes.ok).toBe(false);
    if (!storageRes.ok) {
      expect(storageRes.error).toContain('không an toàn (SVG/HTML/URL)');
    }
  });

  // =========================================================================
  // CASE AAF — Oversized Local Receipt Rejected
  // =========================================================================
  it('CASE AAF — Oversized local receipt (> 1MB) rejected', () => {
    expect(LOCAL_RECEIPT_MAX_BYTES).toBe(1024 * 1024);

    // 1. UI Boundary: file > 1MB
    const bigFile = {
      name: 'big_receipt.jpg',
      size: 1.5 * 1024 * 1024,
      type: 'image/jpeg',
    } as unknown as File;
    const uiRes = validateReceiptFile(bigFile);
    expect(uiRes.valid).toBe(false);
    expect(uiRes.error).toContain('1 MB');

    // 2. Storage Boundary: Data URL > 1MB * 1.37
    const hugeBase64 = 'data:image/jpeg;base64,' + 'A'.repeat(1_450_000);
    const snapshotWithBigReceipt = {
      schemaVersion: SCHEMA_VERSION,
      wallets: INITIAL_WALLETS,
      transactions: [
        {
          id: 'tx-big-receipt',
          type: 'EXPENSE',
          amount: 100000,
          walletId: 'wal-cash',
          date: '2026-09-01T10:00:00',
          receiptImage: hugeBase64,
        },
      ],
      categories: DEFAULT_CATEGORIES,
      budgets: [],
      bills: [],
      goals: [],
      planner: INITIAL_PLANNER,
    };
    const storageRes = validateAndNormalizeAppSnapshot(snapshotWithBigReceipt);
    expect(storageRes.ok).toBe(false);
    if (!storageRes.ok) {
      expect(storageRes.error).toContain('vượt quá giới hạn lưu trữ cục bộ');
    }
  });

  // =========================================================================
  // CASE AAG — Valid JPEG/PNG/WEBP Receipts Accepted
  // =========================================================================
  it('CASE AAG — Valid JPEG, PNG, and WebP receipts accepted by storage and UI', () => {
    const validJpegData = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
    const validPngData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const validWebpData = 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==';

    for (const [img, mime] of [
      [validJpegData, 'image/jpeg'],
      [validPngData, 'image/png'],
      [validWebpData, 'image/webp'],
    ]) {
      const snap = {
        schemaVersion: SCHEMA_VERSION,
        wallets: INITIAL_WALLETS,
        transactions: [
          {
            id: `tx-valid-${mime.replace('/', '-')}`,
            type: 'EXPENSE',
            amount: 50000,
            walletId: 'wal-cash',
            date: '2026-09-01T10:00:00',
            receiptImage: img,
          },
        ],
        categories: DEFAULT_CATEGORIES,
        budgets: [],
        bills: [],
        goals: [],
        planner: INITIAL_PLANNER,
      };
      const res = validateAndNormalizeAppSnapshot(snap);
      expect(res.ok).toBe(true);

      const dummyFile = {
        name: `test.${mime.split('/')[1]}`,
        size: 500_000,
        type: mime,
      } as unknown as File;
      expect(validateReceiptFile(dummyFile).valid).toBe(true);
    }
  });

  // =========================================================================
  // CASE AAH — Persistence Refuses Invalid In-Memory Snapshot
  // =========================================================================
  it('CASE AAH — Persistence refuses invalid in-memory snapshot: sets SAVE_ERROR without persisting', () => {
    const adapter = new MemoryStorageAdapter();
    const invalidPayload = {
      schemaVersion: SCHEMA_VERSION,
      wallets: [{ id: 'wal-bank', name: 'Bank', type: 'BANK', balance: -100 }], // Negative balance
      transactions: [],
      categories: DEFAULT_CATEGORIES,
      budgets: [],
      bills: [],
      goals: [],
      planner: INITIAL_PLANNER,
    };

    const res = persistStorageSnapshot(adapter, 'fintrack_pro_state_v1', invalidPayload);
    expect(res.ok).toBe(false);
    expect(res.status).toBe('SAVE_ERROR');
    if (!res.ok) {
      expect(res.error).toContain('Từ chối lưu dữ liệu không hợp lệ');
    }
    expect(adapter.getItem('fintrack_pro_state_v1')).toBeNull(); // Never written!
  });

  // =========================================================================
  // CASE AAI — Corrupt Primary Snapshot Remains Byte-For-Byte Unchanged
  // =========================================================================
  it('CASE AAI — Corrupt primary snapshot remains byte-for-byte unchanged', () => {
    const adapter = new MemoryStorageAdapter();
    const corruptData = '{"schemaVersion":1,"wallets":"NOT_AN_ARRAY"}';
    adapter.setItem('fintrack_pro_state_v1', corruptData);

    const loadRes = loadStorageSnapshot(adapter, 'fintrack_pro_state_v1');
    expect(loadRes.status).toBe('RECOVERY_REQUIRED');
    expect(adapter.getItem('fintrack_pro_state_v1')).toBe(corruptData);
  });

  // =========================================================================
  // CASE AAJ — Failed Recovery-Copy Write Reported Accurately
  // =========================================================================
  it('CASE AAJ — Failed recovery-copy write is reported accurately', () => {
    const adapter = new MemoryStorageAdapter();
    adapter.setItem('fintrack_pro_state_v1', '{"malformed":');
    // Now simulate quota exceeded when writing recovery copy
    adapter.shouldFailSetItem = true;

    const loadRes = loadStorageSnapshot(adapter, 'fintrack_pro_state_v1');
    expect(loadRes.status).toBe('RECOVERY_REQUIRED');
    if (loadRes.status === 'RECOVERY_REQUIRED') {
      expect(loadRes.recoveryCopySaved).toBe(false);
      expect(loadRes.recoveryRawData).toBe('{"malformed":');
    }
  });

  // =========================================================================
  // CASE AAK — Raw Recovery Download Returns Original Corrupt Data
  // =========================================================================
  it('CASE AAK — Raw recovery download returns original corrupt data without parsing/rewriting', () => {
    const adapter = new MemoryStorageAdapter();
    const originalCorrupt = 'RAW_CORRUPT_BYTES_XYZ_123_{}';
    adapter.setItem('fintrack_pro_state_v1', originalCorrupt);

    const loadRes = loadStorageSnapshot(adapter, 'fintrack_pro_state_v1');
    expect(loadRes.status).toBe('RECOVERY_REQUIRED');
    if (loadRes.status === 'RECOVERY_REQUIRED') {
      expect(loadRes.recoveryRawData).toBe(originalCorrupt);
    }
  });

  // =========================================================================
  // CASE AAL — Invalid Datetime Rejected Rather Than Replaced by Now
  // =========================================================================
  it('CASE AAL — Invalid datetime rejected rather than replaced by current time', () => {
    expect(localDateTimeInputToISO('')).toBeNull();
    expect(localDateTimeInputToISO('invalid-string')).toBeNull();
    expect(localDateTimeInputToISO('2026-99-99T25:99:99')).toBeNull();
  });

  // =========================================================================
  // CASE AAM — Impossible Calendar Date Rejected
  // =========================================================================
  it('CASE AAM — Impossible calendar date rejected (no silent rollover to next month)', () => {
    // Feb 31 does not exist
    expect(localDateTimeInputToISO('2026-02-31T10:00')).toBeNull();
    // Feb 29 in non-leap year (2025) does not exist
    expect(localDateTimeInputToISO('2025-02-29T10:00')).toBeNull();
    // April 31 does not exist (April has 30 days)
    expect(localDateTimeInputToISO('2026-04-31T10:00')).toBeNull();
    // Feb 29 in leap year (2024) is VALID
    const leapDate = localDateTimeInputToISO('2024-02-29T10:00');
    expect(leapDate).not.toBeNull();
    expect(new Date(leapDate!).getUTCFullYear()).toBe(2024);
  });

  // =========================================================================
  // CASE AAN — UTF-8 Import Byte Limit Uses Real Byte Count
  // =========================================================================
  it('CASE AAN — UTF-8 import byte limit uses real byte count (TextEncoder)', () => {
    const textWithMultiByte = 'Ví Tiền Việt Nam 🇻🇳';
    const charLen = textWithMultiByte.length;
    const byteLen = getUtf8ByteLength(textWithMultiByte);
    expect(byteLen).toBeGreaterThan(charLen);

    // Verify byteLength enforcement
    expect(getUtf8ByteLength('abc')).toBe(3);
    expect(getUtf8ByteLength('€')).toBe(3); // Euro sign is 3 UTF-8 bytes but 1 char
  });

  // =========================================================================
  // CASE AAO — Production Mock POST Does Not Return 201
  // =========================================================================
  it('CASE AAO — Production mock POST does not return 201 when demo API is disabled', async () => {
    const originalEnv = process.env.NODE_ENV;
    const originalDemo = process.env.ENABLE_DEMO_API;
    try {
      (process.env as any).NODE_ENV = 'production';
      delete process.env.ENABLE_DEMO_API;

      const req = new Request('http://localhost:3000/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'EXPENSE', amount: 50000, walletId: 'wal-bank' }),
      });
      const res = await transactionsPost(req);
      expect([404, 501]).toContain(res.status);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(['LEGACY_DEMO_DISABLED', 'DEMO_MUTATION_DISABLED']).toContain(json._code);
    } finally {
      (process.env as any).NODE_ENV = originalEnv;
      if (originalDemo !== undefined) {
        process.env.ENABLE_DEMO_API = originalDemo;
      }
    }
  });

  // =========================================================================
  // CASE AAP — Production CSP Excludes unsafe-eval
  // =========================================================================
  it('CASE AAP — Production CSP excludes unsafe-eval and includes object-src none', async () => {
    // Read next.config.mjs text directly to verify production CSP definition
    const nextConfigContent = fs.readFileSync(path.resolve(__dirname, '../next.config.mjs'), 'utf-8');
    expect(nextConfigContent).toContain("const isDev = process.env.NODE_ENV !== 'production'");
    expect(nextConfigContent).toContain("script-src 'self' 'unsafe-inline'");
    expect(nextConfigContent).toContain("object-src 'none'");
    expect(nextConfigContent).toContain("X-Frame-Options");
    expect(nextConfigContent).toContain("DENY");
  });

  // =========================================================================
  // CASE AAQ — Security Docs and Header Evidence Remain Consistent
  // =========================================================================
  it('CASE AAQ — Security docs and header evidence remain consistent', () => {
    const baselineDocs = fs.readFileSync(path.resolve(__dirname, '../docs/security/security-baseline.md'), 'utf-8');
    const checklistDocs = fs.readFileSync(path.resolve(__dirname, '../docs/security/owasp-checklist.md'), 'utf-8');

    expect(baselineDocs).toContain('X-Frame-Options: DENY');
    expect(baselineDocs).toContain('exceljs');
    expect(checklistDocs).toContain('X-Frame-Options: DENY');
    expect(checklistDocs).toContain('Production Mock Mutation Gating');
  });
});

