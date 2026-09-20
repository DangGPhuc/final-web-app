'use client';

import React from 'react';
import { useApp } from '@/context/AppContext';
import { formatCurrency, formatDate } from '@/lib/finance/calculations';
import {
  ArrowDownLeft,
  ArrowUpRight,
  RefreshCw,
  Tag,
  CheckCircle2,
  Sparkles,
  Layers,
} from 'lucide-react';

export function DashboardView() {
  const {
    balance,
    currentMonthCashflow,
    transactions,
    unclassifiedTransactions,
    setClassifyingTransaction,
    syncEmail,
    isSyncing,
    setActiveTab,
  } = useApp();

  const recentClassified = transactions
    .filter(t => t.classificationState === 'CLASSIFIED')
    .slice(0, 5);

  return (
    <div className="space-y-6">
      {/* Primary Balance Card */}
      <div className="cockpit-card p-6 sm:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="font-mono-data text-xs text-[#9f9fa0] mb-2 tracking-wider">
              TỔNG SỐ DƯ TÀI CHÍNH
            </div>
            <div className="text-3xl sm:text-5xl font-light text-[#f5f5f7] tracking-tight font-mono">
              {formatCurrency(balance)}
            </div>
            <div className="text-xs text-[#9f9fa0] mt-2">
              Sổ cái ngân hàng tự động cập nhật ngay khi đọc email — Phân loại không làm đổi số dư
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => syncEmail()}
              disabled={isSyncing}
              className="btn-secondary text-xs flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin text-[#00b3dd]' : ''}`} />
              <span>{isSyncing ? 'Đang đọc email...' : 'Quét Gmail'}</span>
            </button>
          </div>
        </div>

        {/* Current Month Cashflow Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-8 pt-6 border-t border-[#232427]">
          <div className="p-4 rounded-xl bg-[#090a0b]/60 border border-[#232427]">
            <div className="flex items-center justify-between text-xs text-[#9f9fa0] mb-1">
              <span className="font-mono-data">TIỀN VÀO THÁNG NÀY</span>
              <ArrowDownLeft className="w-3.5 h-3.5 text-[#10b981]" />
            </div>
            <div className="text-xl font-medium text-[#10b981] font-mono">
              +{formatCurrency(currentMonthCashflow.totalIn)}
            </div>
          </div>

          <div className="p-4 rounded-xl bg-[#090a0b]/60 border border-[#232427]">
            <div className="flex items-center justify-between text-xs text-[#9f9fa0] mb-1">
              <span className="font-mono-data">TIỀN RA THÁNG NÀY</span>
              <ArrowUpRight className="w-3.5 h-3.5 text-[#f43f5e]" />
            </div>
            <div className="text-xl font-medium text-[#f43f5e] font-mono">
              -{formatCurrency(currentMonthCashflow.totalOut)}
            </div>
          </div>

          <div className="p-4 rounded-xl bg-[#090a0b]/60 border border-[#232427]">
            <div className="flex items-center justify-between text-xs text-[#9f9fa0] mb-1">
              <span className="font-mono-data">NET THÁNG NÀY</span>
              <span
                className={`text-xs font-mono ${
                  currentMonthCashflow.net >= 0 ? 'text-[#10b981]' : 'text-[#f43f5e]'
                }`}
              >
                {currentMonthCashflow.net >= 0 ? 'DƯ' : 'ÂM'}
              </span>
            </div>
            <div
              className={`text-xl font-medium font-mono ${
                currentMonthCashflow.net >= 0 ? 'text-[#f5f5f7]' : 'text-[#f43f5e]'
              }`}
            >
              {currentMonthCashflow.net >= 0 ? '+' : ''}
              {formatCurrency(currentMonthCashflow.net)}
            </div>
          </div>
        </div>
      </div>

      {/* Section 1: Biến Động Cần Phân Loại (Top Priority Inbox) */}
      <div className="cockpit-card p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-medium text-[#f5f5f7]">Biến động cần phân loại</h2>
            {unclassifiedTransactions.length > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-[#00b3dd]/20 text-[#00b3dd] font-mono">
                {unclassifiedTransactions.length}
              </span>
            )}
          </div>
          <span className="text-xs text-[#9f9fa0]">
            Các giao dịch ngân hàng đã ghi sổ, chờ bạn gắn danh mục & quỹ
          </span>
        </div>

        {unclassifiedTransactions.length === 0 ? (
          <div className="py-8 text-center text-xs text-[#9f9fa0] flex flex-col items-center justify-center gap-2">
            <CheckCircle2 className="w-6 h-6 text-[#10b981] opacity-60" />
            <span>Tuyệt vời! Toàn bộ biến động số dư đã được phân loại đầy đủ.</span>
          </div>
        ) : (
          <div className="divide-y divide-[#232427]">
            {unclassifiedTransactions.map(tx => {
              const isIn = tx.direction === 'IN';
              return (
                <div
                  key={tx.id}
                  className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-[#1f2022]/40 px-3 rounded-xl transition-colors border border-transparent hover:border-[#2e2e2e]"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${
                        isIn
                          ? 'bg-[#10b981]/15 text-[#10b981]'
                          : 'bg-[#f43f5e]/15 text-[#f43f5e]'
                      }`}
                    >
                      {isIn ? (
                        <ArrowDownLeft className="w-4 h-4" />
                      ) : (
                        <ArrowUpRight className="w-4 h-4" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] font-mono font-medium px-1.5 py-0.5 rounded bg-[#2e2e2e] text-[#f5f5f7]">
                          {tx.bankName || tx.bankCode || 'NGÂN HÀNG'}
                        </span>
                        {tx.accountHint && (
                          <span className="text-[11px] font-mono text-[#9f9fa0]">
                            {tx.accountHint}
                          </span>
                        )}
                        <span className="text-[11px] text-[#6b6b70]">
                          {formatDate(tx.occurredAt, 'short')}
                        </span>
                      </div>

                      <div className="text-xs text-[#f5f5f7] font-medium mt-1 truncate">
                        {tx.summary || tx.counterparty || 'Biến động tài khoản'}
                      </div>

                      {tx.merchantLabel && (
                        <div className="flex items-center gap-1 text-[11px] text-[#00b3dd] mt-0.5">
                          <Sparkles className="w-3 h-3" />
                          <span>Đối tác: {tx.merchantLabel}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-4 flex-shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-[#1f2022]">
                    <div
                      className={`text-sm font-mono font-medium ${
                        isIn ? 'text-[#10b981]' : 'text-[#f5f5f7]'
                      }`}
                    >
                      {isIn ? '+' : '-'}
                      {formatCurrency(tx.amount, tx.currency)}
                    </div>

                    <button
                      onClick={() => setClassifyingTransaction(tx)}
                      className="btn-primary text-xs py-1 px-3 flex items-center gap-1.5 font-medium whitespace-nowrap"
                    >
                      <Tag className="w-3 h-3" />
                      <span>Phân loại</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Section 2: Biến Động Đã Phân Loại Gần Đây */}
      {recentClassified.length > 0 && (
        <div className="cockpit-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-medium text-[#f5f5f7]">Biến động đã phân loại gần đây</h2>
            <button
              onClick={() => setActiveTab('cashflow')}
              className="text-xs text-[#00b3dd] hover:underline"
            >
              Xem tất cả dòng tiền →
            </button>
          </div>

          <div className="divide-y divide-[#232427]">
            {recentClassified.map(tx => {
              const isIn = tx.direction === 'IN';
              return (
                <div
                  key={tx.id}
                  className="py-3 flex items-center justify-between gap-4 hover:bg-[#1f2022]/40 px-2 rounded-lg transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        isIn
                          ? 'bg-[#10b981]/10 text-[#10b981]'
                          : 'bg-[#f43f5e]/10 text-[#f43f5e]'
                      }`}
                    >
                      {isIn ? (
                        <ArrowDownLeft className="w-3.5 h-3.5" />
                      ) : (
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-[#f5f5f7] truncate">
                        {tx.summary || tx.counterparty}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-[#9f9fa0]">
                        <span>{formatDate(tx.occurredAt, 'short')}</span>
                        {tx.category && (
                          <>
                            <span>•</span>
                            <span className="text-[#f5f5f7]">{tx.category.name}</span>
                          </>
                        )}
                        {tx.fund && (
                          <>
                            <span>•</span>
                            <span className="text-[#00b3dd]">{tx.fund.name}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="text-right flex-shrink-0">
                    <div
                      className={`text-xs font-medium font-mono ${
                        isIn ? 'text-[#10b981]' : 'text-[#f5f5f7]'
                      }`}
                    >
                      {isIn ? '+' : '-'}
                      {formatCurrency(tx.amount, tx.currency)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
