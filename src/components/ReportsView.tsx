'use client';

import React, { useState, useMemo } from 'react';
import { useApp } from '@/context/AppContext';
import {
  BarChart3,
  PieChart as PieChartIcon,
  TrendingUp,
  Download,
  Printer,
  Calendar,
  FileSpreadsheet,
  FileText,
  ArrowUpRight,
  ArrowDownLeft,
  Filter,
} from 'lucide-react';
import {
  formatCurrency,
  formatDate,
  exportToCSV,
  exportToExcel,
  getCurrentYearMonth,
  getPreviousYearMonth,
  getCurrentYear,
  formatMonthLabel,
  formatMonthShortLabel,
} from '@/lib/utils';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Legend,
  AreaChart,
  Area,
} from 'recharts';
import { IconHelper } from './IconHelper';

export const ReportsView: React.FC = () => {
  const { transactions, budgets, wallets, financialSummary, currentMonth } = useApp();

  const activeYm = currentMonth || getCurrentYearMonth();
  const previousYm = getPreviousYearMonth(new Date(activeYm + '-01'));
  const activeYear = activeYm.split('-')[0] || getCurrentYear();

  const [period, setPeriod] = useState<'THIS_MONTH' | 'LAST_MONTH' | 'THIS_YEAR' | 'CUSTOM'>('THIS_MONTH');
  const [customStart, setCustomStart] = useState(`${activeYm}-01`);
  const [customEnd, setCustomEnd] = useState(() => {
    const [y, m] = activeYm.split('-');
    const lastDay = new Date(parseInt(y, 10), parseInt(m, 10), 0).getDate();
    return `${activeYm}-${String(lastDay).padStart(2, '0')}`;
  });

  // Filter transactions according to selected period
  const filteredTxs = useMemo(() => {
    return transactions.filter((tx) => {
      const txDate = tx.date.split('T')[0];
      if (period === 'THIS_MONTH') {
        return txDate.startsWith(activeYm);
      }
      if (period === 'LAST_MONTH') {
        return txDate.startsWith(previousYm);
      }
      if (period === 'THIS_YEAR') {
        return txDate.startsWith(activeYear);
      }
      if (period === 'CUSTOM') {
        if (customStart && txDate < customStart) return false;
        if (customEnd && txDate > customEnd) return false;
        return true;
      }
      return true;
    });
  }, [transactions, period, activeYm, previousYm, activeYear, customStart, customEnd]);

  // Aggregate totals
  const totalIncome = useMemo(
    () => filteredTxs.filter((t) => t.type === 'INCOME').reduce((s, t) => s + t.amount, 0),
    [filteredTxs]
  );
  const totalExpense = useMemo(() => {
    const expenseTxs = filteredTxs.filter((t) => t.type === 'EXPENSE').reduce((s, t) => s + t.amount, 0);
    const transferFees = filteredTxs
      .filter((t) => t.type === 'TRANSFER' && typeof t.fee === 'number' && isFinite(t.fee) && t.fee > 0)
      .reduce((s, t) => s + (t.fee || 0), 0);
    return expenseTxs + transferFees;
  }, [filteredTxs]);
  const netSavings = totalIncome - totalExpense;
  const savingsRate = totalIncome > 0 ? Math.max(0, Math.round((netSavings / totalIncome) * 100)) : 0;

  // Pie chart: Category Breakdown
  const categoryBreakdown = useMemo(() => {
    const expenseTxs = filteredTxs.filter((t) => t.type === 'EXPENSE');
    const catMap: { [name: string]: { total: number; count: number } } = {};

    expenseTxs.forEach((t) => {
      const name = t.categoryName || 'Khác';
      if (!catMap[name]) catMap[name] = { total: 0, count: 0 };
      catMap[name].total += t.amount;
      catMap[name].count += 1;
    });

    // Add transfer fees if any
    const transferFeeTxs = filteredTxs.filter(
      (t) => t.type === 'TRANSFER' && typeof t.fee === 'number' && isFinite(t.fee) && t.fee > 0
    );
    if (transferFeeTxs.length > 0) {
      const feeTotal = transferFeeTxs.reduce((s, t) => s + (t.fee || 0), 0);
      catMap['Phí chuyển khoản'] = { total: feeTotal, count: transferFeeTxs.length };
    }

    const colors = ['#f97316', '#ec4899', '#8b5cf6', '#0ea5e9', '#eab308', '#10b981', '#64748b', '#ef4444'];
    return Object.keys(catMap)
      .map((name, i) => ({
        name,
        value: catMap[name].total,
        count: catMap[name].count,
        percentage: totalExpense > 0 ? Math.round((catMap[name].total / totalExpense) * 1000) / 10 : 0,
        color: colors[i % colors.length],
      }))
      .sort((a, b) => b.value - a.value);
  }, [filteredTxs, totalExpense]);

  // Bar chart: Income vs Expense over time
  const monthlyComparisonData = useMemo(() => {
    const [currYearStr, currMonthStr] = activeYm.split('-');
    const currYear = parseInt(currYearStr, 10);
    const currMonthNum = parseInt(currMonthStr, 10);

    const months: string[] = [];
    for (let i = 4; i >= 0; i--) {
      const d = new Date(currYear, currMonthNum - 1 - i, 1);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      months.push(`${y}-${m}`);
    }

    return months.map((m) => {
      const monthTxs = transactions.filter((t) => t.date.startsWith(m));
      const inc = monthTxs.filter((t) => t.type === 'INCOME').reduce((s, t) => s + t.amount, 0);
      const expTxs = monthTxs.filter((t) => t.type === 'EXPENSE').reduce((s, t) => s + t.amount, 0);
      const expFees = monthTxs
        .filter((t) => t.type === 'TRANSFER' && typeof t.fee === 'number' && isFinite(t.fee) && t.fee > 0)
        .reduce((s, t) => s + (t.fee || 0), 0);
      const exp = expTxs + expFees;
      return {
        month: `T${parseInt(m.slice(5), 10)}`,
        Thu: inc,
        Chi: exp,
      };
    });
  }, [transactions, activeYm]);

  // Cash flow trend line/area
  const cashflowTrendData = useMemo(() => {
    const totalNetDelta = monthlyComparisonData.reduce((sum, d) => sum + (d.Thu - d.Chi), 0);
    let runningBalance = (financialSummary?.totalAssets ?? 0) - totalNetDelta;

    return monthlyComparisonData.map((d) => {
      const diff = d.Thu - d.Chi;
      runningBalance += diff;
      return {
        month: d.month,
        'Dòng tiền thuần': diff,
        'Tổng tích lũy': Math.round(runningBalance),
      };
    });
  }, [monthlyComparisonData, financialSummary]);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6 pb-12 print:p-0 print:m-0">
      {/* 1. HEADER & PERIOD SELECTOR */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-white tracking-tight">
            Báo Cáo & Phân Tích Chuyên Sâu
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Biểu đồ tròn cơ cấu chi tiêu, so sánh Thu - Chi theo thời gian, phân tích xu hướng dòng tiền & xuất báo cáo
          </p>
        </div>

        {/* Action buttons: Excel, CSV, PDF/Print */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => exportToCSV(filteredTxs)}
            className="flex items-center space-x-1.5 px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-semibold shadow-sm transition-colors"
          >
            <FileText className="w-4 h-4 text-emerald-600" />
            <span>Xuất CSV</span>
          </button>

          <button
            onClick={() => exportToExcel(filteredTxs, budgets, wallets, financialSummary)}
            className="flex items-center space-x-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-colors"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Xuất Excel (.xlsx)</span>
          </button>

          <button
            onClick={handlePrint}
            className="flex items-center space-x-1.5 px-3.5 py-2 bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold shadow-sm transition-colors"
          >
            <Printer className="w-4 h-4" />
            <span>In / Xuất PDF</span>
          </button>
        </div>
      </div>

      {/* 2. TIME PERIOD FILTER BUTTONS */}
      <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 print:hidden">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-slate-500 mr-2">Khoảng thời gian:</span>
          <button
            onClick={() => setPeriod('THIS_MONTH')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
              period === 'THIS_MONTH'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
            }`}
          >
            Tháng này ({formatMonthShortLabel(activeYm)})
          </button>

          <button
            onClick={() => setPeriod('LAST_MONTH')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
              period === 'LAST_MONTH'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
            }`}
          >
            Tháng trước ({formatMonthShortLabel(previousYm)})
          </button>

          <button
            onClick={() => setPeriod('THIS_YEAR')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
              period === 'THIS_YEAR'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
            }`}
          >
            Cả năm {activeYear}
          </button>

          <button
            onClick={() => setPeriod('CUSTOM')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
              period === 'CUSTOM'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
            }`}
          >
            Tùy chọn ngày
          </button>
        </div>

        {period === 'CUSTOM' && (
          <div className="flex items-center space-x-2">
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="px-2.5 py-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs"
            />
            <span className="text-xs text-slate-400">đến</span>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="px-2.5 py-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs"
            />
          </div>
        )}
      </div>

      {/* 3. EXECUTIVE SUMMARY BANNER (PRINT-FRIENDLY) */}
      <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm print:border-none print:shadow-none">
        <div className="hidden print:block pb-4 mb-4 border-b">
          <h2 className="text-xl font-bold text-slate-900">BÁO CÁO TỔNG HỢP TÀI CHÍNH CHI TIÊU</h2>
          <p className="text-xs text-slate-500">
            Kỳ báo cáo: {period === 'THIS_MONTH' ? formatMonthLabel(activeYm) : period === 'LAST_MONTH' ? formatMonthLabel(previousYm) : period === 'THIS_YEAR' ? `Năm ${activeYear}` : `Từ ${formatDate(customStart, 'dateOnly')} đến ${formatDate(customEnd, 'dateOnly')}`} • Tạo ngày: {formatDate(new Date().toISOString(), 'full')}
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <span className="text-xs font-semibold text-slate-400 uppercase">Tổng thu nhập</span>
            <p className="text-xl font-black text-emerald-600 dark:text-emerald-400 mt-1">
              +{formatCurrency(totalIncome)}
            </p>
            <span className="text-[11px] text-slate-400">{filteredTxs.filter((t) => t.type === 'INCOME').length} khoản thu</span>
          </div>

          <div>
            <span className="text-xs font-semibold text-slate-400 uppercase">Tổng chi tiêu</span>
            <p className="text-xl font-black text-rose-600 dark:text-rose-400 mt-1">
              -{formatCurrency(totalExpense)}
            </p>
            <span className="text-[11px] text-slate-400">{filteredTxs.filter((t) => t.type === 'EXPENSE').length} khoản chi</span>
          </div>

          <div>
            <span className="text-xs font-semibold text-slate-400 uppercase">Thặng dư / Tích lũy</span>
            <p
              className={`text-xl font-black mt-1 ${
                netSavings >= 0 ? 'text-blue-600 dark:text-blue-400' : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              {netSavings >= 0 ? '+' : ''}
              {formatCurrency(netSavings)}
            </p>
            <span className="text-[11px] text-slate-400">Dòng tiền ròng</span>
          </div>

          <div>
            <span className="text-xs font-semibold text-slate-400 uppercase">Tỷ lệ tích lũy</span>
            <p className="text-xl font-black text-indigo-600 dark:text-indigo-400 mt-1">
              {savingsRate}%
            </p>
            <span className="text-[11px] text-slate-400">Trên tổng thu nhập</span>
          </div>
        </div>
      </div>

      {/* 4. CHARTS: BIỂU ĐỒ TRÒN & BIỂU ĐỒ CỘT */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 print:block print:space-y-6">
        {/* Chart 1: Biểu đồ tròn Cơ cấu chi tiêu */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-bold text-slate-800 dark:text-white flex items-center space-x-2">
                <PieChartIcon className="w-5 h-5 text-purple-500" />
                <span>Cơ cấu chi tiêu theo Danh mục</span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Phân bổ tỷ trọng % các nhóm chi tiêu trong kỳ
              </p>
            </div>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={categoryBreakdown}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={95}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {categoryBreakdown.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(val: any) => formatCurrency(Number(val))}
                  contentStyle={{
                    backgroundColor: '#1e293b',
                    borderColor: '#334155',
                    borderRadius: '12px',
                    color: '#fff',
                    fontSize: '12px',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Category breakdown pills */}
          <div className="grid grid-cols-2 gap-2 mt-2 max-h-40 overflow-y-auto">
            {categoryBreakdown.map((item) => (
              <div key={item.name} className="flex items-center justify-between text-xs p-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/40">
                <div className="flex items-center space-x-1.5 truncate">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                  <span className="text-slate-700 dark:text-slate-300 truncate">{item.name}</span>
                </div>
                <span className="font-bold text-slate-900 dark:text-white shrink-0 ml-1">
                  {item.percentage}%
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Chart 2: Biểu đồ cột Thu - Chi qua các tháng */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-bold text-slate-800 dark:text-white flex items-center space-x-2">
                <BarChart3 className="w-5 h-5 text-blue-500" />
                <span>So sánh Thu - Chi theo thời gian</span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Biến động dòng tiền qua 5 tháng gần nhất
              </p>
            </div>
          </div>

          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyComparisonData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis
                  tickFormatter={(val) => `${val / 1000000}Tr`}
                  tick={{ fontSize: 12 }}
                  width={45}
                />
                <Tooltip
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(val: any) => formatCurrency(Number(val))}
                  contentStyle={{
                    backgroundColor: '#1e293b',
                    borderColor: '#334155',
                    borderRadius: '12px',
                    color: '#fff',
                    fontSize: '12px',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Bar dataKey="Thu" fill="#10b981" radius={[6, 6, 0, 0]} />
                <Bar dataKey="Chi" fill="#f43f5e" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* 5. CHART 3: PHÂN TÍCH XU HƯỚNG DÒNG TIỀN (AREA CHART) */}
      <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-bold text-slate-800 dark:text-white flex items-center space-x-2">
              <TrendingUp className="w-5 h-5 text-indigo-500" />
              <span>Phân tích Xu hướng Dòng tiền & Tích lũy</span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Biểu đồ tăng trưởng tổng tài sản tích lũy qua các tháng
            </p>
          </div>
        </div>

        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={cashflowTrendData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="colorNetWorth" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis
                tickFormatter={(val) => `${val / 1000000}Tr`}
                tick={{ fontSize: 12 }}
                width={50}
              />
              <Tooltip
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={(val: any) => formatCurrency(Number(val))}
                contentStyle={{
                  backgroundColor: '#1e293b',
                  borderColor: '#334155',
                  borderRadius: '12px',
                  color: '#fff',
                  fontSize: '12px',
                }}
              />
              <Area
                type="monotone"
                dataKey="Tổng tích lũy"
                stroke="#6366f1"
                strokeWidth={3}
                fillOpacity={1}
                fill="url(#colorNetWorth)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 6. DETAILED CATEGORY RANKING TABLE */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800">
          <h3 className="text-base font-bold text-slate-800 dark:text-white">
            Xếp hạng Danh mục Chi tiêu trong Kỳ
          </h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 uppercase font-semibold">
              <tr>
                <th className="px-6 py-3">Hạng</th>
                <th className="px-6 py-3">Danh mục</th>
                <th className="px-6 py-3">Tổng chi (₫)</th>
                <th className="px-6 py-3">Tỷ trọng (%)</th>
                <th className="px-6 py-3">Số giao dịch</th>
                <th className="px-6 py-3">Trung bình / lần</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {categoryBreakdown.map((cat, idx) => (
                <tr key={cat.name} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                  <td className="px-6 py-3.5 font-extrabold text-slate-400">#{idx + 1}</td>
                  <td className="px-6 py-3.5 font-bold text-slate-800 dark:text-white flex items-center space-x-2">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: cat.color }} />
                    <span>{cat.name}</span>
                  </td>
                  <td className="px-6 py-3.5 font-extrabold text-rose-600 dark:text-rose-400">
                    {formatCurrency(cat.value)}
                  </td>
                  <td className="px-6 py-3.5">
                    <div className="flex items-center space-x-2">
                      <span className="font-semibold text-slate-700 dark:text-slate-300 w-10">
                        {cat.percentage}%
                      </span>
                      <div className="w-24 bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${cat.percentage}%`, backgroundColor: cat.color }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-3.5 text-slate-600 dark:text-slate-400 font-medium">
                    {cat.count} lần
                  </td>
                  <td className="px-6 py-3.5 font-semibold text-slate-700 dark:text-slate-300">
                    {formatCurrency(Math.round(cat.value / (cat.count || 1)))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
