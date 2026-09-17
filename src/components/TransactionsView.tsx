'use client';

import React, { useState, useMemo } from 'react';
import { useApp } from '@/context/AppContext';
import { Transaction } from '@/types';
import {
  Search,
  Filter,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowRightLeft,
  Calendar,
  Wallet,
  Tag,
  FileSpreadsheet,
  FileText,
  Plus,
  Edit2,
  Trash2,
  Eye,
  FileCheck,
  X,
} from 'lucide-react';
import { formatCurrency, formatDate, exportToCSV, exportToExcel } from '@/lib/utils';
import { IconHelper } from './IconHelper';
import { ReceiptModal } from './ReceiptModal';
import { EditTransactionModal } from './EditTransactionModal';

export const TransactionsView: React.FC = () => {
  const {
    transactions,
    wallets,
    categories,
    budgets,
    financialSummary,
    openQuickAdd,
    deleteTransaction,
  } = useApp();

  // Search & Filters State
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedType, setSelectedType] = useState<string>('ALL');
  const [selectedWallet, setSelectedWallet] = useState<string>('ALL');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedTag, setSelectedTag] = useState<string>('ALL');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  // Modals state
  const [receiptToView, setReceiptToView] = useState<string | null>(null);
  const [transactionToEdit, setTransactionToEdit] = useState<Transaction | null>(null);

  // Filter logic
  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      // Type
      if (selectedType !== 'ALL' && tx.type !== selectedType) return false;

      // Wallet
      if (selectedWallet !== 'ALL') {
        if (tx.walletId !== selectedWallet && tx.toWalletId !== selectedWallet) return false;
      }

      // Category
      if (selectedCategory !== 'ALL' && tx.categoryId !== selectedCategory) return false;

      // Tag
      if (selectedTag !== 'ALL' && (!tx.tags || !tx.tags.includes(selectedTag))) return false;

      // Date Range
      if (startDate) {
        const txDate = tx.date.split('T')[0];
        if (txDate < startDate) return false;
      }
      if (endDate) {
        const txDate = tx.date.split('T')[0];
        if (txDate > endDate) return false;
      }

      // Search term
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase();
        const matchNote = tx.note?.toLowerCase().includes(term);
        const matchCat = tx.categoryName?.toLowerCase().includes(term);
        const matchWallet = tx.walletName?.toLowerCase().includes(term);
        const matchTags = (tx.tags || []).some((t) => t.toLowerCase().includes(term));
        if (!matchNote && !matchCat && !matchWallet && !matchTags) return false;
      }

      return true;
    });
  }, [transactions, selectedType, selectedWallet, selectedCategory, selectedTag, startDate, endDate, searchTerm]);

  // Aggregate statistics for filtered results
  const stats = useMemo(() => {
    let income = 0;
    let expense = 0;
    filteredTransactions.forEach((t) => {
      if (t.type === 'INCOME') income += t.amount;
      if (t.type === 'EXPENSE') expense += t.amount;
    });
    return {
      count: filteredTransactions.length,
      income,
      expense,
      net: income - expense,
    };
  }, [filteredTransactions]);

  // Group by Date for Timeline View
  const groupedTransactions = useMemo(() => {
    const groups: { [dateKey: string]: Transaction[] } = {};
    filteredTransactions.forEach((tx) => {
      const dateKey = tx.date.split('T')[0];
      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(tx);
    });

    // Sort dates descending
    const sortedDates = Object.keys(groups).sort((a, b) => b.localeCompare(a));
    return sortedDates.map((dateKey) => {
      const dayTxs = groups[dateKey];
      const dayIncome = dayTxs.filter((t) => t.type === 'INCOME').reduce((s, t) => s + t.amount, 0);
      const dayExpense = dayTxs.filter((t) => t.type === 'EXPENSE').reduce((s, t) => s + t.amount, 0);
      return {
        dateKey,
        transactions: dayTxs,
        dayIncome,
        dayExpense,
        net: dayIncome - dayExpense,
      };
    });
  }, [filteredTransactions]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    transactions.forEach((t) => (t.tags || []).forEach((tag) => set.add(tag)));
    return Array.from(set);
  }, [transactions]);

  const clearFilters = () => {
    setSearchTerm('');
    setSelectedType('ALL');
    setSelectedWallet('ALL');
    setSelectedCategory('ALL');
    setSelectedTag('ALL');
    setStartDate('');
    setEndDate('');
  };

  const hasActiveFilters =
    searchTerm !== '' ||
    selectedType !== 'ALL' ||
    selectedWallet !== 'ALL' ||
    selectedCategory !== 'ALL' ||
    selectedTag !== 'ALL' ||
    startDate !== '' ||
    endDate !== '';

  return (
    <div className="space-y-6 pb-12">
      {/* 1. HEADER & ACTIONS */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-white tracking-tight">
            Sổ Giao Dịch
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Theo dõi dòng tiền thu chi theo dòng thời gian (Timeline) với bộ lọc chuyên sâu
          </p>
        </div>

        <div className="flex items-center space-x-2.5">
          <button
            onClick={() => exportToCSV(filteredTransactions)}
            className="flex items-center space-x-1.5 px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-semibold shadow-sm transition-colors"
            title="Xuất danh sách sang file CSV UTF-8"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            <span>Xuất CSV</span>
          </button>

          <button
            onClick={() => exportToExcel(filteredTransactions, budgets, wallets, financialSummary)}
            className="flex items-center space-x-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-colors"
            title="Tải file Excel .xlsx đầy đủ dữ liệu"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Xuất Excel (.xlsx)</span>
          </button>

          <button
            onClick={() => openQuickAdd('EXPENSE')}
            className="flex items-center space-x-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>+ Giao dịch mới</span>
          </button>
        </div>
      </div>

      {/* 2. STATS SUMMARY BAR OF FILTERED TRANSACTIONS */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div>
          <span className="text-[11px] font-semibold text-slate-400 uppercase">Số giao dịch</span>
          <p className="text-lg font-black text-slate-800 dark:text-white">{stats.count} GD</p>
        </div>
        <div>
          <span className="text-[11px] font-semibold text-slate-400 uppercase">Tổng khoản thu</span>
          <p className="text-lg font-black text-emerald-600 dark:text-emerald-400">
            +{formatCurrency(stats.income)}
          </p>
        </div>
        <div>
          <span className="text-[11px] font-semibold text-slate-400 uppercase">Tổng khoản chi</span>
          <p className="text-lg font-black text-rose-600 dark:text-rose-400">
            -{formatCurrency(stats.expense)}
          </p>
        </div>
        <div>
          <span className="text-[11px] font-semibold text-slate-400 uppercase">Dòng tiền chênh lệch</span>
          <p
            className={`text-lg font-black ${
              stats.net >= 0 ? 'text-blue-600 dark:text-blue-400' : 'text-rose-600 dark:text-rose-400'
            }`}
          >
            {stats.net >= 0 ? '+' : ''}
            {formatCurrency(stats.net)}
          </p>
        </div>
      </div>

      {/* 3. ADVANCED FILTER BAR */}
      <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 text-xs font-bold text-slate-700 dark:text-slate-300">
            <Filter className="w-4 h-4 text-blue-500" />
            <span>Bộ lọc nâng cao</span>
          </div>
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="text-xs font-semibold text-rose-600 hover:text-rose-700 flex items-center space-x-1"
            >
              <X className="w-3.5 h-3.5" />
              <span>Xóa bộ lọc</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5">
          {/* Keyword search */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Tìm theo ghi chú..."
              className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Type Filter */}
          <div>
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="ALL">Tất cả loại giao dịch</option>
              <option value="EXPENSE">Khoản chi</option>
              <option value="INCOME">Khoản thu</option>
              <option value="TRANSFER">Chuyển khoản</option>
            </select>
          </div>

          {/* Wallet Filter */}
          <div>
            <select
              value={selectedWallet}
              onChange={(e) => setSelectedWallet(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="ALL">Tất cả ví & tài khoản</option>
              {wallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>

          {/* Category Filter */}
          <div>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="ALL">Tất cả danh mục</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.type === 'INCOME' ? 'Thu' : 'Chi'})
                </option>
              ))}
            </select>
          </div>

          {/* From date */}
          <div>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              title="Từ ngày"
            />
          </div>

          {/* To date */}
          <div>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              title="Đến ngày"
            />
          </div>
        </div>

        {/* Tag Pills */}
        {allTags.length > 0 && (
          <div className="flex items-center space-x-1.5 overflow-x-auto no-scrollbar pt-1">
            <span className="text-[11px] font-semibold text-slate-400 shrink-0">Nhãn:</span>
            <button
              onClick={() => setSelectedTag('ALL')}
              className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium shrink-0 transition-colors ${
                selectedTag === 'ALL'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
              }`}
            >
              Tất cả
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() => setSelectedTag(tag)}
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium shrink-0 transition-colors ${
                  selectedTag === tag
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
                }`}
              >
                #{tag}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 4. TIMELINE LIST */}
      <div className="space-y-6">
        {groupedTransactions.length === 0 ? (
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-12 text-center">
            <Calendar className="w-12 h-12 mx-auto text-slate-300 dark:text-slate-700 mb-3" />
            <h3 className="text-base font-bold text-slate-700 dark:text-slate-300 mb-1">
              Không tìm thấy giao dịch nào
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              Thử thay đổi bộ lọc hoặc thêm một giao dịch thu chi mới
            </p>
            <button
              onClick={() => openQuickAdd('EXPENSE')}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl"
            >
              + Ghi nhận giao dịch ngay
            </button>
          </div>
        ) : (
          groupedTransactions.map((group) => (
            <div
              key={group.dateKey}
              className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden"
            >
              {/* Day Header */}
              <div className="px-5 py-3.5 bg-slate-50/80 dark:bg-slate-800/60 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <span className="font-extrabold text-sm text-slate-800 dark:text-white">
                    {formatDate(group.dateKey, 'dateOnly')}
                  </span>
                  <span className="text-xs text-slate-400 font-medium">
                    ({group.transactions.length} giao dịch)
                  </span>
                </div>
                <div className="flex items-center space-x-3 text-xs">
                  {group.dayIncome > 0 && (
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                      +{formatCurrency(group.dayIncome)}
                    </span>
                  )}
                  {group.dayExpense > 0 && (
                    <span className="font-semibold text-rose-600 dark:text-rose-400">
                      -{formatCurrency(group.dayExpense)}
                    </span>
                  )}
                </div>
              </div>

              {/* Transactions on this day */}
              <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {group.transactions.map((tx) => (
                  <div
                    key={tx.id}
                    className="p-4 hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors flex items-center justify-between group"
                  >
                    {/* Left: Icon & Info */}
                    <div className="flex items-center space-x-3.5 truncate">
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                          tx.type === 'EXPENSE'
                            ? 'bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400'
                            : tx.type === 'INCOME'
                            ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400'
                            : 'bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400'
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

                      <div className="truncate">
                        <div className="flex items-center space-x-2">
                          <span className="font-bold text-sm text-slate-900 dark:text-white truncate">
                            {tx.type === 'TRANSFER'
                              ? tx.transferKind === 'GOAL_DEPOSIT'
                                ? `Tích lũy: ${tx.goalName || 'Mục tiêu'}`
                                : tx.transferKind === 'GOAL_WITHDRAWAL'
                                ? `Rút từ hũ: ${tx.goalName || 'Mục tiêu'}`
                                : tx.transferKind === 'CREDIT_PAYMENT'
                                ? `Thanh toán thẻ: ${tx.toWalletName || 'Thẻ tín dụng'}`
                                : `Chuyển sang: ${tx.toWalletName || 'Ví'}`
                              : tx.categoryName || 'Khác'}
                          </span>

                          {/* Origin Badges */}
                          {tx.origin === 'GOAL' && (
                            <span className="px-1.5 py-0.5 bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 rounded text-[10px] font-bold border border-amber-200 dark:border-amber-800">
                              Hũ tích lũy
                            </span>
                          )}
                          {tx.origin === 'BILL_PAYMENT' && (
                            <span className="px-1.5 py-0.5 bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 rounded text-[10px] font-bold border border-purple-200 dark:border-purple-800">
                              Hóa đơn
                            </span>
                          )}

                          {/* Receipt Badge */}
                          {tx.receiptImage && (
                            <button
                              onClick={() => setReceiptToView(tx.receiptImage || null)}
                              className="flex items-center space-x-1 px-1.5 py-0.5 bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 rounded text-[10px] font-bold hover:bg-blue-100 dark:hover:bg-blue-900 transition-colors"
                              title="Bấm để xem ảnh hóa đơn"
                            >
                              <FileCheck className="w-3 h-3" />
                              <span>Hóa đơn</span>
                            </button>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          <span>{formatDate(tx.date, 'time')}</span>
                          <span>•</span>
                          <span className="font-medium text-slate-700 dark:text-slate-300">
                            {tx.walletName}
                          </span>
                          {tx.note && (
                            <>
                              <span>•</span>
                              <span className="text-slate-600 dark:text-slate-400 italic truncate max-w-xs">
                                &quot;{tx.note}&quot;
                              </span>
                            </>
                          )}
                        </div>

                        {/* Tags */}
                        {tx.tags && tx.tags.length > 0 && (
                          <div className="flex items-center space-x-1 mt-1">
                            {tx.tags.map((tag) => (
                              <span
                                key={tag}
                                className="px-2 py-0.2 text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-md"
                              >
                                #{tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Right: Amount & Actions */}
                    <div className="flex items-center space-x-4 shrink-0 ml-3">
                      <div className="text-right">
                        <span
                          className={`text-base font-black ${
                            tx.type === 'EXPENSE'
                              ? 'text-rose-600 dark:text-rose-400'
                              : tx.type === 'INCOME'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-blue-600 dark:text-blue-400'
                          }`}
                        >
                          {tx.type === 'EXPENSE' ? '-' : tx.type === 'INCOME' ? '+' : ''}
                          {formatCurrency(tx.amount)}
                        </span>
                        {tx.type === 'TRANSFER' && tx.fee && tx.fee > 0 && (
                          <p className="text-[10px] text-slate-400">Phí: {formatCurrency(tx.fee)}</p>
                        )}
                      </div>

                      {/* Edit / Delete Buttons */}
                      <div className="flex items-center space-x-1 opacity-80 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                        {tx.origin === 'GOAL' || tx.origin === 'BILL_PAYMENT' ? (
                          <span
                            className="px-2 py-1 text-[11px] text-slate-400 dark:text-slate-500 italic bg-slate-100 dark:bg-slate-800 rounded-lg cursor-not-allowed"
                            title={`Giao dịch tự động liên kết với ${tx.origin === 'GOAL' ? 'Hũ tích lũy' : 'Hóa đơn'}. Vui lòng thao tác từ mục ${tx.origin === 'GOAL' ? 'Hũ tích lũy' : 'Hóa đơn'}.`}
                          >
                            Tự động ({tx.origin === 'GOAL' ? 'Hũ' : 'Hóa đơn'})
                          </span>
                        ) : (
                          <>
                            <button
                              onClick={() => setTransactionToEdit(tx)}
                              className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded-lg transition-colors"
                              title="Chỉnh sửa giao dịch"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => {
                                if (confirm('Xác nhận xóa giao dịch này? Số dư ví sẽ được tự động hoàn lại.')) {
                                  deleteTransaction(tx.id);
                                }
                              }}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors"
                              title="Xóa giao dịch"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Modals */}
      <ReceiptModal
        isOpen={Boolean(receiptToView)}
        onClose={() => setReceiptToView(null)}
        imageUrl={receiptToView || undefined}
        title="Chi tiết ảnh hóa đơn đính kèm"
      />

      <EditTransactionModal
        isOpen={Boolean(transactionToEdit)}
        onClose={() => setTransactionToEdit(null)}
        transaction={transactionToEdit}
      />
    </div>
  );
};
