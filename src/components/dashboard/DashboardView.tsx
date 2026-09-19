'use client';

import React from 'react';
import { useApp } from '@/context/AppContext';
import { formatCurrency, formatDate } from '@/lib/finance/calculations';
import {
  ArrowDownLeft,
  ArrowUpRight,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Mail,
} from 'lucide-react';

export function DashboardView() {
  const {
    balance,
    currentMonthCashflow,
    transactions,
    emailConnection,
    syncEmail,
    needsReviewTransactions,
    setActiveTab,
  } = useApp();

  // Recent 6 transactions
  const recentTransactions = transactions.slice(0, 6);

  return (
    <div className="space-y-6">
      {/* Unobtrusive Needs Review Alert */}
      {needsReviewTransactions.length > 0 && (
        <div className="flex items-center justify-between p-4 rounded-xl bg-[#f59e0b]/10 border border-[#f59e0b]/20 text-[#f59e0b]">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <div className="text-xs">
              <span className="font-semibold">
                {needsReviewTransactions.length} giao dịch cần xem lại:
              </span>{' '}
              <span className="text-[#f59e0b]/80">
                Email từ ngân hàng có độ tin cậy chưa tuyệt đối, chưa tự động ghi vào số dư.
              </span>
            </div>
          </div>
          <button
            onClick={() => setActiveTab('cashflow')}
            className="text-xs px-3 py-1 rounded bg-[#f59e0b]/20 hover:bg-[#f59e0b]/30 font-medium transition-colors"
          >
            Xem & Duyệt
          </button>
        </div>
      )}

      {/* Primary Balance Card */}
      <div className="cockpit-card p-6 sm:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="font-mono-data text-xs text-[#9f9fa0] mb-2 tracking-wider">
              TỔNG SỐ DƯ TÀI CHÍNH
            </div>
            <div className="text-3xl sm:text-5xl font-light text-[#f5f5f7] tracking-tight">
              {formatCurrency(balance)}
            </div>
            <div className="text-xs text-[#9f9fa0] mt-2">
              Số dư thực tế (Authoritative Balance) = Số dư ban đầu + Tiền vào - Tiền ra
            </div>
          </div>

          {/* Email Sync Status Badge */}
          <div className="flex flex-col items-start sm:items-end gap-2 bg-[#090a0b] p-3.5 rounded-xl border border-[#232427]">
            <div className="flex items-center gap-2 text-xs">
              <Mail className="w-3.5 h-3.5 text-[#00b3dd]" />
              <span className="text-[#f5f5f7] font-medium">Email Ingestion</span>
              <span
                className={`w-2 h-2 rounded-full ${
                  emailConnection.connected ? 'bg-[#10b981]' : 'bg-[#f59e0b]'
                }`}
              />
            </div>
            <div className="text-[11px] text-[#9f9fa0]">
              {emailConnection.lastSyncAt
                ? `Đồng bộ: ${formatDate(emailConnection.lastSyncAt, 'short')}`
                : 'Chưa đồng bộ'}
            </div>
            <button
              onClick={() => syncEmail(true)}
              disabled={emailConnection.syncStatus === 'syncing'}
              className="flex items-center gap-1.5 text-[11px] text-[#00b3dd] hover:underline"
            >
              <RefreshCw
                className={`w-3 h-3 ${
                  emailConnection.syncStatus === 'syncing' ? 'animate-spin' : ''
                }`}
              />
              <span>{emailConnection.syncStatus === 'syncing' ? 'Đang đọc email...' : 'Đồng bộ ngay'}</span>
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
            <div className="text-xl font-medium text-[#10b981]">
              +{formatCurrency(currentMonthCashflow.totalIn)}
            </div>
          </div>

          <div className="p-4 rounded-xl bg-[#090a0b]/60 border border-[#232427]">
            <div className="flex items-center justify-between text-xs text-[#9f9fa0] mb-1">
              <span className="font-mono-data">TIỀN RA THÁNG NÀY</span>
              <ArrowUpRight className="w-3.5 h-3.5 text-[#f43f5e]" />
            </div>
            <div className="text-xl font-medium text-[#f43f5e]">
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
              className={`text-xl font-medium ${
                currentMonthCashflow.net >= 0 ? 'text-[#f5f5f7]' : 'text-[#f43f5e]'
              }`}
            >
              {currentMonthCashflow.net >= 0 ? '+' : ''}
              {formatCurrency(currentMonthCashflow.net)}
            </div>
          </div>
        </div>
      </div>

      {/* Recent Balance Movements */}
      <div className="cockpit-card p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-medium text-[#f5f5f7]">Biến động gần đây</h2>
            <p className="text-xs text-[#9f9fa0]">
              Các giao dịch mới nhất đã được ghi nhận vào số dư
            </p>
          </div>
          <button
            onClick={() => setActiveTab('cashflow')}
            className="text-xs text-[#00b3dd] hover:underline"
          >
            Xem tất cả dòng tiền →
          </button>
        </div>

        {recentTransactions.length === 0 ? (
          <div className="py-12 text-center text-xs text-[#9f9fa0]">
            Chưa có giao dịch nào được ghi nhận. Bấm <span className="text-[#ffffff]">"Ghi chép"</span> hoặc{' '}
            <span className="text-[#00b3dd]">"Đồng bộ"</span> để bắt đầu.
          </div>
        ) : (
          <div className="divide-y divide-[#232427]">
            {recentTransactions.map(tx => {
              const isIn = tx.direction === 'IN';
              return (
                <div
                  key={tx.id}
                  className="py-3 flex items-center justify-between gap-4 hover:bg-[#1f2022]/40 px-2 rounded-lg transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        isIn
                          ? 'bg-[#10b981]/10 text-[#10b981]'
                          : 'bg-[#f43f5e]/10 text-[#f43f5e]'
                      }`}
                    >
                      {isIn ? (
                        <ArrowDownLeft className="w-4 h-4" />
                      ) : (
                        <ArrowUpRight className="w-4 h-4" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-[#f5f5f7] truncate">
                        {tx.description}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-[#9f9fa0]">
                        <span>{formatDate(tx.occurredAt, 'short')}</span>
                        {tx.category && (
                          <>
                            <span>•</span>
                            <span>{tx.category}</span>
                          </>
                        )}
                        {tx.bank && (
                          <>
                            <span>•</span>
                            <span className="font-mono">{tx.bank}</span>
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
                    <div className="text-[10px] text-[#9f9fa0]">
                      {tx.source === 'EMAIL' ? (
                        <span className="flex items-center justify-end gap-1 text-[#00b3dd]">
                          <Mail className="w-2.5 h-2.5" /> Email
                        </span>
                      ) : (
                        'Thủ công'
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
