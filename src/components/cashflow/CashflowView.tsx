'use client';

import React, { useState, useMemo } from 'react';
import { useApp } from '@/context/AppContext';
import {
  formatCurrency,
  formatDate,
  getTransactionYearMonth,
  formatMonthLabel,
} from '@/lib/finance/calculations';
import type { BankTransaction } from '@/types';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Search,
  Calendar,
  Tag,
  Trash2,
  Sparkles,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';

export function CashflowView() {
  const {
    transactions,
    funds,
    categories,
    selectedMonth,
    setSelectedMonth,
    selectedMonthCashflow,
    setClassifyingTransaction,
    deleteTransaction,
  } = useApp();

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [directionFilter, setDirectionFilter] = useState<'ALL' | 'IN' | 'OUT'>('ALL');
  const [fundFilter, setFundFilter] = useState<string>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');

  // Available months from transactions
  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    set.add(selectedMonth);
    for (const tx of transactions) {
      const ym = getTransactionYearMonth(tx);
      if (ym) set.add(ym);
    }
    return Array.from(set).sort().reverse();
  }, [transactions, selectedMonth]);

  // Filtered transactions
  const filteredTransactions = useMemo(() => {
    return transactions.filter(tx => {
      const txMonth = getTransactionYearMonth(tx);
      if (txMonth !== selectedMonth) return false;

      if (directionFilter !== 'ALL' && tx.direction !== directionFilter) return false;
      if (fundFilter !== 'ALL' && tx.fundId !== fundFilter) return false;
      if (categoryFilter !== 'ALL' && tx.category?.name !== categoryFilter) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const descMatch = (tx.summary || '').toLowerCase().includes(q);
        const cpMatch = (tx.counterparty || '').toLowerCase().includes(q);
        const bankMatch = (tx.bankName || tx.bankCode || '').toLowerCase().includes(q);
        const hintMatch = (tx.merchantLabel || '').toLowerCase().includes(q);
        if (!descMatch && !cpMatch && !bankMatch && !hintMatch) return false;
      }

      return true;
    });
  }, [transactions, selectedMonth, directionFilter, fundFilter, categoryFilter, searchQuery]);

  // Daily cashflow chart data for selected month
  const chartData = useMemo(() => {
    const daysInMonth = 31;
    const daysMap = new Map<string, { day: string; Tiền_Vào: number; Tiền_Ra: number }>();

    for (let i = 1; i <= daysInMonth; i++) {
      const dayStr = String(i).padStart(2, '0');
      daysMap.set(dayStr, { day: dayStr, Tiền_Vào: 0, Tiền_Ra: 0 });
    }

    const monthTxs = transactions.filter(
      tx => getTransactionYearMonth(tx) === selectedMonth
    );

    for (const tx of monthTxs) {
      const d = new Date(tx.occurredAt);
      if (isNaN(d.getTime())) continue;
      const dayStr = String(d.getDate()).padStart(2, '0');
      const entry = daysMap.get(dayStr);
      if (entry) {
        if (tx.direction === 'IN') entry.Tiền_Vào += tx.amount;
        else entry.Tiền_Ra += tx.amount;
      }
    }

    return Array.from(daysMap.values()).filter(
      e => e.Tiền_Vào > 0 || e.Tiền_Ra > 0 || Number(e.day) <= 15
    );
  }, [transactions, selectedMonth]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl text-[#f5f5f7]">Dòng tiền chi tiết</h1>
          <p className="text-xs text-[#9f9fa0] mt-1">
            Toàn bộ biến động tài chính theo thời gian thực — Không qua hàng đợi duyệt
          </p>
        </div>

        {/* Month Selector */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-[#17181a] px-3 py-1.5 rounded-lg border border-[#232427]">
            <Calendar className="w-3.5 h-3.5 text-[#9f9fa0]" />
            <select
              value={selectedMonth}
              onChange={e => setSelectedMonth(e.target.value)}
              className="bg-transparent text-xs text-[#f5f5f7] font-mono focus:outline-none"
            >
              {availableMonths.map(m => (
                <option key={m} value={m} className="bg-[#17181a]">
                  {formatMonthLabel(m)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Month Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="cockpit-card p-5">
          <div className="flex items-center justify-between text-xs text-[#9f9fa0] mb-1">
            <span className="font-mono-data">TỔNG THU ({selectedMonth})</span>
            <ArrowDownLeft className="w-3.5 h-3.5 text-[#10b981]" />
          </div>
          <div className="text-2xl font-light text-[#10b981] font-mono">
            +{formatCurrency(selectedMonthCashflow.totalIn)}
          </div>
        </div>

        <div className="cockpit-card p-5">
          <div className="flex items-center justify-between text-xs text-[#9f9fa0] mb-1">
            <span className="font-mono-data">TỔNG CHI ({selectedMonth})</span>
            <ArrowUpRight className="w-3.5 h-3.5 text-[#f43f5e]" />
          </div>
          <div className="text-2xl font-light text-[#f43f5e] font-mono">
            -{formatCurrency(selectedMonthCashflow.totalOut)}
          </div>
        </div>

        <div className="cockpit-card p-5">
          <div className="flex items-center justify-between text-xs text-[#9f9fa0] mb-1">
            <span className="font-mono-data">DÒNG TIỀN THUẦN (NET)</span>
            <span
              className={`text-xs font-mono ${
                selectedMonthCashflow.net >= 0 ? 'text-[#10b981]' : 'text-[#f43f5e]'
              }`}
            >
              {selectedMonthCashflow.net >= 0 ? 'DƯ' : 'ÂM'}
            </span>
          </div>
          <div
            className={`text-2xl font-light font-mono ${
              selectedMonthCashflow.net >= 0 ? 'text-[#f5f5f7]' : 'text-[#f43f5e]'
            }`}
          >
            {selectedMonthCashflow.net >= 0 ? '+' : ''}
            {formatCurrency(selectedMonthCashflow.net)}
          </div>
        </div>
      </div>

      {/* Cashflow Chart */}
      <div className="cockpit-card p-6 space-y-4">
        <h2 className="text-sm font-medium text-[#f5f5f7]">Biểu đồ dòng tiền hàng ngày</h2>
        <div className="h-60 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#232427" vertical={false} />
              <XAxis dataKey="day" stroke="#6b6b70" tick={{ fill: '#9f9fa0', fontSize: 11 }} />
              <YAxis
                stroke="#6b6b70"
                tick={{ fill: '#9f9fa0', fontSize: 11 }}
                tickFormatter={val => `${(val / 1000000).toFixed(1)}M`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#17181a',
                  borderColor: '#34363a',
                  borderRadius: '12px',
                  color: '#f5f5f7',
                  fontSize: '12px',
                }}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={(val: any) => [formatCurrency(Number(val) || 0), '']}
                labelFormatter={lbl => `Ngày ${lbl}/${selectedMonth.split('-')[1]}`}
              />
              <Legend
                wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }}
                formatter={val => <span className="text-[#9f9fa0]">{val}</span>}
              />
              <Bar dataKey="Tiền_Vào" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={20} />
              <Bar dataKey="Tiền_Ra" fill="#f43f5e" radius={[4, 4, 0, 0]} maxBarSize={20} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="cockpit-card p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          {/* Search */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#9f9fa0] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Tìm kiếm đối tác, nội dung, ngân hàng..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="cockpit-input w-full pl-8 text-xs"
            />
          </div>

          {/* Direction Filter */}
          <select
            value={directionFilter}
            onChange={e => setDirectionFilter(e.target.value as 'ALL' | 'IN' | 'OUT')}
            className="cockpit-input text-xs"
          >
            <option value="ALL">Tất cả hướng tiền</option>
            <option value="IN">Tiền vào (Thu nhập)</option>
            <option value="OUT">Tiền ra (Chi tiêu)</option>
          </select>

          {/* Category Filter (User created only) */}
          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            className="cockpit-input text-xs"
          >
            <option value="ALL">Tất cả danh mục</option>
            {categories.map(c => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>

          {/* Fund Filter (User created only) */}
          <select
            value={fundFilter}
            onChange={e => setFundFilter(e.target.value)}
            className="cockpit-input text-xs"
          >
            <option value="ALL">Tất cả quỹ</option>
            {funds.map(f => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Cashflow Table */}
      <div className="cockpit-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-[#232427] bg-[#090a0b]/60 text-[#9f9fa0] font-mono-data text-[10px]">
                <th className="py-3 px-4">THỜI GIAN</th>
                <th className="py-3 px-4">CHIỀU</th>
                <th className="py-3 px-4">NGÂN HÀNG / TK</th>
                <th className="py-3 px-4">ĐỐI TÁC / NỘI DUNG</th>
                <th className="py-3 px-4">DANH MỤC</th>
                <th className="py-3 px-4">QUỸ</th>
                <th className="py-3 px-4 text-right">SỐ TIỀN</th>
                <th className="py-3 px-4">NGUỒN EMAIL</th>
                <th className="py-3 px-4 text-center">THAO TÁC</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#232427]">
              {filteredTransactions.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-[#9f9fa0] text-xs">
                    Không tìm thấy giao dịch nào phù hợp với bộ lọc.
                  </td>
                </tr>
              ) : (
                filteredTransactions.map(tx => {
                  const isIn = tx.direction === 'IN';
                  const isClassified = tx.classificationState === 'CLASSIFIED';

                  return (
                    <tr key={tx.id} className="hover:bg-[#1f2022]/40 transition-colors">
                      <td className="py-3 px-4 text-[#9f9fa0] whitespace-nowrap">
                        {formatDate(tx.occurredAt, 'full')}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-mono font-medium ${
                            isIn
                              ? 'bg-[#10b981]/15 text-[#10b981]'
                              : 'bg-[#f43f5e]/15 text-[#f43f5e]'
                          }`}
                        >
                          {isIn ? 'THU' : 'CHI'}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono whitespace-nowrap">
                        <span className="text-[#f5f5f7]">{tx.bankName || tx.bankCode || 'Ngân hàng'}</span>
                        {tx.accountHint && (
                          <span className="text-[#6b6b70] ml-1.5">{tx.accountHint}</span>
                        )}
                      </td>
                      <td className="py-3 px-4 max-w-xs">
                        <div className="text-[#f5f5f7] font-medium truncate">
                          {tx.summary || tx.counterparty}
                        </div>
                        {tx.merchantLabel && (
                          <div className="flex items-center gap-1 text-[10px] text-[#00b3dd] mt-0.5">
                            <Sparkles className="w-2.5 h-2.5" />
                            <span>{tx.merchantLabel}</span>
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {tx.category ? (
                          <span className="px-2 py-0.5 rounded bg-[#2e2e2e] text-[#f5f5f7] text-[11px]">
                            {tx.category.name}
                          </span>
                        ) : (
                          <span className="text-[#f59e0b] text-[11px] italic">
                            Chưa phân loại
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {tx.fund ? (
                          <span className="text-[#00b3dd] text-[11px] font-medium">
                            {tx.fund.name}
                          </span>
                        ) : (
                          <span className="text-[#6b6b70]">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-medium whitespace-nowrap">
                        <span className={isIn ? 'text-[#10b981]' : 'text-[#f5f5f7]'}>
                          {isIn ? '+' : '-'}
                          {formatCurrency(tx.amount, tx.currency)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-[#9f9fa0] font-mono text-[11px] truncate max-w-[150px]">
                        {tx.sourceEmail || 'demo-bank@gmail.com'}
                      </td>
                      <td className="py-3 px-4 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => setClassifyingTransaction(tx)}
                            className={`p-1.5 rounded text-xs flex items-center gap-1 transition-colors ${
                              isClassified
                                ? 'hover:bg-[#2e2e2e] text-[#9f9fa0] hover:text-[#f5f5f7]'
                                : 'bg-[#00b3dd]/15 text-[#00b3dd] hover:bg-[#00b3dd]/25 px-2'
                            }`}
                            title="Phân loại giao dịch"
                          >
                            <Tag className="w-3.5 h-3.5" />
                            {!isClassified && <span>Phân loại</span>}
                          </button>
                          <button
                            onClick={() => deleteTransaction(tx.id)}
                            className="p-1.5 rounded hover:bg-[#f43f5e]/15 text-[#9f9fa0] hover:text-[#f43f5e] transition-colors"
                            title="Xóa giao dịch"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
