'use client';

import React, { useState, useMemo } from 'react';
import { useApp } from '@/context/AppContext';
import {
  formatCurrency,
  formatDate,
  getTransactionYearMonth,
  formatMonthLabel,
} from '@/lib/finance/calculations';
import { DEFAULT_CATEGORIES } from '@/lib/constants';
import type { Transaction } from '@/types';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Search,
  Filter,
  Trash2,
  Edit2,
  CheckCircle2,
  XCircle,
  Mail,
  Calendar,
  Layers,
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
    selectedMonth,
    setSelectedMonth,
    selectedMonthCashflow,
    editTransaction,
    deleteTransaction,
    approveTransaction,
    ignoreTransaction,
    addMerchantRule,
  } = useApp();

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [directionFilter, setDirectionFilter] = useState<'ALL' | 'IN' | 'OUT'>('ALL');
  const [fundFilter, setFundFilter] = useState<string>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Edit modal state
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [editCategory, setEditCategory] = useState('');
  const [editFundId, setEditFundId] = useState<string | undefined>(undefined);
  const [rememberMapping, setRememberMapping] = useState(false);

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
      if (categoryFilter !== 'ALL' && tx.category !== categoryFilter) return false;
      if (statusFilter !== 'ALL' && tx.status !== statusFilter) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const descMatch = tx.description.toLowerCase().includes(q);
        const cpMatch = tx.counterparty?.toLowerCase().includes(q);
        const bankMatch = tx.bank?.toLowerCase().includes(q);
        if (!descMatch && !cpMatch && !bankMatch) return false;
      }

      return true;
    });
  }, [transactions, selectedMonth, directionFilter, fundFilter, categoryFilter, statusFilter, searchQuery]);

  // Daily cashflow chart data for selected month
  const chartData = useMemo(() => {
    const daysInMonth = 31;
    const daysMap = new Map<string, { day: string; Tiền_Vào: number; Tiền_Ra: number }>();

    for (let i = 1; i <= daysInMonth; i++) {
      const dayStr = String(i).padStart(2, '0');
      daysMap.set(dayStr, { day: dayStr, Tiền_Vào: 0, Tiền_Ra: 0 });
    }

    const monthTxs = transactions.filter(
      tx => tx.status === 'POSTED' && getTransactionYearMonth(tx) === selectedMonth
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

  const handleOpenEdit = (tx: Transaction) => {
    setEditingTx(tx);
    setEditCategory(tx.category || 'Khác');
    setEditFundId(tx.fundId);
    setRememberMapping(false);
  };

  const handleSaveEdit = () => {
    if (!editingTx) return;

    editTransaction(editingTx.id, {
      category: editCategory,
      fundId: editFundId || undefined,
    });

    if (rememberMapping && editingTx.counterparty) {
      addMerchantRule({
        pattern: editingTx.counterparty,
        category: editCategory,
        fundId: editFundId,
      });
    }

    setEditingTx(null);
  };

  return (
    <div className="space-y-6">
      {/* Header & Month Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl text-[#f5f5f7]">Dòng tiền</h1>
          <p className="text-xs text-[#9f9fa0] mt-1">
            Tổng hợp luồng thu chi và quản lý chi tiết toàn bộ giao dịch
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-[#9f9fa0]" />
          <select
            value={selectedMonth}
            onChange={e => setSelectedMonth(e.target.value)}
            className="cockpit-input text-xs font-mono py-1.5 px-3"
          >
            {availableMonths.map(m => (
              <option key={m} value={m}>
                {formatMonthLabel(m)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Cashflow Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="cockpit-card p-5">
          <div className="flex items-center justify-between text-xs text-[#9f9fa0] mb-2">
            <span className="font-mono-data">TỔNG TIỀN VÀO (IN)</span>
            <ArrowDownLeft className="w-4 h-4 text-[#10b981]" />
          </div>
          <div className="text-2xl font-light text-[#10b981]">
            +{formatCurrency(selectedMonthCashflow.totalIn)}
          </div>
        </div>

        <div className="cockpit-card p-5">
          <div className="flex items-center justify-between text-xs text-[#9f9fa0] mb-2">
            <span className="font-mono-data">TỔNG TIỀN RA (OUT)</span>
            <ArrowUpRight className="w-4 h-4 text-[#f43f5e]" />
          </div>
          <div className="text-2xl font-light text-[#f43f5e]">
            -{formatCurrency(selectedMonthCashflow.totalOut)}
          </div>
        </div>

        <div className="cockpit-card p-5">
          <div className="flex items-center justify-between text-xs text-[#9f9fa0] mb-2">
            <span className="font-mono-data">DÒNG TIỀN THUẦN (NET)</span>
            <span
              className={`text-xs font-mono ${
                selectedMonthCashflow.net >= 0 ? 'text-[#10b981]' : 'text-[#f43f5e]'
              }`}
            >
              {selectedMonthCashflow.net >= 0 ? 'THẶNG DƯ' : 'THÂM HỤT'}
            </span>
          </div>
          <div
            className={`text-2xl font-light ${
              selectedMonthCashflow.net >= 0 ? 'text-[#f5f5f7]' : 'text-[#f43f5e]'
            }`}
          >
            {selectedMonthCashflow.net >= 0 ? '+' : ''}
            {formatCurrency(selectedMonthCashflow.net)}
          </div>
        </div>
      </div>

      {/* Main Cashflow Time Chart (Recharts) */}
      <div className="cockpit-card p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-medium text-[#f5f5f7]">
              Biểu đồ dòng tiền theo ngày ({formatMonthLabel(selectedMonth)})
            </h2>
            <p className="text-[11px] text-[#9f9fa0]">
              Theo dõi nhịp độ tiền vào và tiền ra trong suốt tháng
            </p>
          </div>
        </div>

        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#232427" vertical={false} />
              <XAxis dataKey="day" stroke="#9f9fa0" fontSize={11} tickLine={false} />
              <YAxis
                stroke="#9f9fa0"
                fontSize={11}
                tickLine={false}
                tickFormatter={val => (val >= 1000000 ? `${val / 1000000}M` : `${val / 1000}k`)}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#17181a',
                  border: '1px solid #34363a',
                  borderRadius: '10px',
                  color: '#f5f5f7',
                  fontSize: '12px',
                }}
                formatter={(val: any) => formatCurrency(Number(val) || 0)}
              />
              <Legend wrapperStyle={{ fontSize: '11px', color: '#9f9fa0' }} />
              <Bar dataKey="Tiền_Vào" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={20} />
              <Bar dataKey="Tiền_Ra" fill="#f43f5e" radius={[4, 4, 0, 0]} maxBarSize={20} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Transaction Table & Filters */}
      <div className="cockpit-card p-6">
        {/* Filters Bar */}
        <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between mb-6 pb-4 border-b border-[#232427]">
          {/* Search Input */}
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-[#9f9fa0] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Tìm kiếm nội dung, đối tác, ngân hàng..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="cockpit-input w-full pl-9 text-xs"
            />
          </div>

          {/* Direction Filter */}
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={directionFilter}
              onChange={e => setDirectionFilter(e.target.value as any)}
              className="cockpit-input text-xs py-1.5"
            >
              <option value="ALL">Tất cả luồng</option>
              <option value="IN">Tiền vào (+)</option>
              <option value="OUT">Tiền ra (-)</option>
            </select>

            {/* Fund Filter */}
            <select
              value={fundFilter}
              onChange={e => setFundFilter(e.target.value)}
              className="cockpit-input text-xs py-1.5"
            >
              <option value="ALL">Tất cả quỹ</option>
              {funds.map(f => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>

            {/* Category Filter */}
            <select
              value={categoryFilter}
              onChange={e => setCategoryFilter(e.target.value)}
              className="cockpit-input text-xs py-1.5"
            >
              <option value="ALL">Tất cả danh mục</option>
              {DEFAULT_CATEGORIES.map(c => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="cockpit-input text-xs py-1.5 font-mono"
            >
              <option value="ALL">Tất cả trạng thái</option>
              <option value="POSTED">Đã ghi sổ</option>
              <option value="NEEDS_REVIEW">Cần xem lại</option>
              <option value="IGNORED">Đã bỏ qua</option>
            </select>
          </div>
        </div>

        {/* Transaction Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[#232427] text-[#9f9fa0] font-mono-data">
                <th className="pb-3 pr-4">THỜI GIAN</th>
                <th className="pb-3 pr-4">HÌNH THỨC</th>
                <th className="pb-3 pr-4">NỘI DUNG / ĐỐI TÁC</th>
                <th className="pb-3 pr-4">DANH MỤC</th>
                <th className="pb-3 pr-4">QUỸ</th>
                <th className="pb-3 pr-4 text-right">SỐ TIỀN</th>
                <th className="pb-3 pr-4 text-center">NGUỒN</th>
                <th className="pb-3 pr-4 text-center">TRẠNG THÁI</th>
                <th className="pb-3 text-right">THAO TÁC</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#232427]">
              {filteredTransactions.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-[#9f9fa0]">
                    Không tìm thấy giao dịch nào phù hợp với bộ lọc trong tháng {selectedMonth}.
                  </td>
                </tr>
              ) : (
                filteredTransactions.map(tx => {
                  const isIn = tx.direction === 'IN';
                  const mappedFund = funds.find(f => f.id === tx.fundId);
                  const isNeedsReview = tx.status === 'NEEDS_REVIEW';

                  return (
                    <tr
                      key={tx.id}
                      className={`hover:bg-[#1f2022]/40 transition-colors ${
                        isNeedsReview ? 'bg-[#f59e0b]/5' : ''
                      }`}
                    >
                      {/* Date / Time */}
                      <td className="py-3 pr-4 text-[#9f9fa0] font-mono whitespace-nowrap">
                        {formatDate(tx.occurredAt, 'short')}
                      </td>

                      {/* Direction Type */}
                      <td className="py-3 pr-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 font-mono text-[11px] px-2 py-0.5 rounded ${
                            isIn
                              ? 'bg-[#10b981]/10 text-[#10b981]'
                              : 'bg-[#f43f5e]/10 text-[#f43f5e]'
                          }`}
                        >
                          {isIn ? '+' : '-'} {isIn ? 'THU' : 'CHI'}
                        </span>
                      </td>

                      {/* Description & Counterparty */}
                      <td className="py-3 pr-4">
                        <div className="font-medium text-[#f5f5f7] line-clamp-1 max-w-[240px]">
                          {tx.description}
                        </div>
                        {tx.counterparty && (
                          <div className="text-[11px] text-[#9f9fa0] line-clamp-1">
                            {tx.counterparty}
                          </div>
                        )}
                      </td>

                      {/* Category */}
                      <td className="py-3 pr-4 text-[#9f9fa0] whitespace-nowrap">
                        {tx.category || '—'}
                      </td>

                      {/* Mapped Fund */}
                      <td className="py-3 pr-4 whitespace-nowrap">
                        {mappedFund ? (
                          <span className="text-[11px] px-2 py-0.5 rounded bg-[#2e2e2e] text-[#f5f5f7]">
                            {mappedFund.name}
                          </span>
                        ) : (
                          <span className="text-[#6b6b70]">Chưa phân bổ</span>
                        )}
                      </td>

                      {/* Amount */}
                      <td
                        className={`py-3 pr-4 text-right font-mono font-medium whitespace-nowrap ${
                          isIn ? 'text-[#10b981]' : 'text-[#f5f5f7]'
                        }`}
                      >
                        {isIn ? '+' : '-'}
                        {formatCurrency(tx.amount, tx.currency)}
                      </td>

                      {/* Source */}
                      <td className="py-3 pr-4 text-center whitespace-nowrap">
                        {tx.source === 'EMAIL' ? (
                          <span
                            className="inline-flex items-center gap-1 text-[11px] text-[#00b3dd]"
                            title={tx.rawSubject || 'Nhận tự động từ email'}
                          >
                            <Mail className="w-3 h-3" />
                            <span>{tx.bank || 'Email'}</span>
                          </span>
                        ) : (
                          <span className="text-[11px] text-[#9f9fa0]">Thủ công</span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="py-3 pr-4 text-center whitespace-nowrap">
                        {tx.status === 'POSTED' && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-[#10b981] font-mono">
                            <CheckCircle2 className="w-3 h-3" /> GHI SỔ
                          </span>
                        )}
                        {tx.status === 'NEEDS_REVIEW' && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-[#f59e0b] font-mono bg-[#f59e0b]/10 px-1.5 py-0.5 rounded">
                            XEM LẠI
                          </span>
                        )}
                        {tx.status === 'IGNORED' && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-[#6b6b70] font-mono">
                            BỎ QUA
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1">
                          {isNeedsReview && (
                            <button
                              onClick={() => approveTransaction(tx.id)}
                              className="p-1 rounded hover:bg-[#10b981]/20 text-[#10b981]"
                              title="Phê duyệt giao dịch này"
                            >
                              <CheckCircle2 className="w-4 h-4" />
                            </button>
                          )}

                          <button
                            onClick={() => handleOpenEdit(tx)}
                            className="p-1 rounded hover:bg-[#2e2e2e] text-[#9f9fa0] hover:text-[#f5f5f7]"
                            title="Sửa danh mục hoặc quỹ"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>

                          {tx.source === 'EMAIL' ? (
                            <button
                              onClick={() => ignoreTransaction(tx.id)}
                              className="p-1 rounded hover:bg-[#2e2e2e] text-[#9f9fa0] hover:text-[#f43f5e]"
                              title="Bỏ qua giao dịch này"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <button
                              onClick={() => deleteTransaction(tx.id)}
                              className="p-1 rounded hover:bg-[#f43f5e]/10 text-[#9f9fa0] hover:text-[#f43f5e]"
                              title="Xóa giao dịch"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
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

      {/* Edit Transaction Modal */}
      {editingTx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="cockpit-card-elevated max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-medium text-[#f5f5f7]">Chỉnh sửa giao dịch</h3>

            <div>
              <div className="text-xs text-[#9f9fa0]">Mô tả</div>
              <div className="text-sm text-[#f5f5f7] font-medium mt-0.5">
                {editingTx.description}
              </div>
            </div>

            <div>
              <label className="text-xs text-[#9f9fa0] block mb-1">Danh mục</label>
              <select
                value={editCategory}
                onChange={e => setEditCategory(e.target.value)}
                className="cockpit-input w-full text-xs"
              >
                {DEFAULT_CATEGORIES.map(c => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            {editingTx.direction === 'OUT' && (
              <div>
                <label className="text-xs text-[#9f9fa0] block mb-1">Phân bổ vào Quỹ</label>
                <select
                  value={editFundId || ''}
                  onChange={e => setEditFundId(e.target.value || undefined)}
                  className="cockpit-input w-full text-xs"
                >
                  <option value="">-- Không phân vào quỹ nào --</option>
                  {funds.map(f => (
                    <option key={f.id} value={f.id}>
                      {f.name} (Hạn mức: {formatCurrency(f.monthlyAllocation)})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {editingTx.counterparty && (
              <label className="flex items-center gap-2 text-xs text-[#9f9fa0] cursor-pointer pt-2">
                <input
                  type="checkbox"
                  checked={rememberMapping}
                  onChange={e => setRememberMapping(e.target.checked)}
                  className="rounded border-[#34363a] bg-[#090a0b]"
                />
                <span>Ghi nhớ quy tắc này cho đối tác "{editingTx.counterparty}"</span>
              </label>
            )}

            <div className="flex justify-end gap-2 pt-4 border-t border-[#232427]">
              <button
                onClick={() => setEditingTx(null)}
                className="btn-secondary text-xs"
              >
                Hủy
              </button>
              <button
                onClick={handleSaveEdit}
                className="btn-primary text-xs"
              >
                Lưu thay đổi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
