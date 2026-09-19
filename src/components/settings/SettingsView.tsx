'use client';

import React, { useState } from 'react';
import { useApp } from '@/context/AppContext';
import { formatCurrency, formatDate } from '@/lib/finance/calculations';
import { DEFAULT_CATEGORIES, SUPPORTED_BANKS } from '@/lib/constants';
import {
  Mail,
  ShieldCheck,
  Sliders,
  Database,
  Trash2,
  Plus,
  RefreshCw,
  AlertTriangle,
  Info,
  CheckCircle2,
  Sparkles,
} from 'lucide-react';

export function SettingsView() {
  const {
    settings,
    updateSettings,
    emailConnection,
    syncEmail,
    merchantRules,
    addMerchantRule,
    deleteMerchantRule,
    funds,
    seedDemoData,
    clearData,
  } = useApp();

  // Local form states
  const [openingBalance, setOpeningBalance] = useState<number>(settings.openingBalance);
  const [newSender, setNewSender] = useState('');
  const [newRulePattern, setNewRulePattern] = useState('');
  const [newRuleCategory, setNewRuleCategory] = useState<string>(DEFAULT_CATEGORIES[0]);
  const [newRuleFundId, setNewRuleFundId] = useState<string>('');

  const handleSaveFinance = () => {
    updateSettings({
      openingBalance,
    });
  };

  const handleAddSender = () => {
    if (!newSender.trim()) return;
    const current = settings.trustedSenders || [];
    if (!current.includes(newSender.trim().toLowerCase())) {
      updateSettings({
        trustedSenders: [...current, newSender.trim().toLowerCase()],
      });
    }
    setNewSender('');
  };

  const handleRemoveSender = (sender: string) => {
    const current = settings.trustedSenders || [];
    updateSettings({
      trustedSenders: current.filter(s => s !== sender),
    });
  };

  const handleAddRule = () => {
    if (!newRulePattern.trim()) return;
    addMerchantRule({
      pattern: newRulePattern.trim().toLowerCase(),
      category: newRuleCategory,
      fundId: newRuleFundId || undefined,
    });
    setNewRulePattern('');
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="font-display text-2xl sm:text-3xl text-[#f5f5f7]">Cài đặt hệ thống</h1>
        <p className="text-xs text-[#9f9fa0] mt-1">
          Quản lý kết nối Email Ingestion, quy tắc tự động phân loại và tham số tài chính cá nhân
        </p>
      </div>

      {/* 1. EMAIL CONNECTION SECTION */}
      <div className="cockpit-card p-6 space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium text-[#f5f5f7]">
          <Mail className="w-4 h-4 text-[#00b3dd]" />
          <span>KẾT NỐI EMAIL (GMAIL INGESTION)</span>
        </div>

        <div className="p-4 rounded-xl bg-[#090a0b] border border-[#232427] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#f5f5f7] font-medium">Trạng thái kết nối:</span>
              <span
                className={`text-xs px-2 py-0.5 rounded font-mono ${
                  emailConnection.connected
                    ? 'bg-[#10b981]/20 text-[#10b981]'
                    : 'bg-[#f59e0b]/20 text-[#f59e0b]'
                }`}
              >
                {emailConnection.connected ? 'ĐÃ KẾT NỐI' : 'CHẾ ĐỘ TỰ ĐỘNG / DEMO'}
              </span>
            </div>
            <div className="text-xs text-[#9f9fa0] mt-1">
              {emailConnection.connected
                ? `Tài khoản Gmail: ${emailConnection.email}`
                : 'Chưa cấu hình OAuth Gmail trong .env.local. Đang sử dụng demo parser & fixture an toàn.'}
            </div>
            {emailConnection.lastSyncAt && (
              <div className="text-[11px] text-[#6b6b70] mt-0.5">
                Lần đồng bộ gần nhất: {formatDate(emailConnection.lastSyncAt, 'full')}
              </div>
            )}
          </div>

          <button
            onClick={() => syncEmail(true)}
            disabled={emailConnection.syncStatus === 'syncing'}
            className="btn-primary text-xs flex items-center justify-center gap-1.5 whitespace-nowrap"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${
                emailConnection.syncStatus === 'syncing' ? 'animate-spin' : ''
              }`}
            />
            <span>
              {emailConnection.syncStatus === 'syncing' ? 'Đang đọc...' : 'Đồng bộ ngay'}
            </span>
          </button>
        </div>

        <div className="text-xs text-[#9f9fa0] space-y-1">
          <div className="text-[#f5f5f7] font-medium">Hướng dẫn kết nối Gmail thật:</div>
          <div>
            1. Tạo ứng dụng trên Google Cloud Console & bật <code>Gmail API</code>.
          </div>
          <div>
            2. Cấp quyền chỉ đọc tối thiểu: <code>https://www.googleapis.com/auth/gmail.readonly</code>.
          </div>
          <div>
            3. Thiết lập các biến môi trường phía server trong <code>.env.local</code>:
            <pre className="mt-1 p-2 rounded bg-[#090a0b] font-mono text-[11px] text-[#00b3dd] overflow-x-auto">
              GMAIL_CLIENT_ID=...{'\n'}
              GMAIL_CLIENT_SECRET=...{'\n'}
              GMAIL_REFRESH_TOKEN=...{'\n'}
              GMAIL_USER_EMAIL=youremail@gmail.com
            </pre>
          </div>
          <div className="text-[11px] text-[#6b6b70]">
            * Token OAuth được lưu an toàn trên server, tuyệt đối KHÔNG bao giờ truyền xuống trình duyệt.
          </div>
        </div>
      </div>

      {/* 2. EMAIL PARSER & TRUSTED SENDERS */}
      <div className="cockpit-card p-6 space-y-5">
        <div className="flex items-center gap-2 text-sm font-medium text-[#f5f5f7]">
          <ShieldCheck className="w-4 h-4 text-[#10b981]" />
          <span>BỘ PHÂN TÍCH EMAIL & AN TOÀN SỐ DƯ</span>
        </div>

        {/* Confidence Threshold */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-[#9f9fa0]">
              Độ tin cậy tối thiểu để tự động ghi sổ (Auto-Post Confidence):
            </span>
            <span className="font-mono text-[#f5f5f7] font-semibold">
              {(settings.autoPostMinConfidence * 100).toFixed(0)}%
            </span>
          </div>
          <input
            type="range"
            min={0.5}
            max={1.0}
            step={0.05}
            value={settings.autoPostMinConfidence}
            onChange={e =>
              updateSettings({ autoPostMinConfidence: parseFloat(e.target.value) })
            }
            className="w-full accent-[#ffffff]"
          />
          <div className="text-[11px] text-[#9f9fa0]">
            Email từ người gửi tin cậy với độ tự tin parser ≥{' '}
            {(settings.autoPostMinConfidence * 100).toFixed(0)}% sẽ tự động được ghi sổ (POSTED).
            Dưới ngưỡng này sẽ chuyển vào hàng đợi <span className="text-[#f59e0b]">"Cần xem lại"</span> để tránh làm sai lệch số dư.
          </div>
        </div>

        {/* Trusted Senders List */}
        <div className="space-y-3 pt-3 border-t border-[#232427]">
          <label className="text-xs text-[#f5f5f7] font-medium block">
            Danh sách email người gửi tin cậy (Trusted Bank Senders)
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="VD: vietcombank@vcb.com.vn, alert@techcombank.com.vn"
              value={newSender}
              onChange={e => setNewSender(e.target.value)}
              className="cockpit-input flex-1 text-xs"
            />
            <button
              type="button"
              onClick={handleAddSender}
              className="btn-secondary text-xs flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Thêm</span>
            </button>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            {settings.trustedSenders?.map(sender => (
              <span
                key={sender}
                className="text-xs px-2.5 py-1 rounded-lg bg-[#090a0b] border border-[#232427] text-[#f5f5f7] font-mono flex items-center gap-2"
              >
                <span>{sender}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveSender(sender)}
                  className="text-[#9f9fa0] hover:text-[#f43f5e]"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>

        {/* Supported Banks Status */}
        <div className="pt-3 border-t border-[#232427] space-y-2">
          <div className="text-xs text-[#f5f5f7] font-medium">
            Trạng thái các parser ngân hàng hiện hỗ trợ:
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {SUPPORTED_BANKS.map(b => (
              <div
                key={b.code}
                className="p-2 rounded-lg bg-[#090a0b] border border-[#232427] flex items-center justify-between text-xs"
              >
                <span className="text-[#f5f5f7]">{b.name}</span>
                <span
                  className={`text-[10px] font-mono ${
                    b.parserSupported ? 'text-[#10b981]' : 'text-[#6b6b70]'
                  }`}
                >
                  {b.parserSupported ? 'SẴN SÀNG' : 'GENERIC'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 3. AUTO CLASSIFICATION & MERCHANT RULES */}
      <div className="cockpit-card p-6 space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium text-[#f5f5f7]">
          <Sliders className="w-4 h-4 text-[#847dff]" />
          <span>QUY TẮC TỰ ĐỘNG PHÂN LOẠI & GÁN QUỸ</span>
        </div>
        <p className="text-xs text-[#9f9fa0]">
          Khi nội dung email hoặc giao dịch chứa từ khóa đối tác, tự động xếp vào danh mục và quỹ tương ứng.
        </p>

        {/* Add New Rule Form */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
          <input
            type="text"
            placeholder="Từ khóa (VD: grab, highland...)"
            value={newRulePattern}
            onChange={e => setNewRulePattern(e.target.value)}
            className="cockpit-input text-xs"
          />
          <select
            value={newRuleCategory}
            onChange={e => setNewRuleCategory(e.target.value)}
            className="cockpit-input text-xs"
          >
            {DEFAULT_CATEGORIES.map(c => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={newRuleFundId}
            onChange={e => setNewRuleFundId(e.target.value)}
            className="cockpit-input text-xs"
          >
            <option value="">-- Không gắn quỹ --</option>
            {funds.map(f => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleAddRule}
            className="btn-secondary text-xs flex items-center justify-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Thêm quy tắc</span>
          </button>
        </div>

        {/* Existing Rules */}
        <div className="divide-y divide-[#232427] pt-2">
          {merchantRules.length === 0 ? (
            <div className="py-4 text-center text-xs text-[#9f9fa0]">
              Chưa có quy tắc tự động nào được thêm.
            </div>
          ) : (
            merchantRules.map(rule => {
              const mappedFund = funds.find(f => f.id === rule.fundId);
              return (
                <div
                  key={rule.id}
                  className="py-2.5 flex items-center justify-between text-xs hover:bg-[#1f2022]/40 px-2 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-[#00b3dd]">@{rule.pattern}</span>
                    <span className="text-[#9f9fa0]">→</span>
                    <span className="text-[#f5f5f7]">{rule.category}</span>
                    {mappedFund && (
                      <span className="text-[11px] px-2 py-0.5 rounded bg-[#2e2e2e] text-[#f5f5f7]">
                        {mappedFund.name}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => deleteMerchantRule(rule.id)}
                    className="text-[#9f9fa0] hover:text-[#f43f5e] p-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 4. PERSONAL FINANCE SETTINGS */}
      <div className="cockpit-card p-6 space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium text-[#f5f5f7]">
          <Database className="w-4 h-4 text-[#f5f5f7]" />
          <span>THAM SỐ TÀI CHÍNH CÁ NHÂN</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-[#9f9fa0] block mb-1">
              Số dư ban đầu (Opening Balance - VND)
            </label>
            <input
              type="number"
              step={100000}
              value={openingBalance}
              onChange={e => setOpeningBalance(parseFloat(e.target.value) || 0)}
              className="cockpit-input w-full text-xs font-mono"
            />
            <div className="text-[11px] text-[#9f9fa0] mt-1">
              Số dư hiện tại = Số dư ban đầu + Tiền vào - Tiền ra
            </div>
          </div>

          <div>
            <label className="text-xs text-[#9f9fa0] block mb-1">Đơn vị tiền tệ mặc định</label>
            <input
              type="text"
              disabled
              value="VND (Việt Nam Đồng)"
              className="cockpit-input w-full text-xs opacity-60 font-mono"
            />
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={handleSaveFinance}
            className="btn-primary text-xs"
          >
            Lưu tham số tài chính
          </button>
        </div>
      </div>

      {/* 5. DATA MANAGEMENT & DEMO SEED */}
      <div className="cockpit-card p-6 space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium text-[#f5f5f7]">
          <Database className="w-4 h-4 text-[#f43f5e]" />
          <span>QUẢN TRỊ DỮ LIỆU CỤC BỘ</span>
        </div>
        <p className="text-xs text-[#9f9fa0]">
          Toàn bộ dữ liệu được lưu trữ trực tiếp trên thiết bị (LocalStorage Adapter v3). Không gửi thông tin tài chính cá nhân lên bất kỳ database đám mây nào.
        </p>

        <div className="flex flex-wrap gap-3 pt-2">
          {/* Seed Demo Data button */}
          <button
            type="button"
            onClick={seedDemoData}
            className="btn-secondary text-xs flex items-center gap-1.5"
          >
            <Sparkles className="w-3.5 h-3.5 text-[#00b3dd]" />
            <span>Nạp dữ liệu mẫu thử nghiệm (Seed Demo)</span>
          </button>

          {/* Reset / Clear Data button */}
          <button
            type="button"
            onClick={() => {
              if (window.confirm('Bạn có chắc chắn muốn xóa toàn bộ dữ liệu tài chính cục bộ?')) {
                clearData();
              }
            }}
            className="text-xs px-4 py-2 rounded-lg bg-[#f43f5e]/10 hover:bg-[#f43f5e]/20 text-[#f43f5e] border border-[#f43f5e]/30 transition-colors flex items-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Xóa sạch dữ liệu cục bộ</span>
          </button>
        </div>
      </div>
    </div>
  );
}
