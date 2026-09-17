import { Wallet, Transaction, RecurringBill, SavingsGoal, FinancialSummary, TransactionOrigin, TransferKind } from '@/types';
import { getCurrentYearMonth } from './utils';

export interface AppDomainState {
  wallets: Wallet[];
  transactions: Transaction[];
  goals: SavingsGoal[];
  bills: RecurringBill[];
}

export type DomainResult<T = { state: AppDomainState }> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

/**
 * Validate transfer fee: must be a finite non-negative number.
 * Reject NaN, Infinity, negative values.
 */
export function validateTransferFee(fee: unknown): { valid: boolean; fee: number; error?: string } {
  if (fee === undefined || fee === null || fee === '') {
    return { valid: true, fee: 0 };
  }
  if (typeof fee !== 'number' || isNaN(fee) || !isFinite(fee) || fee < 0) {
    return { valid: false, fee: 0, error: 'Phí chuyển khoản không hợp lệ (phải là số hữu hạn >= 0)' };
  }
  return { valid: true, fee };
}

/**
 * Calculate financial summary accounting for:
 * - Cash + Bank in availableBalance
 * - Savings wallets in walletSavings
 * - Savings goals in goalSavings (SAVINGS GOALS ARE ASSETS!)
 * - Credit card debt in totalCreditDebt
 * - Net assets (totalAssets) = availableBalance + walletSavings + goalSavings - totalCreditDebt
 * - Transfer principal is NOT income or expense.
 * - Transfer fees ARE financial expenses.
 */
export function calculateFinancialSummary(
  wallets: Wallet[],
  transactions: Transaction[],
  monthStr: string = getCurrentYearMonth(),
  goals: SavingsGoal[] = []
): FinancialSummary {
  // Available balance: Cash + Bank
  const availableBalance = wallets
    .filter((w) => w.type === 'CASH' || w.type === 'BANK')
    .reduce((sum, w) => sum + (w.balance || 0), 0);

  // Credit Card debt
  const totalCreditDebt = wallets
    .filter((w) => w.type === 'CREDIT')
    .reduce((sum, w) => sum + (w.balance || 0), 0);

  // Savings in wallets
  const walletSavings = wallets
    .filter((w) => w.type === 'SAVINGS')
    .reduce((sum, w) => sum + (w.balance || 0), 0);

  // Savings in goals
  const goalSavings = goals.reduce((sum, g) => sum + (g.currentAmount || 0), 0);

  // Total savings
  const totalSavings = walletSavings + goalSavings;

  // Net assets = Tiền mặt + Ngân hàng + Tiết kiệm (ví + mục tiêu) - Dư nợ thẻ tín dụng
  const totalAssets = availableBalance + totalSavings - totalCreditDebt;

  // Monthly transactions
  const currentMonthTxs = transactions.filter((t) => t.date && t.date.startsWith(monthStr));

  const monthlyIncome = currentMonthTxs
    .filter((t) => t.type === 'INCOME')
    .reduce((sum, t) => sum + t.amount, 0);

  const expenseTxsAmount = currentMonthTxs
    .filter((t) => t.type === 'EXPENSE')
    .reduce((sum, t) => sum + t.amount, 0);

  const transferFees = currentMonthTxs
    .filter((t) => t.type === 'TRANSFER' && typeof t.fee === 'number' && isFinite(t.fee) && t.fee > 0)
    .reduce((sum, t) => sum + (t.fee || 0), 0);

  const monthlyExpense = expenseTxsAmount + transferFees;

  const netSavingsThisMonth = monthlyIncome - monthlyExpense;
  const savingsRate = monthlyIncome > 0 ? Math.max(0, Math.round((netSavingsThisMonth / monthlyIncome) * 100)) : 0;

  return {
    totalAssets,
    availableBalance,
    totalCreditDebt,
    walletSavings,
    goalSavings,
    totalSavings,
    monthlyIncome,
    monthlyExpense,
    netSavingsThisMonth,
    savingsRate,
  };
}

/**
 * Add a new transaction with domain validations.
 */
export function applyAddTransaction(
  state: AppDomainState,
  txInput: Omit<Transaction, 'id' | 'createdAt'>
): DomainResult<{ state: AppDomainState; newTx: Transaction }> {
  // Validate amount
  if (typeof txInput.amount !== 'number' || isNaN(txInput.amount) || !isFinite(txInput.amount) || txInput.amount <= 0) {
    return { ok: false, error: 'Số tiền giao dịch không hợp lệ (phải là số hữu hạn > 0)' };
  }

  // Validate source wallet
  const sourceWallet = state.wallets.find((w) => w.id === txInput.walletId);
  if (!sourceWallet) {
    return { ok: false, error: 'Ví nguồn không tồn tại' };
  }

  let normalizedFee = 0;
  if (txInput.type === 'TRANSFER') {
    const feeCheck = validateTransferFee(txInput.fee);
    if (!feeCheck.valid) {
      return { ok: false, error: feeCheck.error || 'Phí chuyển khoản không hợp lệ' };
    }
    normalizedFee = feeCheck.fee;
  }

  const updatedWallets = state.wallets.map((w) => ({ ...w }));
  const targetSource = updatedWallets.find((w) => w.id === txInput.walletId)!;

  let transferKind: TransferKind | undefined = txInput.transferKind;

  if (txInput.type === 'EXPENSE') {
    if (targetSource.type === 'CREDIT') {
      // Credit card expense increases debt
      const newDebt = targetSource.balance + txInput.amount;
      if (targetSource.creditLimit !== undefined && targetSource.creditLimit > 0 && newDebt > targetSource.creditLimit) {
        return { ok: false, error: 'Giao dịch chi tiêu vượt quá hạn mức thẻ tín dụng khả dụng' };
      }
      targetSource.balance = newDebt;
    } else {
      // Normal asset wallet
      if (targetSource.balance < txInput.amount) {
        return { ok: false, error: `Số dư ví "${targetSource.name}" không đủ để thực hiện chi tiêu` };
      }
      targetSource.balance -= txInput.amount;
    }
  } else if (txInput.type === 'INCOME') {
    if (targetSource.type === 'CREDIT') {
      return {
        ok: false,
        error: 'Không hỗ trợ ghi nhận thu nhập trực tiếp vào thẻ tín dụng. Để trả nợ thẻ, vui lòng sử dụng tính năng Chuyển khoản (Thanh toán thẻ tín dụng) từ ví thanh toán/ngân hàng.',
      };
    }
    targetSource.balance += txInput.amount;
  } else if (txInput.type === 'TRANSFER') {
    if (!txInput.toWalletId || txInput.toWalletId === txInput.walletId) {
      return { ok: false, error: 'Ví nhận phải khác ví chuyển' };
    }
    const targetDest = updatedWallets.find((w) => w.id === txInput.toWalletId);
    if (!targetDest) {
      return { ok: false, error: 'Ví đích không tồn tại' };
    }

    if (targetSource.type === 'CREDIT') {
      return { ok: false, error: 'Không hỗ trợ rút tiền mặt hoặc chuyển tiền từ thẻ tín dụng (Cash advance)' };
    }

    if (targetDest.type === 'CREDIT') {
      // Normal wallet -> CREDIT: Repayment
      transferKind = 'CREDIT_PAYMENT';
      if (targetSource.balance < txInput.amount + normalizedFee) {
        return { ok: false, error: 'Số dư ví nguồn không đủ để thanh toán dư nợ thẻ' };
      }
      if (txInput.amount > targetDest.balance) {
        return { ok: false, error: 'Số tiền thanh toán vượt quá dư nợ hiện tại của thẻ tín dụng' };
      }
      targetSource.balance -= (txInput.amount + normalizedFee);
      targetDest.balance -= txInput.amount;
    } else {
      // Normal wallet -> Normal wallet
      transferKind = transferKind || 'WALLET_TRANSFER';
      if (targetSource.balance < txInput.amount + normalizedFee) {
        return { ok: false, error: 'Số dư ví nguồn không đủ để thực hiện chuyển khoản' };
      }
      targetSource.balance -= (txInput.amount + normalizedFee);
      targetDest.balance += txInput.amount;
    }
  }

  const id = `tx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const createdAt = new Date().toISOString();
  const newTx: Transaction = {
    ...txInput,
    fee: normalizedFee,
    transferKind,
    origin: txInput.origin || 'MANUAL',
    id,
    createdAt,
  };

  return {
    ok: true,
    state: {
      ...state,
      wallets: updatedWallets,
      transactions: [newTx, ...state.transactions],
    },
    newTx,
  };
}

/**
 * Edit an existing transaction safely.
 * Disallows generic edit of system-generated transactions (origin === 'GOAL' | 'BILL_PAYMENT').
 * Validates resulting wallet balances before committing.
 */
export function applyEditTransaction(
  state: AppDomainState,
  id: string,
  updated: Partial<Transaction>
): DomainResult<{ state: AppDomainState; updatedTx: Transaction }> {
  const oldTx = state.transactions.find((t) => t.id === id);
  if (!oldTx) {
    return { ok: false, error: 'Không tìm thấy giao dịch để chỉnh sửa' };
  }

  // System-managed transactions cannot be generically edited
  if (oldTx.origin === 'GOAL' || oldTx.origin === 'BILL_PAYMENT') {
    return {
      ok: false,
      error: 'Không thể chỉnh sửa trực tiếp giao dịch tự động của hệ thống (Hũ tích lũy / Hóa đơn). Vui lòng thao tác từ mục tương ứng.',
    };
  }

  if (updated.amount !== undefined) {
    if (typeof updated.amount !== 'number' || isNaN(updated.amount) || !isFinite(updated.amount) || updated.amount <= 0) {
      return { ok: false, error: 'Số tiền giao dịch không hợp lệ' };
    }
  }

  const newTxCandidate: Transaction = { ...oldTx, ...updated };

  if (newTxCandidate.type === 'TRANSFER') {
    if (!newTxCandidate.toWalletId || newTxCandidate.toWalletId === newTxCandidate.walletId) {
      return { ok: false, error: 'Ví nhận phải khác ví chuyển' };
    }
    const feeCheck = validateTransferFee(newTxCandidate.fee);
    if (!feeCheck.valid) {
      return { ok: false, error: feeCheck.error || 'Phí chuyển khoản không hợp lệ' };
    }
    newTxCandidate.fee = feeCheck.fee;
  } else {
    newTxCandidate.fee = 0;
  }

  // Simulate rolling back oldTx and applying newTx
  const simulatedWallets = state.wallets.map((w) => ({ ...w }));

  // 1. Rollback oldTx
  const oldSource = simulatedWallets.find((w) => w.id === oldTx.walletId);
  if (!oldSource) {
    return { ok: false, error: 'Không tìm thấy ví nguồn của giao dịch cũ' };
  }

  if (oldTx.type === 'EXPENSE') {
    if (oldSource.type === 'CREDIT') {
      oldSource.balance -= oldTx.amount;
    } else {
      oldSource.balance += oldTx.amount;
    }
  } else if (oldTx.type === 'INCOME') {
    if (oldSource.type === 'CREDIT') {
      oldSource.balance += oldTx.amount;
    } else {
      oldSource.balance -= oldTx.amount;
    }
  } else if (oldTx.type === 'TRANSFER') {
    const oldDest = simulatedWallets.find((w) => w.id === oldTx.toWalletId);
    if (!oldDest) {
      return { ok: false, error: 'Không tìm thấy ví đích của giao dịch chuyển khoản cũ' };
    }
    const oldFee = typeof oldTx.fee === 'number' && isFinite(oldTx.fee) ? oldTx.fee : 0;
    oldSource.balance += (oldTx.amount + oldFee);
    if (oldDest.type === 'CREDIT') {
      oldDest.balance += oldTx.amount; // rollback repayment restores debt
    } else {
      oldDest.balance -= oldTx.amount;
    }
  }

  // 2. Apply newTx
  const newSource = simulatedWallets.find((w) => w.id === newTxCandidate.walletId);
  if (!newSource) {
    return { ok: false, error: 'Không tìm thấy ví nguồn mới' };
  }

  if (newTxCandidate.type === 'EXPENSE') {
    if (newSource.type === 'CREDIT') {
      newSource.balance += newTxCandidate.amount;
    } else {
      newSource.balance -= newTxCandidate.amount;
    }
  } else if (newTxCandidate.type === 'INCOME') {
    if (newSource.type === 'CREDIT') {
      return {
        ok: false,
        error: 'Không hỗ trợ ghi nhận thu nhập trực tiếp vào thẻ tín dụng. Để trả nợ thẻ, vui lòng sử dụng tính năng Chuyển khoản (Thanh toán thẻ tín dụng) từ ví thanh toán/ngân hàng.',
      };
    }
    newSource.balance += newTxCandidate.amount;
  } else if (newTxCandidate.type === 'TRANSFER') {
    const newDest = simulatedWallets.find((w) => w.id === newTxCandidate.toWalletId);
    if (!newDest) {
      return { ok: false, error: 'Không tìm thấy ví đích mới' };
    }
    if (newSource.type === 'CREDIT') {
      return { ok: false, error: 'Không hỗ trợ chuyển khoản từ thẻ tín dụng' };
    }
    const fee = newTxCandidate.fee || 0;
    if (newDest.type === 'CREDIT') {
      if (newTxCandidate.amount > newDest.balance) {
        return { ok: false, error: 'Số tiền thanh toán vượt quá dư nợ thẻ tín dụng' };
      }
      newSource.balance -= (newTxCandidate.amount + fee);
      newDest.balance -= newTxCandidate.amount;
    } else {
      newSource.balance -= (newTxCandidate.amount + fee);
      newDest.balance += newTxCandidate.amount;
    }
  }

  // 3. Validate all resulting balances
  for (const w of simulatedWallets) {
    if (w.type === 'CREDIT') {
      if (w.balance < 0) {
        return { ok: false, error: `Dư nợ thẻ tín dụng "${w.name}" không thể nhỏ hơn 0` };
      }
      if (w.creditLimit !== undefined && w.creditLimit > 0 && w.balance > w.creditLimit) {
        return { ok: false, error: `Dư nợ thẻ tín dụng "${w.name}" vượt quá hạn mức cho phép` };
      }
    } else {
      if (w.balance < 0) {
        return { ok: false, error: `Số dư ví "${w.name}" không đủ (sẽ bị âm: ${w.balance.toLocaleString('vi-VN')} ₫)` };
      }
    }
  }

  return {
    ok: true,
    state: {
      ...state,
      wallets: simulatedWallets,
      transactions: state.transactions.map((t) => (t.id === id ? newTxCandidate : t)),
    },
    updatedTx: newTxCandidate,
  };
}

/**
 * Delete a transaction safely.
 * Disallows generic deletion of system-generated transactions (origin === 'GOAL' | 'BILL_PAYMENT').
 * Validates that rolling back doesn't cause impossible negative balances.
 */
export function applyDeleteTransaction(
  state: AppDomainState,
  id: string
): DomainResult<{ state: AppDomainState; deletedTx: Transaction }> {
  const oldTx = state.transactions.find((t) => t.id === id);
  if (!oldTx) {
    return { ok: false, error: 'Không tìm thấy giao dịch cần xóa' };
  }

  // Disallow generic deletion of system-generated transactions
  if (oldTx.origin === 'GOAL' || oldTx.origin === 'BILL_PAYMENT') {
    return {
      ok: false,
      error: 'Không thể xóa trực tiếp giao dịch tự động của hệ thống (Hũ tích lũy / Hóa đơn). Vui lòng thao tác từ mục tương ứng.',
    };
  }

  const simulatedWallets = state.wallets.map((w) => ({ ...w }));
  const sourceWallet = simulatedWallets.find((w) => w.id === oldTx.walletId);
  if (!sourceWallet) {
    return { ok: false, error: 'Không tìm thấy ví của giao dịch cần xóa' };
  }

  if (oldTx.type === 'EXPENSE') {
    if (sourceWallet.type === 'CREDIT') {
      sourceWallet.balance -= oldTx.amount;
    } else {
      sourceWallet.balance += oldTx.amount;
    }
  } else if (oldTx.type === 'INCOME') {
    if (sourceWallet.type === 'CREDIT') {
      sourceWallet.balance += oldTx.amount;
    } else {
      sourceWallet.balance -= oldTx.amount;
    }
  } else if (oldTx.type === 'TRANSFER') {
    const destWallet = simulatedWallets.find((w) => w.id === oldTx.toWalletId);
    if (!destWallet) {
      return { ok: false, error: 'Không tìm thấy ví đích của giao dịch chuyển khoản' };
    }
    const fee = typeof oldTx.fee === 'number' && isFinite(oldTx.fee) ? oldTx.fee : 0;
    sourceWallet.balance += (oldTx.amount + fee);
    if (destWallet.type === 'CREDIT') {
      destWallet.balance += oldTx.amount;
    } else {
      destWallet.balance -= oldTx.amount;
    }
  }

  // Validate all resulting balances
  for (const w of simulatedWallets) {
    if (w.type === 'CREDIT') {
      if (w.balance < 0) {
        return { ok: false, error: `Hoàn tác giao dịch khiến dư nợ thẻ "${w.name}" bị âm` };
      }
      if (w.creditLimit !== undefined && w.creditLimit > 0 && w.balance > w.creditLimit) {
        return { ok: false, error: `Hoàn tác giao dịch khiến dư nợ thẻ "${w.name}" vượt hạn mức` };
      }
    } else {
      if (w.balance < 0) {
        return { ok: false, error: `Không thể xóa giao dịch vì số dư ví "${w.name}" hiện tại không đủ để hoàn tác (sẽ bị âm: ${w.balance.toLocaleString('vi-VN')} ₫)` };
      }
    }
  }

  return {
    ok: true,
    state: {
      ...state,
      wallets: simulatedWallets,
      transactions: state.transactions.filter((t) => t.id !== id),
    },
    deletedTx: oldTx,
  };
}

/**
 * Deposit to a savings goal:
 * - Wallet balance decreases by amount
 * - Goal currentAmount increases by amount
 * - Generates an internal asset transfer (type: 'TRANSFER', transferKind: 'GOAL_DEPOSIT')
 * - Monthly income and expense remain unchanged
 * - Net assets remain unchanged
 */
export function applyGoalDeposit(
  state: AppDomainState,
  goalId: string,
  walletId: string,
  amount: number,
  note?: string,
  dateStr?: string
): DomainResult<{ state: AppDomainState; newTx: Transaction }> {
  if (typeof amount !== 'number' || isNaN(amount) || !isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'Số tiền nạp vào mục tiêu tích lũy phải lớn hơn 0' };
  }

  const goal = state.goals.find((g) => g.id === goalId);
  if (!goal) {
    return { ok: false, error: 'Không tìm thấy mục tiêu tích lũy' };
  }

  const wallet = state.wallets.find((w) => w.id === walletId);
  if (!wallet) {
    return { ok: false, error: 'Không tìm thấy ví nguồn' };
  }

  if (wallet.type === 'CREDIT') {
    return { ok: false, error: 'Không thể nạp vào mục tiêu tích lũy bằng thẻ tín dụng' };
  }

  if (wallet.balance < amount) {
    return { ok: false, error: 'Số dư ví không đủ để nạp vào mục tiêu tích lũy!' };
  }

  const now = dateStr || new Date().toISOString();
  const dateOnly = now.split('T')[0];

  const newHistoryItem = {
    id: `gh-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    date: dateOnly,
    amount,
    type: 'DEPOSIT' as const,
    walletId,
    note: note || `Nạp từ ${wallet.name}`,
  };

  const updatedGoals = state.goals.map((g) =>
    g.id === goalId
      ? {
          ...g,
          currentAmount: g.currentAmount + amount,
          history: [newHistoryItem, ...g.history],
        }
      : g
  );

  const updatedWallets = state.wallets.map((w) =>
    w.id === walletId ? { ...w, balance: w.balance - amount } : w
  );

  const newTx: Transaction = {
    id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: 'TRANSFER',
    amount,
    fee: 0,
    walletId,
    walletName: wallet.name,
    date: now,
    note: note || `Tích lũy vào hũ: ${goal.name}`,
    tags: ['Tích lũy mục tiêu'],
    createdAt: now,
    origin: 'GOAL',
    originId: goalId,
    transferKind: 'GOAL_DEPOSIT',
    goalId: goal.id,
    goalName: goal.name,
  };

  return {
    ok: true,
    state: {
      ...state,
      wallets: updatedWallets,
      goals: updatedGoals,
      transactions: [newTx, ...state.transactions],
    },
    newTx,
  };
}

/**
 * Withdraw from a savings goal:
 * - Goal currentAmount decreases by amount
 * - Wallet balance increases by amount
 * - Generates an internal asset transfer (type: 'TRANSFER', transferKind: 'GOAL_WITHDRAWAL')
 * - Monthly income and expense remain unchanged
 * - Net assets remain unchanged
 */
export function applyGoalWithdraw(
  state: AppDomainState,
  goalId: string,
  walletId: string,
  amount: number,
  note?: string,
  dateStr?: string
): DomainResult<{ state: AppDomainState; newTx: Transaction }> {
  if (typeof amount !== 'number' || isNaN(amount) || !isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'Số tiền rút khỏi mục tiêu phải lớn hơn 0' };
  }

  const goal = state.goals.find((g) => g.id === goalId);
  if (!goal) {
    return { ok: false, error: 'Không tìm thấy mục tiêu tích lũy' };
  }

  const wallet = state.wallets.find((w) => w.id === walletId);
  if (!wallet) {
    return { ok: false, error: 'Không tìm thấy ví nhận tiền' };
  }

  if (goal.currentAmount < amount) {
    return { ok: false, error: 'Số tiền rút vượt quá số dư hiện có trong mục tiêu tích lũy!' };
  }

  const now = dateStr || new Date().toISOString();
  const dateOnly = now.split('T')[0];

  const newHistoryItem = {
    id: `gh-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    date: dateOnly,
    amount,
    type: 'WITHDRAW' as const,
    walletId,
    note: note || `Rút về ${wallet.name}`,
  };

  const updatedGoals = state.goals.map((g) =>
    g.id === goalId
      ? {
          ...g,
          currentAmount: Math.max(0, g.currentAmount - amount),
          history: [newHistoryItem, ...g.history],
        }
      : g
  );

  const updatedWallets = state.wallets.map((w) => {
    if (w.id !== walletId) return w;
    if (w.type === 'CREDIT') {
      return { ...w, balance: Math.max(0, w.balance - amount) };
    }
    return { ...w, balance: w.balance + amount };
  });

  const newTx: Transaction = {
    id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: 'TRANSFER',
    amount,
    fee: 0,
    walletId,
    walletName: wallet.name,
    date: now,
    note: note || `Rút từ hũ tích lũy: ${goal.name}`,
    tags: ['Rút hũ tiết kiệm'],
    createdAt: now,
    origin: 'GOAL',
    originId: goalId,
    transferKind: 'GOAL_WITHDRAWAL',
    goalId: goal.id,
    goalName: goal.name,
  };

  return {
    ok: true,
    state: {
      ...state,
      wallets: updatedWallets,
      goals: updatedGoals,
      transactions: [newTx, ...state.transactions],
    },
    newTx,
  };
}

/**
 * Delete a goal safely.
 * Invariants:
 * 1. Must NOT delete a goal whose currentAmount > 0.
 * 2. Must NOT delete a goal that has financial transaction history (origin === 'GOAL' or goalId or goal.history).
 */
export function applyDeleteGoal(state: AppDomainState, goalId: string): DomainResult<{ state: AppDomainState }> {
  const goal = state.goals.find((g) => g.id === goalId);
  if (!goal) {
    return { ok: false, error: 'Không tìm thấy mục tiêu tích lũy' };
  }

  if (goal.currentAmount > 0) {
    return {
      ok: false,
      error: 'Không thể xóa mục tiêu tích lũy khi số dư lớn hơn 0. Vui lòng rút hết tiền về ví trước khi xóa.',
    };
  }

  const hasTxHistory = state.transactions.some(
    (t) => (t.origin === 'GOAL' && t.originId === goalId) || t.goalId === goalId
  );
  const hasInternalHistory = Boolean(goal.history && goal.history.length > 0);

  if (hasTxHistory || hasInternalHistory) {
    return {
      ok: false,
      error: 'Goal has transaction history and cannot be permanently deleted. (Mục tiêu đã có lịch sử giao dịch, không thể xóa vĩnh viễn.)',
    };
  }

  return {
    ok: true,
    state: {
      ...state,
      goals: state.goals.filter((g) => g.id !== goalId),
    },
  };
}

/**
 * Pay a recurring bill:
 * - Validates target wallet and amount
 * - Marks bill PAID
 * - Creates a linked EXPENSE transaction with origin: 'BILL_PAYMENT', originId: bill.id
 */
export function applyPayBill(
  state: AppDomainState,
  billId: string,
  walletId: string,
  dateStr?: string
): DomainResult<{ state: AppDomainState; newTx: Transaction }> {
  const bill = state.bills.find((b) => b.id === billId);
  if (!bill) {
    return { ok: false, error: 'Không tìm thấy hóa đơn' };
  }

  // Enforce invariant: bill cannot be paid again if already PAID
  if (bill.status === 'PAID') {
    return { ok: false, error: 'Hóa đơn đã được thanh toán, không thể thanh toán lại' };
  }

  // Enforce invariant: cannot pay if a linked transaction already exists
  const existingLinkedTx = state.transactions.find(
    (t) => t.origin === 'BILL_PAYMENT' && t.originId === billId
  );
  if (existingLinkedTx) {
    return { ok: false, error: 'Hóa đơn đã có giao dịch thanh toán liên kết, không thể thanh toán lại' };
  }

  if (typeof bill.amount !== 'number' || isNaN(bill.amount) || !isFinite(bill.amount) || bill.amount <= 0) {
    return { ok: false, error: 'Số tiền hóa đơn không hợp lệ' };
  }

  const targetWallet = state.wallets.find((w) => w.id === walletId);
  if (!targetWallet) {
    return { ok: false, error: 'Không tìm thấy ví thanh toán' };
  }

  if (targetWallet.type === 'CREDIT') {
    const newDebt = targetWallet.balance + bill.amount;
    if (targetWallet.creditLimit !== undefined && targetWallet.creditLimit > 0 && newDebt > targetWallet.creditLimit) {
      return { ok: false, error: 'Hạn mức thẻ tín dụng không đủ để thanh toán hóa đơn này' };
    }
  } else {
    if (targetWallet.balance < bill.amount) {
      return { ok: false, error: 'Số dư ví không đủ để thanh toán hóa đơn này' };
    }
  }

  const now = dateStr || new Date().toISOString();
  const dateOnly = now.split('T')[0];

  const updatedWallets = state.wallets.map((w) => {
    if (w.id !== walletId) return w;
    if (w.type === 'CREDIT') {
      return { ...w, balance: w.balance + bill.amount };
    }
    return { ...w, balance: w.balance - bill.amount };
  });

  const updatedBills = state.bills.map((b) =>
    b.id === billId
      ? {
          ...b,
          status: 'PAID' as const,
          lastPaidDate: dateOnly,
          walletId: targetWallet.id,
        }
      : b
  );

  const newTx: Transaction = {
    id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: 'EXPENSE',
    amount: bill.amount,
    categoryId: bill.categoryId,
    categoryName: bill.categoryName || 'Hóa đơn',
    walletId: targetWallet.id,
    walletName: targetWallet.name,
    date: now,
    note: `Thanh toán hóa đơn: ${bill.name}`,
    tags: ['Hóa đơn định kỳ'],
    createdAt: now,
    origin: 'BILL_PAYMENT',
    originId: bill.id,
  };

  return {
    ok: true,
    state: {
      ...state,
      wallets: updatedWallets,
      bills: updatedBills,
      transactions: [newTx, ...state.transactions],
    },
    newTx,
  };
}

/**
 * Undo / reset bill payment safely:
 * - Validates reversibility before mutating state (no silent clamping)
 * - If paid via credit card and subsequent repayment makes exact reversal impossible, rejects undo
 * - Reverses the linked payment transaction effect on wallet
 * - Removes the linked payment transaction
 * - Marks bill UNPAID
 */
export function applyUnpayBill(
  state: AppDomainState,
  billId: string
): DomainResult<{ state: AppDomainState; revertedTx?: Transaction }> {
  const bill = state.bills.find((b) => b.id === billId);
  if (!bill) {
    return { ok: false, error: 'Không tìm thấy hóa đơn' };
  }

  if (bill.status !== 'PAID') {
    return { ok: false, error: 'Hóa đơn chưa được thanh toán, không thể hoàn tác' };
  }

  // Find linked transaction
  const linkedTx = state.transactions.find((t) => t.origin === 'BILL_PAYMENT' && t.originId === billId);
  if (!linkedTx) {
    return { ok: false, error: 'Không tìm thấy giao dịch thanh toán liên kết của hóa đơn' };
  }

  const targetWallet = state.wallets.find((w) => w.id === linkedTx.walletId);
  if (!targetWallet) {
    return { ok: false, error: 'Không tìm thấy ví thanh toán liên kết để hoàn tác' };
  }

  // Reversibility check: for CREDIT wallet, reversing bill payment reduces debt.
  // If current debt is lower than bill amount, exact reversal is impossible without resulting in negative debt.
  if (targetWallet.type === 'CREDIT' && targetWallet.balance < linkedTx.amount) {
    return {
      ok: false,
      error: 'Không thể hoàn tác thanh toán hóa đơn vì dư nợ thẻ tín dụng hiện tại nhỏ hơn số tiền hóa đơn cần hoàn tác (đã có giao dịch trả nợ hoặc thay đổi số dư sau đó).',
    };
  }

  // Simulate wallet updates without silent clamping
  const simulatedWallets = state.wallets.map((w) => {
    if (w.id !== linkedTx.walletId) return { ...w };
    if (w.type === 'CREDIT') {
      return { ...w, balance: w.balance - linkedTx.amount };
    }
    return { ...w, balance: w.balance + linkedTx.amount };
  });

  // Validate all simulated balances
  for (const w of simulatedWallets) {
    if (w.type === 'CREDIT') {
      if (w.balance < 0) {
        return { ok: false, error: `Hoàn tác thanh toán khiến dư nợ thẻ "${w.name}" bị âm` };
      }
      if (w.creditLimit !== undefined && w.creditLimit > 0 && w.balance > w.creditLimit) {
        return { ok: false, error: `Hoàn tác thanh toán khiến dư nợ thẻ "${w.name}" vượt hạn mức` };
      }
    } else {
      if (w.balance < 0) {
        return { ok: false, error: `Số dư ví "${w.name}" không hợp lệ sau khi hoàn tác` };
      }
    }
  }

  const updatedBills = state.bills.map((b) =>
    b.id === billId
      ? {
          ...b,
          status: 'UNPAID' as const,
          lastPaidDate: undefined,
        }
      : b
  );

  const updatedTransactions = state.transactions.filter((t) => t.id !== linkedTx.id);

  return {
    ok: true,
    state: {
      ...state,
      wallets: simulatedWallets,
      bills: updatedBills,
      transactions: updatedTransactions,
    },
    revertedTx: linkedTx,
  };
}

/**
 * Delete wallet referential integrity check:
 * Inspect references from transactions, bills, and goal history.
 * Block deletion if referenced.
 */
export function applyDeleteWallet(state: AppDomainState, walletId: string): DomainResult<{ state: AppDomainState }> {
  const wallet = state.wallets.find((w) => w.id === walletId);
  if (!wallet) {
    return { ok: false, error: 'Không tìm thấy ví cần xóa' };
  }

  const hasTxReference = state.transactions.some(
    (t) => t.walletId === walletId || t.toWalletId === walletId
  );
  if (hasTxReference) {
    return {
      ok: false,
      error: `Không thể xóa ví "${wallet.name}" vì đang có lịch sử giao dịch liên kết. Vui lòng giữ lại ví để đảm bảo tính toàn vẹn dữ liệu sổ cái.`,
    };
  }

  const hasBillReference = state.bills.some((b) => b.walletId === walletId);
  if (hasBillReference) {
    return {
      ok: false,
      error: `Không thể xóa ví "${wallet.name}" vì đang được chọn làm ví thanh toán của hóa đơn định kỳ.`,
    };
  }

  const hasGoalReference = state.goals.some((g) =>
    g.history.some((h) => h.walletId === walletId)
  );
  if (hasGoalReference) {
    return {
      ok: false,
      error: `Không thể xóa ví "${wallet.name}" vì đang có lịch sử nạp/rút từ mục tiêu tích lũy.`,
    };
  }

  return {
    ok: true,
    state: {
      ...state,
      wallets: state.wallets.filter((w) => w.id !== walletId),
    },
  };
}

/**
 * Edit an existing wallet's metadata safely:
 * - Allows updates to metadata: name, bankName, accountNumber, color, icon, creditLimit, interestRate, isExcludedFromTotal
 * - Invariant: Existing wallet balance cannot be arbitrarily changed through normal wallet editing.
 *   Balances are strictly managed through transactions/ledger entries.
 */
export function applyEditWallet(
  state: AppDomainState,
  walletId: string,
  updates: Partial<Wallet>
): DomainResult<{ state: AppDomainState; updatedWallet: Wallet }> {
  const wallet = state.wallets.find((w) => w.id === walletId);
  if (!wallet) {
    return { ok: false, error: 'Không tìm thấy ví cần chỉnh sửa' };
  }

  // Strictly preserve existing balance and initialBalance
  const {
    balance: _ignoredBalance,
    initialBalance: _ignoredInitialBalance,
    id: _ignoredId,
    createdAt: _ignoredCreatedAt,
    type: updatedType,
    ...metadataUpdates
  } = updates;

  const updatedWallet: Wallet = {
    ...wallet,
    ...metadataUpdates,
    type: updatedType || wallet.type,
    balance: wallet.balance, // Strictly preserved
    initialBalance: wallet.initialBalance, // Strictly preserved
  };

  return {
    ok: true,
    state: {
      ...state,
      wallets: state.wallets.map((w) => (w.id === walletId ? updatedWallet : w)),
    },
    updatedWallet,
  };
}
