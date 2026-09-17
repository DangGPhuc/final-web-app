'use client';

import React, { useState } from 'react';
import { useApp } from '@/context/AppContext';
import { Budget, SavingsGoal } from '@/types';
import {
  PieChart,
  Plus,
  AlertTriangle,
  ShieldAlert,
  CheckCircle2,
  TrendingUp,
  Wallet,
  PiggyBank,
  Edit2,
  Trash2,
  ArrowUpRight,
  ArrowDownLeft,
  Calendar,
  Sparkles,
  Info,
  DollarSign,
  X,
  Target,
} from 'lucide-react';
import { formatCurrency, calculateBudgetStatuses } from '@/lib/utils';
import { IconHelper } from './IconHelper';
import confetti from 'canvas-confetti';

export const BudgetsView: React.FC = () => {
  const {
    budgets,
    transactions,
    categories,
    goals,
    wallets,
    bills,
    planner,
    addBudget,
    editBudget,
    deleteBudget,
    updatePlanner,
    addGoal,
    editGoal,
    deleteGoal,
    depositToGoal,
    withdrawFromGoal,
  } = useApp();

  const [activeSubTab, setActiveSubTab] = useState<'CATEGORY_BUDGETS' | 'PLANNER' | 'SAVINGS_GOALS'>(
    'CATEGORY_BUDGETS'
  );

  // Modals
  const [budgetModalOpen, setBudgetModalOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState<Budget | null>(null);
  const [budgetCategoryId, setBudgetCategoryId] = useState('');
  const [budgetAmount, setBudgetAmount] = useState('');

  const [goalModalOpen, setGoalModalOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<SavingsGoal | null>(null);
  const [goalName, setGoalName] = useState('');
  const [goalTarget, setGoalTarget] = useState('');
  const [goalDeadline, setGoalDeadline] = useState('');
  const [goalColor, setGoalColor] = useState('#0ea5e9');

  const [depositModalOpen, setDepositModalOpen] = useState(false);
  const [selectedGoal, setSelectedGoal] = useState<SavingsGoal | null>(null);
  const [depositAmount, setDepositAmount] = useState('');
  const [depositWalletId, setDepositWalletId] = useState(wallets[0]?.id || '');
  const [depositNote, setDepositNote] = useState('');
  const [isDepositMode, setIsDepositMode] = useState(true); // true = deposit, false = withdraw

  // Calculate budget statuses
  const budgetStatuses = calculateBudgetStatuses(budgets, transactions);
  const totalBudgetLimit = budgets.reduce((sum, b) => sum + b.amount, 0);
  const totalBudgetSpent = budgetStatuses.reduce((sum, b) => sum + b.spent, 0);
  const totalBudgetRemaining = totalBudgetLimit - totalBudgetSpent;

  // Income Planner calculations
  const monthlyIncome = planner.monthlyIncome;
  const needsBudget = (monthlyIncome * planner.needsPercent) / 100;
  const wantsBudget = (monthlyIncome * planner.wantsPercent) / 100;
  const savingsBudget = (monthlyIncome * planner.savingsPercent) / 100;

  const totalMonthlyBills = bills.reduce((sum, b) => sum + b.amount, 0);
  const availableFlexibleBudget = Math.max(0, monthlyIncome - totalMonthlyBills - savingsBudget);

  // Save or edit budget
  const handleSaveBudget = (e: React.FormEvent) => {
    e.preventDefault();
    const amountNum = Number(budgetAmount);
    if (!amountNum || amountNum <= 0) {
      alert('Vui lòng nhập hạn mức hợp lệ');
      return;
    }
    const cat = categories.find((c) => c.id === budgetCategoryId);

    if (editingBudget) {
      editBudget(editingBudget.id, {
        categoryId: budgetCategoryId,
        categoryName: cat?.name || 'Khác',
        amount: amountNum,
      });
    } else {
      addBudget({
        categoryId: budgetCategoryId,
        categoryName: cat?.name || 'Khác',
        amount: amountNum,
        month: '2026-09',
        alertThreshold80: true,
        alertThreshold100: true,
      });
    }
    setBudgetModalOpen(false);
    setEditingBudget(null);
  };

  // Save or edit goal
  const handleSaveGoal = (e: React.FormEvent) => {
    e.preventDefault();
    const targetNum = Number(goalTarget);
    if (!goalName.trim() || !targetNum || targetNum <= 0) {
      alert('Vui lòng nhập tên mục tiêu và số tiền');
      return;
    }

    if (editingGoal) {
      editGoal(editingGoal.id, {
        name: goalName,
        targetAmount: targetNum,
        deadline: goalDeadline,
        color: goalColor,
      });
    } else {
      addGoal({
        name: goalName,
        targetAmount: targetNum,
        currentAmount: 0,
        deadline: goalDeadline || '2026-12-31',
        color: goalColor,
        icon: 'PiggyBank',
      });
    }
    setGoalModalOpen(false);
    setEditingGoal(null);
  };

  // Deposit or Withdraw from goal
  const handleGoalTransaction = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGoal) return;
    const amountNum = Number(depositAmount);
    if (!amountNum || amountNum <= 0 || !isFinite(amountNum)) {
      alert('Vui lòng nhập số tiền hợp lệ (> 0)');
      return;
    }

    if (isDepositMode) {
      const wallet = wallets.find((w) => w.id === depositWalletId);
      if (wallet && wallet.balance < amountNum) {
        alert('Số dư ví không đủ để nạp vào mục tiêu tích lũy');
        return;
      }

      depositToGoal(selectedGoal.id, amountNum, depositWalletId, depositNote);
      // If goal reaches 100%, trigger celebration!
      if (selectedGoal.currentAmount + amountNum >= selectedGoal.targetAmount) {
        try {
          confetti({
            particleCount: 100,
            spread: 70,
            origin: { y: 0.6 },
          });
        } catch {
          // ignore
        }
      }
    } else {
      if (selectedGoal.currentAmount < amountNum) {
        alert('Số tiền rút vượt quá số dư hiện có trong mục tiêu tích lũy');
        return;
      }

      withdrawFromGoal(selectedGoal.id, amountNum, depositWalletId, depositNote);
    }

    setDepositModalOpen(false);
    setSelectedGoal(null);
    setDepositAmount('');
  };

  return (
    <div className="space-y-6 pb-12">
      {/* 1. HEADER & SUB-TABS */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-white tracking-tight">
            Ngân Sách & Hũ Tiết Kiệm
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Cài đặt hạn mức chi tiêu, cảnh báo 80%/100%, tạo budget từ thu nhập cá nhân & theo dõi hũ tích lũy
          </p>
        </div>

        <div className="flex items-center space-x-2">
          {activeSubTab === 'CATEGORY_BUDGETS' && (
            <button
              onClick={() => {
                setEditingBudget(null);
                setBudgetCategoryId(categories[0]?.id || '');
                setBudgetAmount('');
                setBudgetModalOpen(true);
              }}
              className="flex items-center space-x-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>+ Thêm hạn mức danh mục</span>
            </button>
          )}

          {activeSubTab === 'SAVINGS_GOALS' && (
            <button
              onClick={() => {
                setEditingGoal(null);
                setGoalName('');
                setGoalTarget('');
                setGoalDeadline('2026-12-31');
                setGoalModalOpen(true);
              }}
              className="flex items-center space-x-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>+ Tạo hũ tiết kiệm mới</span>
            </button>
          )}
        </div>
      </div>

      {/* SUB-TABS SELECTOR */}
      <div className="flex space-x-2 border-b border-slate-200 dark:border-slate-800 pb-1">
        <button
          onClick={() => setActiveSubTab('CATEGORY_BUDGETS')}
          className={`px-4 py-2 text-xs sm:text-sm font-bold rounded-xl transition-all ${
            activeSubTab === 'CATEGORY_BUDGETS'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          Hạn mức theo Danh mục ({budgets.length})
        </button>

        <button
          onClick={() => setActiveSubTab('PLANNER')}
          className={`px-4 py-2 text-xs sm:text-sm font-bold rounded-xl transition-all ${
            activeSubTab === 'PLANNER'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          Tạo Budget từ Thu nhập (50/30/20)
        </button>

        <button
          onClick={() => setActiveSubTab('SAVINGS_GOALS')}
          className={`px-4 py-2 text-xs sm:text-sm font-bold rounded-xl transition-all ${
            activeSubTab === 'SAVINGS_GOALS'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          Hũ Tiết Kiệm & Mục tiêu ({goals.length})
        </button>
      </div>

      {/* ========================================================================= */}
      {/* SUB-TAB 1: HẠN MỨC DANH MỤC & CẢNH BÁO 80% / 100% */}
      {/* ========================================================================= */}
      {activeSubTab === 'CATEGORY_BUDGETS' && (
        <div className="space-y-6">
          {/* Summary KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
              <span className="text-xs font-semibold text-slate-400 uppercase">Tổng ngân sách thiết lập</span>
              <p className="text-2xl font-black text-slate-800 dark:text-white mt-1">
                {formatCurrency(totalBudgetLimit)}
              </p>
              <span className="text-[11px] text-slate-400">Áp dụng cho tháng 09/2026</span>
            </div>

            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
              <span className="text-xs font-semibold text-slate-400 uppercase">Đã chi tiêu thực tế</span>
              <p className="text-2xl font-black text-rose-600 dark:text-rose-400 mt-1">
                {formatCurrency(totalBudgetSpent)}
              </p>
              <span className="text-[11px] text-slate-400">
                Đã dùng {totalBudgetLimit > 0 ? Math.round((totalBudgetSpent / totalBudgetLimit) * 100) : 0}% tổng ngân sách
              </span>
            </div>

            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
              <span className="text-xs font-semibold text-slate-400 uppercase">Ngân sách còn lại</span>
              <p
                className={`text-2xl font-black mt-1 ${
                  totalBudgetRemaining >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {formatCurrency(totalBudgetRemaining)}
              </p>
              <span className="text-[11px] text-slate-400">
                {totalBudgetRemaining >= 0 ? 'Có thể chi tiêu tiếp tục' : 'Đã chi vượt hạn mức'}
              </span>
            </div>
          </div>

          {/* Category Budgets Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {budgetStatuses.map((item) => {
              const { budget, spent, remaining, percentage, status } = item;
              const cat = categories.find((c) => c.id === budget.categoryId);

              return (
                <div
                  key={budget.id}
                  className={`p-5 rounded-2xl bg-white dark:bg-slate-900 border transition-all relative overflow-hidden ${
                    status === 'EXCEEDED'
                      ? 'border-rose-400 dark:border-rose-800 shadow-md shadow-rose-500/10'
                      : status === 'WARNING'
                      ? 'border-amber-400 dark:border-amber-800 shadow-md shadow-amber-500/10'
                      : 'border-slate-200 dark:border-slate-800 shadow-sm'
                  }`}
                >
                  {/* Top: Icon & Category name & Badge */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center space-x-3">
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-sm"
                        style={{ backgroundColor: cat?.color || '#6366f1' }}
                      >
                        <IconHelper name={cat?.icon || 'CircleDot'} size={20} />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-slate-800 dark:text-white">
                          {budget.categoryName}
                        </h3>
                        <span className="text-[11px] text-slate-400">Tháng 09/2026</span>
                      </div>
                    </div>

                    {/* Alert Badge */}
                    {status === 'EXCEEDED' && (
                      <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 border border-rose-300 animate-pulse">
                        <ShieldAlert className="w-3 h-3" />
                        <span>VƯỢT {percentage}%</span>
                      </span>
                    )}

                    {status === 'WARNING' && (
                      <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-300">
                        <AlertTriangle className="w-3 h-3" />
                        <span>CẢNH BÁO 80%</span>
                      </span>
                    )}

                    {status === 'SAFE' && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
                        An toàn ({percentage}%)
                      </span>
                    )}
                  </div>

                  {/* Amounts Info */}
                  <div className="space-y-1.5 my-3">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-500 dark:text-slate-400">Đã chi:</span>
                      <span className="font-extrabold text-slate-800 dark:text-white">
                        {formatCurrency(spent)}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-500 dark:text-slate-400">Hạn mức tháng:</span>
                      <span className="font-semibold text-slate-600 dark:text-slate-300">
                        {formatCurrency(budget.amount)}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-500 dark:text-slate-400">Còn lại:</span>
                      <span
                        className={`font-black ${
                          remaining >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {formatCurrency(remaining)}
                      </span>
                    </div>
                  </div>

                  {/* Visual Progress Bar */}
                  <div className="w-full bg-slate-100 dark:bg-slate-800 h-2.5 rounded-full overflow-hidden mb-3">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        status === 'EXCEEDED'
                          ? 'bg-rose-500'
                          : status === 'WARNING'
                          ? 'bg-amber-500'
                          : 'bg-emerald-500'
                      }`}
                      style={{ width: `${Math.min(100, percentage)}%` }}
                    />
                  </div>

                  {/* Spending Advice */}
                  <div className="text-[11px] p-2 bg-slate-50 dark:bg-slate-800/50 rounded-xl text-slate-500 dark:text-slate-400 flex items-center justify-between mb-3">
                    <span>Gợi ý chi mỗi ngày:</span>
                    <span className="font-bold text-slate-700 dark:text-slate-200">
                      {remaining > 0 ? `~${formatCurrency(Math.round(remaining / 24))}/ngày` : '0 ₫/ngày (Đã hết)'}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <button
                      onClick={() => {
                        setEditingBudget(budget);
                        setBudgetCategoryId(budget.categoryId);
                        setBudgetAmount(String(budget.amount));
                        setBudgetModalOpen(true);
                      }}
                      className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded-lg transition-colors"
                      title="Sửa hạn mức"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Xác nhận xóa ngân sách danh mục ${budget.categoryName}?`)) {
                          deleteBudget(budget.id);
                        }
                      }}
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors"
                      title="Xóa ngân sách"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SUB-TAB 2: THÊM THU NHẬP CÁ NHÂN → TẠO BUDGET KHẢ DỤNG ĐỂ TIÊU (50/30/20) */}
      {/* ========================================================================= */}
      {activeSubTab === 'PLANNER' && (
        <div className="space-y-6">
          {/* Concept explanation card */}
          <div className="p-6 bg-gradient-to-r from-blue-600 to-indigo-700 rounded-2xl text-white shadow-lg">
            <div className="flex items-start space-x-3">
              <Sparkles className="w-6 h-6 text-yellow-300 shrink-0 mt-1" />
              <div>
                <h3 className="text-lg font-bold">Thêm thu nhập cá nhân → Tạo Budget khả dụng để tiêu</h3>
                <p className="text-xs text-blue-100 mt-1 leading-relaxed">
                  Thiết lập tổng thu nhập hàng tháng và áp dụng công thức phân bổ ngân sách thông minh (Quy tắc 50/30/20).
                  Hệ thống tự động trừ các hóa đơn cố định và mục tiêu tích lũy để tính chính xác số tiền bạn được phép
                  tiêu thoải mái mà không lo thiếu hụt.
                </p>
              </div>
            </div>
          </div>

          {/* Income & Allocation Form */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
              <h3 className="text-base font-bold text-slate-800 dark:text-white flex items-center space-x-2">
                <DollarSign className="w-5 h-5 text-emerald-500" />
                <span>Thu nhập & Tỷ lệ phân bổ</span>
              </h3>

              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                  Thu nhập hàng tháng (VNĐ)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    value={monthlyIncome}
                    onChange={(e) => updatePlanner({ ...planner, monthlyIncome: Number(e.target.value) })}
                    className="w-full text-xl font-bold px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none dark:text-white"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">₫</span>
                </div>
              </div>

              {/* Sliders for percentages */}
              <div className="space-y-3 pt-2">
                <div>
                  <div className="flex justify-between text-xs font-semibold mb-1">
                    <span className="text-blue-600 dark:text-blue-400">1. Thiết yếu (Needs)</span>
                    <span>{planner.needsPercent}%</span>
                  </div>
                  <input
                    type="range"
                    min="30"
                    max="70"
                    value={planner.needsPercent}
                    onChange={(e) => updatePlanner({ ...planner, needsPercent: Number(e.target.value) })}
                    className="w-full accent-blue-600"
                  />
                  <span className="text-[11px] text-slate-400">Ăn uống, thuê nhà, xăng xe, hóa đơn</span>
                </div>

                <div>
                  <div className="flex justify-between text-xs font-semibold mb-1">
                    <span className="text-purple-600 dark:text-purple-400">2. Mong muốn (Wants)</span>
                    <span>{planner.wantsPercent}%</span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="50"
                    value={planner.wantsPercent}
                    onChange={(e) => updatePlanner({ ...planner, wantsPercent: Number(e.target.value) })}
                    className="w-full accent-purple-600"
                  />
                  <span className="text-[11px] text-slate-400">Mua sắm, cafe, giải trí, du lịch</span>
                </div>

                <div>
                  <div className="flex justify-between text-xs font-semibold mb-1">
                    <span className="text-emerald-600 dark:text-emerald-400">3. Tích lũy (Savings)</span>
                    <span>{planner.savingsPercent}%</span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="40"
                    value={planner.savingsPercent}
                    onChange={(e) => updatePlanner({ ...planner, savingsPercent: Number(e.target.value) })}
                    className="w-full accent-emerald-600"
                  />
                  <span className="text-[11px] text-slate-400">Quỹ khẩn cấp, hũ tiết kiệm, đầu tư</span>
                </div>
              </div>
            </div>

            {/* Calculated Breakdown Cards */}
            <div className="lg:col-span-2 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-4 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/50">
                  <span className="text-xs font-bold text-blue-700 dark:text-blue-300">
                    Ngân sách Thiết yếu ({planner.needsPercent}%)
                  </span>
                  <p className="text-xl font-black text-blue-900 dark:text-blue-100 mt-1">
                    {formatCurrency(needsBudget)}
                  </p>
                  <span className="text-[10px] text-blue-600/80">Cho các nhu cầu sinh hoạt chính</span>
                </div>

                <div className="p-4 rounded-xl bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-900/50">
                  <span className="text-xs font-bold text-purple-700 dark:text-purple-300">
                    Ngân sách Mong muốn ({planner.wantsPercent}%)
                  </span>
                  <p className="text-xl font-black text-purple-900 dark:text-purple-100 mt-1">
                    {formatCurrency(wantsBudget)}
                  </p>
                  <span className="text-[10px] text-purple-600/80">Hưởng thụ, sở thích cá nhân</span>
                </div>

                <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50">
                  <span className="text-xs font-bold text-emerald-700 dark:text-emerald-300">
                    Mục tiêu Tích lũy ({planner.savingsPercent}%)
                  </span>
                  <p className="text-xl font-black text-emerald-900 dark:text-emerald-100 mt-1">
                    {formatCurrency(savingsBudget)}
                  </p>
                  <span className="text-[10px] text-emerald-600/80">Đưa vào hũ tiết kiệm</span>
                </div>
              </div>

              {/* Formula & Final Available Budget Calculation */}
              <div className="p-6 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
                <h4 className="text-sm font-bold text-slate-800 dark:text-white">
                  Dòng tiền Khả dụng Thực tế để Tiêu
                </h4>

                <div className="space-y-2 text-xs">
                  <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                    <span className="text-slate-500">Tổng thu nhập tháng:</span>
                    <span className="font-bold text-slate-800 dark:text-white">+{formatCurrency(monthlyIncome)}</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                    <span className="text-slate-500">Trừ Hóa đơn cố định tháng (tiền nhà, điện nước, internet):</span>
                    <span className="font-bold text-rose-600">-{formatCurrency(totalMonthlyBills)}</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                    <span className="text-slate-500">Trừ Trích lập tích lũy & dự phòng ({planner.savingsPercent}%):</span>
                    <span className="font-bold text-blue-600">-{formatCurrency(savingsBudget)}</span>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-slate-900 text-white flex items-center justify-between">
                  <div>
                    <span className="text-xs text-slate-400 font-semibold uppercase">
                      NGÂN SÁCH KHẢ DỤNG CHI TIÊU LINH HOẠT
                    </span>
                    <p className="text-2xl font-black text-emerald-400 mt-0.5">
                      {formatCurrency(availableFlexibleBudget)}
                    </p>
                  </div>
                  <div className="text-right text-xs text-slate-300">
                    <p className="font-bold">~{formatCurrency(Math.round(availableFlexibleBudget / 30))}/ngày</p>
                    <span className="text-[10px] text-slate-400">Chi tiêu an toàn</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SUB-TAB 3: HŨ TIẾT KIỆM & MỤC TIÊU TÍCH LŨY (SAVINGS GOALS) */}
      {/* ========================================================================= */}
      {activeSubTab === 'SAVINGS_GOALS' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {goals.map((g) => {
              const percentage = g.targetAmount > 0 ? Math.min(100, Math.round((g.currentAmount / g.targetAmount) * 100)) : 0;
              const remaining = Math.max(0, g.targetAmount - g.currentAmount);
              const isCompleted = g.currentAmount >= g.targetAmount;

              return (
                <div
                  key={g.id}
                  className={`p-6 rounded-2xl bg-white dark:bg-slate-900 border transition-all shadow-sm ${
                    isCompleted
                      ? 'border-emerald-500/60 dark:border-emerald-500/40 bg-emerald-50/20 dark:bg-emerald-950/10'
                      : 'border-slate-200 dark:border-slate-800'
                  }`}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center space-x-3">
                      <div
                        className="w-12 h-12 rounded-2xl flex items-center justify-center text-white shadow-md"
                        style={{ backgroundColor: g.color }}
                      >
                        <Target className="w-6 h-6" />
                      </div>
                      <div>
                        <h3 className="text-base font-bold text-slate-800 dark:text-white">{g.name}</h3>
                        <div className="flex items-center space-x-2 text-xs text-slate-400 mt-0.5">
                          <Calendar className="w-3.5 h-3.5" />
                          <span>Hạn mục tiêu: {g.deadline}</span>
                        </div>
                      </div>
                    </div>

                    {isCompleted ? (
                      <span className="flex items-center space-x-1 px-3 py-1 bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 font-extrabold text-xs rounded-full">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>HOÀN THÀNH 100% 🎉</span>
                      </span>
                    ) : (
                      <span className="px-3 py-1 bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 font-bold text-xs rounded-full">
                        {percentage}%
                      </span>
                    )}
                  </div>

                  {/* Amounts */}
                  <div className="space-y-1.5 my-4">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-500">Đã tích lũy được:</span>
                      <span className="font-extrabold text-slate-900 dark:text-white text-sm">
                        {formatCurrency(g.currentAmount)}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-500">Mục tiêu:</span>
                      <span className="font-semibold text-slate-700 dark:text-slate-300">
                        {formatCurrency(g.targetAmount)}
                      </span>
                    </div>
                    {!isCompleted && (
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-500">Còn thiếu:</span>
                        <span className="font-bold text-rose-600 dark:text-rose-400">
                          {formatCurrency(remaining)}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Progress bar */}
                  <div className="w-full bg-slate-100 dark:bg-slate-800 h-3 rounded-full overflow-hidden mb-4">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${percentage}%`,
                        backgroundColor: isCompleted ? '#10b981' : g.color,
                      }}
                    />
                  </div>

                  {/* Deposit / Withdraw Buttons */}
                  <div className="flex items-center space-x-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <button
                      onClick={() => {
                        setSelectedGoal(g);
                        setIsDepositMode(true);
                        setDepositAmount('');
                        setDepositNote('');
                        setDepositModalOpen(true);
                      }}
                      className="flex-1 flex items-center justify-center space-x-1.5 py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs rounded-xl transition-colors shadow-sm"
                    >
                      <ArrowDownLeft className="w-3.5 h-3.5" />
                      <span>+ Nạp tiền vào hũ</span>
                    </button>

                    <button
                      onClick={() => {
                        setSelectedGoal(g);
                        setIsDepositMode(false);
                        setDepositAmount('');
                        setDepositNote('');
                        setDepositModalOpen(true);
                      }}
                      className="flex-1 flex items-center justify-center space-x-1.5 py-2 px-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold text-xs rounded-xl transition-colors"
                    >
                      <ArrowUpRight className="w-3.5 h-3.5" />
                      <span>- Rút tiền</span>
                    </button>

                    <button
                      onClick={() => {
                        if (confirm(`Bạn có chắc muốn xóa hũ ${g.name}?`)) {
                          deleteGoal(g.id);
                        }
                      }}
                      className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-xl transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: ADD / EDIT BUDGET */}
      {/* ========================================================================= */}
      {budgetModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="relative max-w-md w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl p-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-lg font-bold text-slate-800 dark:text-white">
                {editingBudget ? 'Chỉnh sửa hạn mức' : 'Thiết lập hạn mức danh mục'}
              </h3>
              <button
                onClick={() => setBudgetModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveBudget} className="space-y-4 pt-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">
                  Danh mục chi tiêu
                </label>
                <select
                  value={budgetCategoryId}
                  onChange={(e) => setBudgetCategoryId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm dark:text-white"
                >
                  {categories
                    .filter((c) => c.type === 'EXPENSE')
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">
                  Hạn mức chi tiêu tháng (VNĐ)
                </label>
                <input
                  type="number"
                  required
                  value={budgetAmount}
                  onChange={(e) => setBudgetAmount(e.target.value)}
                  placeholder="Ví dụ: 5000000"
                  className="w-full text-xl font-bold px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl dark:text-white"
                />
              </div>

              <div className="p-3 bg-blue-50 dark:bg-blue-950/40 rounded-xl text-xs text-blue-700 dark:text-blue-300">
                Hệ thống tự động kích hoạt thông báo cảnh báo khi chi tiêu danh mục này đạt mốc 80% và 100%.
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setBudgetModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-sm"
                >
                  Lưu hạn mức
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: ADD / EDIT GOAL */}
      {/* ========================================================================= */}
      {goalModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="relative max-w-md w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl p-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-lg font-bold text-slate-800 dark:text-white">
                {editingGoal ? 'Sửa mục tiêu tích lũy' : 'Tạo hũ tiết kiệm mới'}
              </h3>
              <button
                onClick={() => setGoalModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveGoal} className="space-y-4 pt-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">
                  Tên mục tiêu tích lũy
                </label>
                <input
                  type="text"
                  required
                  value={goalName}
                  onChange={(e) => setGoalName(e.target.value)}
                  placeholder="Ví dụ: Mua laptop, Quỹ du lịch Hàn Quốc..."
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">
                  Số tiền mục tiêu (VNĐ)
                </label>
                <input
                  type="number"
                  required
                  value={goalTarget}
                  onChange={(e) => setGoalTarget(e.target.value)}
                  placeholder="Ví dụ: 30000000"
                  className="w-full text-xl font-bold px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">
                  Hạn hoàn thành dự kiến
                </label>
                <input
                  type="date"
                  value={goalDeadline}
                  onChange={(e) => setGoalDeadline(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Màu sắc đại diện</label>
                <div className="flex space-x-2">
                  {['#0ea5e9', '#10b981', '#ec4899', '#8b5cf6', '#f59e0b', '#ef4444'].map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setGoalColor(c)}
                      className={`w-7 h-7 rounded-full transition-transform ${
                        goalColor === c ? 'scale-125 ring-2 ring-slate-400' : ''
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setGoalModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 rounded-xl"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-sm"
                >
                  Tạo hũ
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: DEPOSIT / WITHDRAW FROM GOAL */}
      {/* ========================================================================= */}
      {depositModalOpen && selectedGoal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="relative max-w-md w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl p-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-lg font-bold text-slate-800 dark:text-white">
                {isDepositMode ? `Nạp tiền vào: ${selectedGoal.name}` : `Rút tiền từ: ${selectedGoal.name}`}
              </h3>
              <button
                onClick={() => setDepositModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleGoalTransaction} className="space-y-4 pt-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">
                  Số tiền {isDepositMode ? 'nạp' : 'rút'} (VNĐ)
                </label>
                <input
                  type="number"
                  required
                  autoFocus
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  placeholder="0"
                  className="w-full text-2xl font-bold px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">
                  {isDepositMode ? 'Trừ từ Ví nguồn' : 'Chuyển về Ví đích'}
                </label>
                <select
                  value={depositWalletId}
                  onChange={(e) => setDepositWalletId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm dark:text-white"
                >
                  {wallets.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} ({formatCurrency(w.balance)})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">
                  Ghi chú
                </label>
                <input
                  type="text"
                  value={depositNote}
                  onChange={(e) => setDepositNote(e.target.value)}
                  placeholder="Ví dụ: Trích từ tiền thưởng dự án..."
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm dark:text-white"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setDepositModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 rounded-xl"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className={`px-5 py-2 text-xs font-semibold text-white rounded-xl shadow-sm ${
                    isDepositMode ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                >
                  Xác nhận {isDepositMode ? 'nạp' : 'rút'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
