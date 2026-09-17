'use client';

import React, { useState, useMemo } from 'react';
import { useApp } from '@/context/AppContext';
import {
  Wallet,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowRightLeft,
  ChevronRight,
  Sparkles,
  AlertTriangle,
  PiggyBank,
  Eye,
} from 'lucide-react';
import { formatCurrency, formatDate, calculateBudgetStatuses } from '@/lib/utils';
import { ReceiptModal } from './ReceiptModal';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';

const pieChartColors = ['#f97316', '#ec4899', '#8b5cf6', '#0ea5e9', '#eab308', '#10b981', '#64748b'];

export const DashboardView: React.FC = () => {
  const { financialSummary, transactions, budgets, bills, openQuickAdd, setActiveTab, currentMonth } = useApp();
  const [selectedReceipt, setSelectedReceipt] = useState<string | null>(null);
  const [showBalance, setShowBalance] = useState(true);

  const budgetStatuses = calculateBudgetStatuses(budgets, transactions, currentMonth);
  const exceededBudgets = budgetStatuses.filter((b) => b.status === 'EXCEEDED');
  const warningBudgets = budgetStatuses.filter((b) => b.status === 'WARNING');
  const unpaidBills = bills.filter((b) => b.status === 'UNPAID');

  const barChartData = useMemo(() => {
    const [currYearStr, currMonthStr] = (currentMonth || '2026-09').split('-');
    const currYear = parseInt(currYearStr, 10);
    const currMonthNum = parseInt(currMonthStr, 10);

    const months: string[] = [];
    for (let i = 2; i >= 0; i--) {
      const d = new Date(currYear, currMonthNum - 1 - i, 1);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      months.push(`${y}-${m}`);
    }

    return months.map((m) => {
      const monthTxs = transactions.filter((t) => t.date.startsWith(m));
      const inc = monthTxs.filter((t) => t.type === 'INCOME').reduce((s, t) => s + t.amount, 0);
      const exp = monthTxs.filter((t) => t.type === 'EXPENSE').reduce((s, t) => s + t.amount, 0);
      return {
        month: `T${parseInt(m.slice(5), 10)}`,
        Thu: inc,
        Chi: exp,
      };
    });
  }, [transactions, currentMonth]);

  const currentMonthExpenses = transactions.filter(
    (t) => t.type === 'EXPENSE' && t.date.startsWith(currentMonth)
  );
  const categoryExpensesMap: { [catName: string]: number } = {};
  currentMonthExpenses.forEach((t) => {
    const cat = t.categoryName || 'Khác';
    categoryExpensesMap[cat] = (categoryExpensesMap[cat] || 0) + t.amount;
  });

  const pieChartData = Object.keys(categoryExpensesMap).map((catName, index) => ({
    name: catName,
    value: categoryExpensesMap[catName],
    color: pieChartColors[index % pieChartColors.length],
  }));

  const recentTransactions = transactions.slice(0, 6);

  const quickActions = [
    { label: 'Chi phí', icon: ArrowDownLeft, color: 'bg-rose-500', onClick: () => openQuickAdd('EXPENSE') },
    { label: 'Thu nhập', icon: ArrowUpRight, color: 'bg-emerald-500', onClick: () => openQuickAdd('INCOME') },
    { label: 'Chuyển ví', icon: ArrowRightLeft, color: 'bg-sky-500', onClick: () => openQuickAdd('TRANSFER') },
    { label: 'Ngân sách', icon: PiggyBank, color: 'bg-amber-500', onClick: () => setActiveTab('budgets') },
  ];

  const hasAlerts = exceededBudgets.length > 0 || warningBudgets.length > 0 || unpaidBills.length > 0;

  return (
    <div className="space-y-5 pb-4">
      {/* Greeting */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-slate-500">Chào buổi sáng,</p>
          <h1 className="text-xl font-extrabold text-slate-900">Admin</h1>
        </div>
        <button
          onClick={() => setShowBalance((s) => !s)}
          className="p-2 rounded-full bg-white border border-slate-100 text-slate-400 hover:text-slate-600 shadow-sm"
          aria-label={showBalance ? 'Ẩn số dư' : 'Hiện số dư'}
        >
          <Eye className="w-4 h-4" />
        </button>
      </div>

      {/* Balance Card */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-lg shadow-emerald-500/20 p-5">
        <div className="relative z-10">
          <p className="text-sm font-medium text-emerald-100">Tổng tài sản ròng</p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-3xl font-black tracking-tight">
              {showBalance ? formatCurrency(financialSummary.totalAssets) : '••••••'}
            </span>
          </div>
          <div className="mt-4 flex items-center gap-4 text-sm">
            <div>
              <p className="text-emerald-100 text-xs">Số dư khả dụng</p>
              <p className="font-bold">
                {showBalance ? formatCurrency(financialSummary.availableBalance) : '•••'}
              </p>
            </div>
            <div className="w-px h-8 bg-white/20" />
            <div>
              <p className="text-emerald-100 text-xs">Tiết kiệm</p>
              <p className="font-bold">
                {showBalance ? formatCurrency(financialSummary.totalSavings) : '•••'}
              </p>
            </div>
          </div>
        </div>
        <div className="absolute -right-6 -bottom-8 w-40 h-40 rounded-full bg-white/10 blur-2xl" />
        <div className="absolute right-10 top-0 w-20 h-20 rounded-full bg-white/10 blur-xl" />
      </div>

      {/* Income / Expense */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
              <ArrowUpRight className="w-4 h-4" />
            </div>
            <span className="text-xs font-medium text-slate-500">Thu nhập</span>
          </div>
          <p className="text-lg font-bold text-slate-900 truncate">
            {formatCurrency(financialSummary.monthlyIncome)}
          </p>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center">
              <ArrowDownLeft className="w-4 h-4" />
            </div>
            <span className="text-xs font-medium text-slate-500">Chi tiêu</span>
          </div>
          <p className="text-lg font-bold text-slate-900 truncate">
            {formatCurrency(financialSummary.monthlyExpense)}
          </p>
        </div>
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="text-sm font-bold text-slate-900 mb-3">Thao tác nhanh</h2>
        <div className="grid grid-cols-4 gap-3">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <button key={action.label} onClick={action.onClick} className="flex flex-col items-center gap-2 group">
                <div
                  className={`w-12 h-12 rounded-2xl ${action.color} text-white flex items-center justify-center shadow-md group-active:scale-90 transition-transform`}
                >
                  <Icon className="w-5 h-5" />
                </div>
                <span className="text-[11px] font-semibold text-slate-600">{action.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Alerts */}
      {hasAlerts && (
        <div className="space-y-2.5">
          {exceededBudgets.slice(0, 1).map((item) => (
            <button
              key={item.budget.id}
              onClick={() => setActiveTab('budgets')}
              className="w-full flex items-center gap-3 p-3 bg-rose-50 border border-rose-100 rounded-2xl text-left"
            >
              <div className="w-10 h-10 rounded-full bg-rose-500 text-white flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-rose-800">Vượt ngân sách {item.budget.categoryName}</p>
                <p className="text-xs text-rose-600/80 truncate">
                  Đã chi {formatCurrency(item.spent)} / {formatCurrency(item.budget.amount)}
                </p>
              </div>
              <ChevronRight className="w-4 h-4 text-rose-300 shrink-0" />
            </button>
          ))}

          {warningBudgets.slice(0, 1).map((item) => (
            <button
              key={item.budget.id}
              onClick={() => setActiveTab('budgets')}
              className="w-full flex items-center gap-3 p-3 bg-amber-50 border border-amber-100 rounded-2xl text-left"
            >
              <div className="w-10 h-10 rounded-full bg-amber-500 text-white flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-amber-800">Sắp vượt ngân sách {item.budget.categoryName}</p>
                <p className="text-xs text-amber-600/80 truncate">Đã sử dụng {item.percentage}%</p>
              </div>
              <ChevronRight className="w-4 h-4 text-amber-300 shrink-0" />
            </button>
          ))}

          {unpaidBills.length > 0 && (
            <button
              onClick={() => setActiveTab('bills')}
              className="w-full flex items-center gap-3 p-3 bg-blue-50 border border-blue-100 rounded-2xl text-left"
            >
              <div className="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center shrink-0">
                <Wallet className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-blue-800">{unpaidBills.length} hóa đơn sắp đến hạn</p>
                <p className="text-xs text-blue-600/80 truncate">
                  Tổng {formatCurrency(unpaidBills.reduce((s, b) => s + b.amount, 0))}
                </p>
              </div>
              <ChevronRight className="w-4 h-4 text-blue-300 shrink-0" />
            </button>
          )}
        </div>
      )}

      {/* What-If Promo */}
      <button
        onClick={() => setActiveTab('whatif')}
        className="w-full relative overflow-hidden rounded-2xl bg-slate-900 text-white p-4 text-left shadow-md"
      >
        <div className="relative z-10 flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0">
            <Sparkles className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-bold">Mô phỏng What-If</h3>
            <p className="text-xs text-slate-300 mt-0.5 line-clamp-2">
              Kéo thanh trượt để xem tài sản thay đổi nếu cắt giảm chi tiêu hoặc đầu tư thêm.
            </p>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 mt-2" />
        </div>
      </button>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Thu - Chi</h3>
              <p className="text-xs text-slate-500">3 tháng gần nhất</p>
            </div>
            <button onClick={() => setActiveTab('reports')} className="text-xs font-semibold text-emerald-600 flex items-center gap-0.5">
              Xem báo cáo <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barChartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <XAxis dataKey="month" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} dy={8} />
                <YAxis
                  tickFormatter={(val) => `${val / 1000000}Tr`}
                  tick={{ fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  width={40}
                />
                <Tooltip
                  formatter={(val: any) => formatCurrency(Number(val))}
                  contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                />
                <Bar dataKey="Thu" fill="#10b981" radius={[6, 6, 0, 0]} />
                <Bar dataKey="Chi" fill="#f43f5e" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
          <h3 className="text-sm font-bold text-slate-900 mb-1">Chi tiêu theo danh mục</h3>
          <p className="text-xs text-slate-500 mb-4">Tháng 9</p>
          <div className="h-40 w-full">
            {pieChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={65}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {pieChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(val: any) => formatCurrency(Number(val))}
                    contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-xs text-slate-400">Chưa có dữ liệu</div>
            )}
          </div>
          <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1 mt-2">
            {pieChartData.map((entry) => (
              <div key={entry.name} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 truncate">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
                  <span className="text-slate-600 truncate">{entry.name}</span>
                </div>
                <span className="font-semibold text-slate-800 shrink-0">{formatCurrency(entry.value)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent Transactions */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-slate-100">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Giao dịch gần đây</h3>
            <p className="text-xs text-slate-500">Các phát sinh mới nhất</p>
          </div>
          <button onClick={() => setActiveTab('transactions')} className="text-xs font-semibold text-emerald-600 hover:text-emerald-700">
            Xem tất cả
          </button>
        </div>
        <div className="divide-y divide-slate-50">
          {recentTransactions.map((tx) => (
            <div
              key={tx.id}
              className="flex items-center gap-3 p-4 hover:bg-slate-50 active:bg-slate-100 transition-colors"
            >
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                  tx.type === 'EXPENSE'
                    ? 'bg-rose-100 text-rose-600'
                    : tx.type === 'INCOME'
                    ? 'bg-emerald-100 text-emerald-600'
                    : 'bg-sky-100 text-sky-600'
                }`}
              >
                {tx.type === 'EXPENSE' ? (
                  <ArrowDownLeft className="w-5 h-5" />
                ) : tx.type === 'INCOME' ? (
                  <ArrowUpRight className="w-5 h-5" />
                ) : (
                  <ArrowRightLeft className="w-5 h-5" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-slate-900 truncate">
                    {tx.type === 'TRANSFER' ? `Chuyển sang ${tx.toWalletName || 'Ví'}` : tx.categoryName || 'Khác'}
                  </p>
                  {tx.receiptImage && (
                    <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full">Hóa đơn</span>
                  )}
                </div>
                <p className="text-xs text-slate-500 truncate">
                  {formatDate(tx.date, 'full')} • {tx.walletName}
                </p>
              </div>
              <div className="text-right shrink-0">
                <span
                  className={`text-sm font-bold ${
                    tx.type === 'EXPENSE' ? 'text-rose-600' : tx.type === 'INCOME' ? 'text-emerald-600' : 'text-sky-600'
                  }`}
                >
                  {tx.type === 'EXPENSE' ? '-' : tx.type === 'INCOME' ? '+' : ''}
                  {formatCurrency(tx.amount)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <ReceiptModal
        isOpen={Boolean(selectedReceipt)}
        onClose={() => setSelectedReceipt(null)}
        imageUrl={selectedReceipt || undefined}
        title="Ảnh chụp chứng từ hóa đơn"
      />
    </div>
  );
};
