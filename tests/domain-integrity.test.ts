import { describe, it, expect } from 'vitest';
import {
  calculateFinancialSummary,
  applyAddTransaction,
  applyEditTransaction,
  applyDeleteTransaction,
  applyGoalDeposit,
  applyGoalWithdraw,
  applyDeleteGoal,
  applyPayBill,
  applyUnpayBill,
  applyDeleteWallet,
  applyEditWallet,
  validateTransferFee,
  AppDomainState,
} from '../src/lib/domain-engine';
import { Wallet, SavingsGoal, RecurringBill } from '../src/types';

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
});
