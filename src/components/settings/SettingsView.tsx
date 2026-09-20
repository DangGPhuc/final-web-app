'use client';

import React, { useState } from 'react';
import { useApp } from '@/context/AppContext';
import { formatDate } from '@/lib/finance/calculations';
import type { SyncResultStats } from '@/types';
import {
  Mail,
  Plus,
  RefreshCw,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  AlertCircle,
  ExternalLink,
  ShieldCheck,
} from 'lucide-react';

export function SettingsView() {
  const {
    gmailAccounts,
    disconnectGmail,
    syncEmail,
    isSyncing,
    clearFinancialData,
    factoryReset,
  } = useApp();

  // Dynamic default dates: 1st of current month to today
  const now = new Date();
  const defaultFromDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const defaultToDate = now.toISOString().slice(0, 10);

  // Historical import state
  const [selectedAccountForSync, setSelectedAccountForSync] = useState<string>('ALL');
  const [fromDate, setFromDate] = useState<string>(defaultFromDate);
  const [toDate, setToDate] = useState<string>(defaultToDate);
  const [dateError, setDateError] = useState<string | null>(null);
  const [lastSyncStats, setLastSyncStats] = useState<SyncResultStats | null>(null);

  // Modals & confirmation states
  const [disconnectingAccount, setDisconnectingAccount] = useState<string | null>(null);
  const [clearDataConfirmOpen, setClearDataConfirmOpen] = useState(false);
  const [factoryResetConfirmOpen, setFactoryResetConfirmOpen] = useState(false);
  const [isOperating, setIsOperating] = useState(false);

  // Handle Quick Scan
  const handleQuickScan = async () => {
    const stats = await syncEmail({ accountId: selectedAccountForSync });
    if (stats) setLastSyncStats(stats);
  };

  // Handle Historical Import
  const handleHistoricalImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (fromDate > toDate) {
      setDateError('Khoảng thời gian không hợp lệ: Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.');
      return;
    }
    setDateError(null);

    const stats = await syncEmail({
      accountId: selectedAccountForSync,
      fromDate,
      toDate,
    });
    if (stats) setLastSyncStats(stats);
  };

  // Handle Explicit Demo Seed
  const handleDemoSeed = async () => {
    setIsOperating(true);
    try {
      const stats = await syncEmail({
        isDemoMode: true,
        fromDate,
        toDate,
      });
      if (stats) setLastSyncStats(stats);
    } finally {
      setIsOperating(false);
    }
  };

  // Confirm Disconnect Gmail
  const handleConfirmDisconnect = async () => {
    if (!disconnectingAccount) return;
    setIsOperating(true);
    try {
      await disconnectGmail(disconnectingAccount);
      setDisconnectingAccount(null);
    } finally {
      setIsOperating(false);
    }
  };

  // Confirm Clear Financial Data
  const handleConfirmClearFinancial = async () => {
    setIsOperating(true);
    try {
      await clearFinancialData();
      setClearDataConfirmOpen(false);
      setLastSyncStats(null);
    } finally {
      setIsOperating(false);
    }
  };

  // Confirm Factory Reset
  const handleConfirmFactoryReset = async () => {
    setIsOperating(true);
    try {
      await factoryReset();
      setFactoryResetConfirmOpen(false);
      setLastSyncStats(null);
    } finally {
      setIsOperating(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl pb-10">
      <div>
        <h1 className="font-display text-2xl sm:text-3xl text-[#f5f5f7]">Cài đặt hệ thống</h1>
        <p className="text-xs text-[#9f9fa0] mt-1">
          Quản lý tài khoản Gmail liên kết, nhập lịch sử biến động ngân hàng và quản trị dữ liệu
        </p>
      </div>

      {/* A. TÀI KHOẢN GMAIL ĐÃ LIÊN KẾT */}
      <div className="cockpit-card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-[#00b3dd]" />
            <h2 className="text-sm font-medium text-[#f5f5f7]">A. TÀI KHOẢN GMAIL ĐÃ LIÊN KẾT</h2>
          </div>

          <a
            href="/api/google/connect"
            className="btn-primary text-xs flex items-center gap-1.5 py-1.5 px-3.5 shadow-none"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Thêm tài khoản Gmail</span>
          </a>
        </div>

        <p className="text-xs text-[#9f9fa0]">
          Hỗ trợ liên kết một hoặc nhiều tài khoản Gmail nhận thông báo ngân hàng qua giao thức Google OAuth 2.0 an toàn.
        </p>

        {gmailAccounts.length === 0 ? (
          <div className="p-6 rounded-xl bg-[#090a0b] border border-[#232427] text-center space-y-2">
            <div className="text-xs text-[#f5f5f7] font-medium">Chưa có tài khoản Gmail nào được liên kết</div>
            <div className="text-[11px] text-[#9f9fa0] max-w-md mx-auto">
              Bấm "+ Thêm tài khoản Gmail" để kết nối tài khoản Gmail nhận email biến động ngân hàng của bạn. Bạn cũng có thể dùng địa chỉ Gmail thứ hai nhận chuyển tiếp (forwarding).
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            {gmailAccounts.map(account => (
              <div
                key={account.id}
                className="p-4 rounded-xl bg-[#090a0b] border border-[#232427] hover:border-[#34363a] transition-colors flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {account.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={account.avatarUrl}
                      alt={account.displayName || account.email}
                      className="w-10 h-10 rounded-full border border-[#34363a] flex-shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-[#2e2e2e] text-[#f5f5f7] flex items-center justify-center text-xs font-mono font-bold flex-shrink-0">
                      {account.email.charAt(0).toUpperCase()}
                    </div>
                  )}

                  <div className="min-w-0">
                    <div className="text-xs font-medium text-[#f5f5f7] truncate">
                      {account.displayName || account.email}
                    </div>
                    <div className="text-[11px] text-[#9f9fa0] font-mono truncate">
                      {account.email}
                    </div>
                    <div className="text-[10px] text-[#6b6b70] mt-0.5">
                      Lần quét: {account.lastSyncAt ? formatDate(account.lastSyncAt, 'short') : 'Chưa quét'}
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => setDisconnectingAccount(account.id)}
                  className="btn-secondary text-xs py-1 px-2.5 text-[#9f9fa0] hover:text-[#f43f5e] hover:border-[#f43f5e]/40 whitespace-nowrap flex-shrink-0"
                >
                  Ngắt kết nối
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* B. NHẬP DỮ LIỆU EMAIL */}
      <div className="cockpit-card p-6 space-y-5">
        <div className="flex items-center gap-2">
          <RefreshCw className="w-4 h-4 text-[#10b981]" />
          <h2 className="text-sm font-medium text-[#f5f5f7]">B. NHẬP DỮ LIỆU EMAIL</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Quick Scan */}
          <div className="p-5 rounded-xl bg-[#090a0b] border border-[#232427] flex flex-col justify-between space-y-4">
            <div>
              <h3 className="text-xs font-medium text-[#f5f5f7] uppercase tracking-wider font-mono-data">
                1. QUÉT EMAIL MỚI (QUICK SCAN)
              </h3>
              <p className="text-xs text-[#9f9fa0] mt-1.5">
                Quét nhanh các email ngân hàng mới nhất kể từ lần đồng bộ thành công trước đó cho đến hiện tại.
              </p>
            </div>

            <button
              onClick={handleQuickScan}
              disabled={isSyncing}
              className="btn-primary text-xs flex items-center justify-center gap-2 py-2"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'Đang đọc email...' : 'Quét email mới'}</span>
            </button>
          </div>

          {/* Historical Import */}
          <div className="p-5 rounded-xl bg-[#090a0b] border border-[#232427] space-y-4">
            <div>
              <h3 className="text-xs font-medium text-[#f5f5f7] uppercase tracking-wider font-mono-data">
                2. NHẬP LỊCH SỬ (HISTORICAL IMPORT)
              </h3>
              <p className="text-xs text-[#9f9fa0] mt-1.5">
                Nhập lại biến động theo khoảng thời gian tùy chọn (ví dụ: từ 01/09/2026 đến 20/09/2026).
              </p>
            </div>

            <form onSubmit={handleHistoricalImport} className="space-y-3">
              {gmailAccounts.length > 1 && (
                <div>
                  <label className="text-[11px] text-[#9f9fa0] block mb-1">Tài khoản Gmail</label>
                  <select
                    value={selectedAccountForSync}
                    onChange={e => setSelectedAccountForSync(e.target.value)}
                    className="cockpit-input w-full text-xs font-mono"
                  >
                    <option value="ALL">Tất cả tài khoản liên kết</option>
                    {gmailAccounts.map(a => (
                      <option key={a.id} value={a.id}>
                        {a.email}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] text-[#9f9fa0] block mb-1">Từ ngày</label>
                  <input
                    type="date"
                    required
                    value={fromDate}
                    onChange={e => setFromDate(e.target.value)}
                    className="cockpit-input w-full text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-[#9f9fa0] block mb-1">Đến ngày</label>
                  <input
                    type="date"
                    required
                    value={toDate}
                    onChange={e => setToDate(e.target.value)}
                    className="cockpit-input w-full text-xs font-mono"
                  />
                </div>
              </div>

              {dateError && (
                <div className="p-2.5 rounded-lg bg-[#f43f5e]/15 border border-[#f43f5e]/30 text-xs text-[#f43f5e] flex items-center gap-2 animate-in fade-in duration-150">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{dateError}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={isSyncing}
                className="btn-secondary text-xs w-full py-2 flex items-center justify-center gap-1.5 font-medium hover:border-[#00b3dd] text-[#f5f5f7]"
              >
                <Calendar className="w-3.5 h-3.5 text-[#00b3dd]" />
                <span>{isSyncing ? 'Đang nhập lịch sử...' : 'Nhập lịch sử'}</span>
              </button>
            </form>
          </div>
        </div>

        {/* Sync Result Summary Card */}
        {lastSyncStats && (
          <div className="p-4 rounded-xl bg-[#090a0b] border border-[#00b3dd]/30 space-y-2 animate-in fade-in duration-200">
            <div className="flex items-center gap-2 text-xs font-medium text-[#00b3dd]">
              <CheckCircle2 className="w-4 h-4" />
              <span>{lastSyncStats.truncated ? 'Quét một phần (Chưa hết trang)' : 'Quét hoàn tất'}</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-[#232427] text-xs">
              <div>
                <span className="text-[#9f9fa0] block text-[10px] font-mono-data">ĐÃ ĐỌC</span>
                <span className="text-[#f5f5f7] font-mono font-medium">{lastSyncStats.totalFetched} email</span>
              </div>
              <div>
                <span className="text-[#9f9fa0] block text-[10px] font-mono-data">BIẾN ĐỘNG MỚI</span>
                <span className="text-[#10b981] font-mono font-medium">+{lastSyncStats.totalNew}</span>
              </div>
              <div>
                <span className="text-[#9f9fa0] block text-[10px] font-mono-data">ĐÃ TỒN TẠI</span>
                <span className="text-[#9f9fa0] font-mono font-medium">{lastSyncStats.totalDuplicates}</span>
              </div>
              <div>
                <span className="text-[#9f9fa0] block text-[10px] font-mono-data">KHÔNG ĐỌC ĐƯỢC</span>
                <span className="text-[#f59e0b] font-mono font-medium">{lastSyncStats.totalFailed}</span>
              </div>
            </div>

            {lastSyncStats.truncated && (
              <div className="p-2.5 rounded-lg bg-[#f59e0b]/15 border border-[#f59e0b]/30 text-xs text-[#f59e0b] flex items-center gap-2 mt-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>
                  Quét một phần (giới hạn an toàn): Vẫn còn email tiếp theo trên Gmail. Bạn có thể chọn khoảng ngày hẹp hơn để quét toàn bộ.
                </span>
              </div>
            )}

            {(lastSyncStats.accountEmail || lastSyncStats.dateRange) && (
              <div className="text-[11px] text-[#6b6b70] pt-1">
                {lastSyncStats.accountEmail && <span>Gmail: {lastSyncStats.accountEmail} </span>}
                {lastSyncStats.dateRange && <span>• Khoảng thời gian: {lastSyncStats.dateRange}</span>}
              </div>
            )}
          </div>
        )}
      </div>

      {/* C. QUẢN TRỊ DỮ LIỆU */}
      <div className="cockpit-card p-6 space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium text-[#f5f5f7]">
          <AlertTriangle className="w-4 h-4 text-[#f59e0b]" />
          <span>C. QUẢN TRỊ DỮ LIỆU</span>
        </div>
        <p className="text-xs text-[#9f9fa0]">
          Hỗ trợ thiết lập lại dữ liệu phục vụ buổi bảo vệ đồ án hoặc dọn dẹp số liệu cá nhân.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
          {/* Action 1: Xóa dữ liệu tài chính */}
          <div className="p-4 rounded-xl bg-[#090a0b] border border-[#232427] flex flex-col justify-between space-y-3">
            <div>
              <div className="text-xs font-medium text-[#f5f5f7]">Xóa dữ liệu tài chính</div>
              <p className="text-[11px] text-[#9f9fa0] mt-1">
                Xóa biến động ngân hàng, danh mục, quỹ và snapshot. <strong>Giữ nguyên liên kết Gmail</strong> để bạn có thể bấm "Nhập lịch sử" nạp lại bất kỳ lúc nào.
              </p>
            </div>
            <button
              onClick={() => setClearDataConfirmOpen(true)}
              className="btn-secondary text-xs text-[#f59e0b] hover:bg-[#f59e0b]/10 hover:border-[#f59e0b]/40 py-2"
            >
              Xóa dữ liệu tài chính
            </button>
          </div>

          {/* Action 2: Khôi phục hệ thống về ban đầu (Factory Reset) */}
          <div className="p-4 rounded-xl bg-[#090a0b] border border-[#f43f5e]/20 flex flex-col justify-between space-y-3">
            <div>
              <div className="text-xs font-medium text-[#f43f5e]">Khôi phục hệ thống về ban đầu</div>
              <p className="text-[11px] text-[#9f9fa0] mt-1">
                Thu hồi token Google, xóa sạch tài khoản liên kết và xóa toàn bộ dữ liệu tài chính.
              </p>
            </div>
            <button
              onClick={() => setFactoryResetConfirmOpen(true)}
              className="btn-secondary text-xs text-[#f43f5e] hover:bg-[#f43f5e]/10 hover:border-[#f43f5e]/40 py-2"
            >
              Khôi phục ban đầu (Reset toàn bộ)
            </button>
          </div>

          {/* Action 3: Nạp dữ liệu mẫu Demo */}
          <div className="p-4 rounded-xl bg-[#090a0b] border border-[#232427] flex flex-col justify-between space-y-3 sm:col-span-2">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="text-xs font-medium text-[#00b3dd] flex items-center gap-1.5">
                  <span>Nạp dữ liệu mẫu DEMO (Testing / Thuyết trình Offline)</span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-[#00b3dd]/15 text-[#00b3dd] font-mono">DEMO ONLY</span>
                </div>
                <p className="text-[11px] text-[#9f9fa0] mt-1">
                  Chỉ sử dụng khi không kết nối tài khoản Google thật. Không tự động chạy ngầm.
                </p>
              </div>
              <button
                type="button"
                onClick={handleDemoSeed}
                disabled={isOperating || isSyncing}
                className="btn-secondary text-xs text-[#00b3dd] hover:bg-[#00b3dd]/10 hover:border-[#00b3dd]/40 py-1.5 px-3 shrink-0"
              >
                {isSyncing ? 'Đang nạp...' : 'Nạp dữ liệu mẫu Demo'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation Modal: Disconnect Gmail */}
      {disconnectingAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="cockpit-card-elevated max-w-md w-full p-6 space-y-4 bg-[#17181a] border border-[#34363a]">
            <h3 className="text-base font-medium text-[#f5f5f7]">Ngắt liên kết Gmail này?</h3>
            <p className="text-xs text-[#9f9fa0] leading-relaxed">
              Các giao dịch đã nhập sẽ được giữ lại trong lịch sử tài chính của bạn. Ứng dụng sẽ không thể quét thêm email mới từ tài khoản này.
            </p>
            <div className="flex justify-end gap-2 pt-3 border-t border-[#232427]">
              <button
                onClick={() => setDisconnectingAccount(null)}
                className="btn-secondary text-xs"
              >
                Hủy
              </button>
              <button
                onClick={handleConfirmDisconnect}
                disabled={isOperating}
                className="btn-primary text-xs text-[#f43f5e] bg-transparent border border-[#f43f5e] hover:bg-[#f43f5e]/10"
              >
                {isOperating ? 'Đang ngắt...' : 'Xác nhận ngắt liên kết'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal: Clear Financial Data */}
      {clearDataConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="cockpit-card-elevated max-w-md w-full p-6 space-y-4 bg-[#17181a] border border-[#34363a]">
            <div className="flex items-center gap-2 text-[#f59e0b]">
              <AlertTriangle className="w-5 h-5" />
              <h3 className="text-base font-medium text-[#f5f5f7]">Xóa toàn bộ dữ liệu tài chính?</h3>
            </div>
            <p className="text-xs text-[#9f9fa0] leading-relaxed">
              Thao tác này sẽ xóa toàn bộ biến động ngân hàng, danh mục đã tạo và các quỹ ngân sách trong database.
              <br /><br />
              <strong className="text-[#f5f5f7]">Tài khoản Gmail vẫn được giữ lại</strong>, bạn có thể ngay lập tức bấm "Nhập lịch sử" để nạp lại giao dịch.
            </p>
            <div className="flex justify-end gap-2 pt-3 border-t border-[#232427]">
              <button
                onClick={() => setClearDataConfirmOpen(false)}
                className="btn-secondary text-xs"
              >
                Hủy
              </button>
              <button
                onClick={handleConfirmClearFinancial}
                disabled={isOperating}
                className="btn-primary text-xs text-[#f59e0b] bg-transparent border border-[#f59e0b] hover:bg-[#f59e0b]/10"
              >
                {isOperating ? 'Đang xóa...' : 'Xác nhận xóa tài chính'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal: Factory Reset */}
      {factoryResetConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="cockpit-card-elevated max-w-md w-full p-6 space-y-4 bg-[#17181a] border border-[#f43f5e]/40">
            <div className="flex items-center gap-2 text-[#f43f5e]">
              <AlertCircle className="w-5 h-5" />
              <h3 className="text-base font-medium text-[#f5f5f7]">Khôi phục hệ thống về ban đầu?</h3>
            </div>
            <p className="text-xs text-[#9f9fa0] leading-relaxed">
              Thao tác này sẽ <strong className="text-[#f43f5e]">xóa vĩnh viễn toàn bộ dữ liệu</strong>, thu hồi token truy cập với Google và xóa tất cả tài khoản Gmail đã liên kết.
            </p>
            <div className="flex justify-end gap-2 pt-3 border-t border-[#232427]">
              <button
                onClick={() => setFactoryResetConfirmOpen(false)}
                className="btn-secondary text-xs"
              >
                Hủy
              </button>
              <button
                onClick={handleConfirmFactoryReset}
                disabled={isOperating}
                className="btn-primary text-xs text-white bg-[#f43f5e] hover:bg-[#f43f5e]/90 border-none"
              >
                {isOperating ? 'Đang khôi phục...' : 'Xác nhận khôi phục cài đặt gốc'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
