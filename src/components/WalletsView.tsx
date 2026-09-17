'use client';

import React, { useState } from 'react';
import { useApp } from '@/context/AppContext';
import { Wallet, WalletType } from '@/types';
import {
  WalletCards,
  Plus,
  ArrowRightLeft,
  Banknote,
  Building2,
  CreditCard,
  PiggyBank,
  Edit2,
  Trash2,
  DollarSign,
  Percent,
  X,
  ShieldCheck,
} from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { IconHelper } from './IconHelper';
import { VIETNAMESE_BANKS } from '@/lib/constants';

export const WalletsView: React.FC = () => {
  const {
    wallets,
    financialSummary,
    addWallet,
    editWallet,
    deleteWallet,
    transferFunds,
    openQuickAdd,
  } = useApp();

  // Modals state
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [editingWallet, setEditingWallet] = useState<Wallet | null>(null);

  const [walletName, setWalletName] = useState('');
  const [walletType, setWalletType] = useState<WalletType>('BANK');
  const [walletBalance, setWalletBalance] = useState('');
  const [walletBankName, setWalletBankName] = useState('Vietcombank');
  const [walletAccountNumber, setWalletAccountNumber] = useState('');
  const [walletCreditLimit, setWalletCreditLimit] = useState('');
  const [walletInterestRate, setWalletInterestRate] = useState('');
  const [walletColor, setWalletColor] = useState('#0ea5e9');

  // Transfer Modal state
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [fromWalletId, setFromWalletId] = useState(wallets[0]?.id || '');
  const [toWalletId, setToWalletId] = useState(wallets[1]?.id || '');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferFee, setTransferFee] = useState('0');
  const [transferNote, setTransferNote] = useState('');

  // Groups
  const cashWallets = wallets.filter((w) => w.type === 'CASH');
  const bankWallets = wallets.filter((w) => w.type === 'BANK');
  const creditWallets = wallets.filter((w) => w.type === 'CREDIT');
  const savingsWallets = wallets.filter((w) => w.type === 'SAVINGS');

  const handleStartEdit = (w: Wallet) => {
    setEditingWallet(w);
    setWalletName(w.name);
    setWalletType(w.type);
    setWalletBalance(String(w.balance));
    setWalletBankName(w.bankName || 'Vietcombank');
    setWalletAccountNumber(w.accountNumber || '');
    setWalletCreditLimit(w.creditLimit !== undefined ? String(w.creditLimit) : '');
    setWalletInterestRate(w.interestRate !== undefined ? String(w.interestRate) : '');
    setWalletColor(w.color || '#0ea5e9');
    setWalletModalOpen(true);
  };

  const handleSaveWallet = (e: React.FormEvent) => {
    e.preventDefault();
    if (!walletName.trim()) {
      alert('Vui lòng nhập tên ví');
      return;
    }

    const bal = Number(walletBalance) || 0;
    const limit = Number(walletCreditLimit) || 0;
    const interest = Number(walletInterestRate) || 0;

    let icon = 'Wallet';
    if (walletType === 'CASH') icon = 'Banknote';
    if (walletType === 'BANK') icon = 'Building2';
    if (walletType === 'CREDIT') icon = 'CreditCard';
    if (walletType === 'SAVINGS') icon = 'PiggyBank';

    if (editingWallet) {
      editWallet(editingWallet.id, {
        name: walletName,
        bankName: walletType !== 'CASH' ? walletBankName : undefined,
        accountNumber: walletAccountNumber,
        creditLimit: walletType === 'CREDIT' ? limit : undefined,
        interestRate: walletType === 'SAVINGS' ? interest : undefined,
        color: walletColor,
        icon,
      });
    } else {
      addWallet({
        name: walletName,
        type: walletType,
        balance: bal,
        initialBalance: bal,
        currency: 'VND',
        bankName: walletType !== 'CASH' ? walletBankName : undefined,
        accountNumber: walletAccountNumber,
        creditLimit: walletType === 'CREDIT' ? limit : undefined,
        interestRate: walletType === 'SAVINGS' ? interest : undefined,
        color: walletColor,
        icon,
      });
    }

    setWalletModalOpen(false);
    setEditingWallet(null);
  };

  const handleConfirmTransfer = (e: React.FormEvent) => {
    e.preventDefault();
    const amountNum = Number(transferAmount);
    if (!amountNum || amountNum <= 0 || !isFinite(amountNum)) {
      alert('Vui lòng nhập số tiền chuyển hợp lệ (> 0)');
      return;
    }
    if (fromWalletId === toWalletId) {
      alert('Ví nhận phải khác ví chuyển');
      return;
    }

    const fromW = wallets.find((w) => w.id === fromWalletId);
    const toW = wallets.find((w) => w.id === toWalletId);
    if (!fromW || !toW) {
      alert('Không tìm thấy thông tin ví');
      return;
    }

    if (fromW.type === 'CREDIT') {
      alert('Không hỗ trợ rút tiền mặt hoặc chuyển tiền từ thẻ tín dụng (Cash advance)');
      return;
    }

    const feeNum = Number(transferFee);
    if (isNaN(feeNum) || !isFinite(feeNum) || feeNum < 0) {
      alert('Phí chuyển khoản không hợp lệ (phải là số >= 0)');
      return;
    }

    if (fromW.balance < amountNum + feeNum) {
      alert('Số dư ví nguồn không đủ để thực hiện chuyển khoản');
      return;
    }

    if (toW.type === 'CREDIT' && amountNum > toW.balance) {
      alert('Số tiền thanh toán vượt quá dư nợ hiện tại của thẻ tín dụng');
      return;
    }

    transferFunds(fromWalletId, toWalletId, amountNum, feeNum, transferNote);
    setTransferModalOpen(false);
    setTransferAmount('');
    setTransferFee('0');
    setTransferNote('');
  };

  return (
    <div className="space-y-6 pb-12">
      {/* 1. HEADER & ACTIONS */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-white tracking-tight">
            Quản Lý Tài Khoản & Ví
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Quản lý mọi nguồn tiền: Tiền mặt, Ngân hàng, Thẻ tín dụng và Sổ tiết kiệm. Tự động tổng hợp số dư khả dụng và tài sản ròng
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => {
              setFromWalletId(wallets[0]?.id || '');
              const other = wallets.find((w) => w.id !== wallets[0]?.id);
              setToWalletId(other?.id || '');
              setTransferAmount('');
              setTransferFee('0');
              setTransferNote('');
              setTransferModalOpen(true);
            }}
            className="flex items-center space-x-1.5 px-3.5 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-semibold shadow-sm transition-colors"
          >
            <ArrowRightLeft className="w-4 h-4 text-blue-600" />
            <span>Chuyển khoản nội bộ</span>
          </button>

          <button
            onClick={() => {
              setEditingWallet(null);
              setWalletName('');
              setWalletType('BANK');
              setWalletBalance('');
              setWalletBankName('Vietcombank');
              setWalletAccountNumber('');
              setWalletCreditLimit('');
              setWalletInterestRate('');
              setWalletColor('#0ea5e9');
              setWalletModalOpen(true);
            }}
            className="flex items-center space-x-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>+ Tạo ví mới</span>
          </button>
        </div>
      </div>

      {/* 2. NET WORTH & ASSETS KPI */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 text-white shadow-lg">
          <span className="text-xs font-bold text-slate-400 uppercase">TỔNG TÀI SẢN RÒNG</span>
          <p className="text-2xl font-black mt-1 text-white">
            {formatCurrency(financialSummary.totalAssets)}
          </p>
          <span className="text-[11px] text-slate-300">Toàn bộ tài sản trừ nợ thẻ</span>
        </div>

        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <span className="text-xs font-semibold text-slate-400 uppercase">Số dư khả dụng</span>
          <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">
            {formatCurrency(financialSummary.availableBalance)}
          </p>
          <span className="text-[11px] text-slate-400">Tiền mặt + Tài khoản ngân hàng</span>
        </div>

        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <span className="text-xs font-semibold text-slate-400 uppercase">Tiết kiệm & Mục tiêu</span>
          <p className="text-2xl font-black text-blue-600 dark:text-blue-400 mt-1">
            {formatCurrency(financialSummary.totalSavings)}
          </p>
          <span className="text-[11px] text-slate-400">
            Sổ TK: {formatCurrency(financialSummary.walletSavings)} • Hũ: {formatCurrency(financialSummary.goalSavings)}
          </span>
        </div>

        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <span className="text-xs font-semibold text-slate-400 uppercase">Dư nợ thẻ tín dụng</span>
          <p className="text-2xl font-black text-rose-600 dark:text-rose-400 mt-1">
            {formatCurrency(financialSummary.totalCreditDebt)}
          </p>
          <span className="text-[11px] text-rose-500 font-semibold">Cần thanh toán đúng kỳ sao kê</span>
        </div>
      </div>

      {/* 3. WALLETS LIST BY GROUP */}
      <div className="space-y-6">
        {/* Nhóm 1: Tiền mặt */}
        <div>
          <div className="flex items-center space-x-2 mb-3">
            <Banknote className="w-5 h-5 text-emerald-500" />
            <h3 className="text-sm font-bold text-slate-800 dark:text-white uppercase tracking-wider">
              1. Tiền Mặt ({cashWallets.length})
            </h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {cashWallets.map((w) => (
              <WalletCard key={w.id} wallet={w} onEdit={() => handleStartEdit(w)} onDelete={() => deleteWallet(w.id)} />
            ))}
          </div>
        </div>

        {/* Nhóm 2: Tài khoản ngân hàng */}
        <div>
          <div className="flex items-center space-x-2 mb-3">
            <Building2 className="w-5 h-5 text-blue-500" />
            <h3 className="text-sm font-bold text-slate-800 dark:text-white uppercase tracking-wider">
              2. Tài Khoản Ngân Hàng ({bankWallets.length})
            </h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {bankWallets.map((w) => (
              <WalletCard key={w.id} wallet={w} onEdit={() => handleStartEdit(w)} onDelete={() => deleteWallet(w.id)} />
            ))}
          </div>
        </div>

        {/* Nhóm 3: Thẻ tín dụng */}
        <div>
          <div className="flex items-center space-x-2 mb-3">
            <CreditCard className="w-5 h-5 text-purple-500" />
            <h3 className="text-sm font-bold text-slate-800 dark:text-white uppercase tracking-wider">
              3. Thẻ Tín Dụng ({creditWallets.length})
            </h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {creditWallets.map((w) => (
              <WalletCard key={w.id} wallet={w} onEdit={() => handleStartEdit(w)} onDelete={() => deleteWallet(w.id)} />
            ))}
          </div>
        </div>

        {/* Nhóm 4: Sổ tiết kiệm */}
        <div>
          <div className="flex items-center space-x-2 mb-3">
            <PiggyBank className="w-5 h-5 text-amber-500" />
            <h3 className="text-sm font-bold text-slate-800 dark:text-white uppercase tracking-wider">
              4. Sổ Tiết Kiệm ({savingsWallets.length})
            </h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {savingsWallets.map((w) => (
              <WalletCard key={w.id} wallet={w} onEdit={() => handleStartEdit(w)} onDelete={() => deleteWallet(w.id)} />
            ))}
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* MODAL: ADD / EDIT WALLET */}
      {/* ========================================================================= */}
      {walletModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="relative max-w-md w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl p-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-lg font-bold text-slate-800 dark:text-white">
                {editingWallet ? 'Chỉnh sửa ví / tài khoản' : 'Tạo nguồn tiền mới'}
              </h3>
              <button
                onClick={() => setWalletModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveWallet} className="space-y-4 pt-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">
                  Loại nguồn tiền
                  {editingWallet && (
                    <span className="ml-1.5 text-[10px] font-normal text-amber-600 dark:text-amber-400">
                      (Không thể thay đổi loại ví sau khi tạo)
                    </span>
                  )}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { type: 'CASH', label: 'Tiền mặt' },
                    { type: 'BANK', label: 'Ngân hàng' },
                    { type: 'CREDIT', label: 'Thẻ tín dụng' },
                    { type: 'SAVINGS', label: 'Sổ tiết kiệm' },
                  ].map((t) => (
                    <button
                      key={t.type}
                      type="button"
                      disabled={!!editingWallet}
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      onClick={() => !editingWallet && setWalletType(t.type as any)}
                      className={`py-2 px-3 text-xs font-bold rounded-xl border transition-all ${
                        editingWallet
                          ? walletType === t.type
                            ? 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-600 cursor-not-allowed opacity-90'
                            : 'bg-slate-50 dark:bg-slate-800/40 text-slate-400 dark:text-slate-500 border-slate-200 dark:border-slate-800 cursor-not-allowed opacity-40'
                          : walletType === t.type
                            ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                            : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">
                  Tên hiển thị của Ví
                </label>
                <input
                  type="text"
                  required
                  value={walletName}
                  onChange={(e) => setWalletName(e.target.value)}
                  placeholder="Ví dụ: Techcombank Priority, Tiền mặt ví tay..."
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">
                  {walletType === 'CREDIT' ? 'Dư nợ hiện tại (VNĐ)' : 'Số dư hiện tại (VNĐ)'}
                  {editingWallet && (
                    <span className="ml-1.5 text-[10px] font-normal text-amber-600 dark:text-amber-400">
                      (Không thể sửa trực tiếp - số dư quản lý qua giao dịch)
                    </span>
                  )}
                </label>
                <input
                  type="number"
                  value={walletBalance}
                  onChange={(e) => setWalletBalance(e.target.value)}
                  disabled={!!editingWallet}
                  placeholder="0"
                  className={`w-full text-xl font-bold px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl dark:text-white ${
                    editingWallet ? 'opacity-60 cursor-not-allowed bg-slate-100 dark:bg-slate-800/50' : ''
                  }`}
                />
              </div>

              {walletType !== 'CASH' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">
                      Ngân hàng
                    </label>
                    <select
                      value={walletBankName}
                      onChange={(e) => setWalletBankName(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs dark:text-white"
                    >
                      {VIETNAMESE_BANKS.map((b) => (
                        <option key={b.code} value={b.name}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">
                      Số tài khoản / 4 số cuối
                    </label>
                    <input
                      type="text"
                      value={walletAccountNumber}
                      onChange={(e) => setWalletAccountNumber(e.target.value)}
                      placeholder="1903..."
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs dark:text-white"
                    />
                  </div>
                </div>
              )}

              {walletType === 'CREDIT' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">
                    Hạn mức thẻ tín dụng (VNĐ)
                  </label>
                  <input
                    type="number"
                    value={walletCreditLimit}
                    onChange={(e) => setWalletCreditLimit(e.target.value)}
                    placeholder="Ví dụ: 30000000"
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm dark:text-white"
                  />
                </div>
              )}

              {walletType === 'SAVINGS' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">
                    Lãi suất gửi (%/năm)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={walletInterestRate}
                    onChange={(e) => setWalletInterestRate(e.target.value)}
                    placeholder="Ví dụ: 6.2"
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm dark:text-white"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Màu sắc nhận diện</label>
                <div className="flex space-x-2">
                  {['#0ea5e9', '#10b981', '#ef4444', '#8b5cf6', '#007a33', '#f59e0b', '#3b82f6'].map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setWalletColor(c)}
                      className={`w-7 h-7 rounded-full transition-transform ${
                        walletColor === c ? 'scale-125 ring-2 ring-slate-400' : ''
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setWalletModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 rounded-xl"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-sm"
                >
                  Lưu ví
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: INTERNAL TRANSFER BETWEEN WALLETS */}
      {/* ========================================================================= */}
      {transferModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="relative max-w-md w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl p-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-lg font-bold text-slate-800 dark:text-white flex items-center space-x-2">
                <ArrowRightLeft className="w-5 h-5 text-blue-500" />
                <span>Chuyển khoản nội bộ</span>
              </h3>
              <button
                onClick={() => setTransferModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmTransfer} className="space-y-4 pt-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">
                  Chuyển từ Ví / Tài khoản:
                </label>
                <select
                  value={fromWalletId}
                  onChange={(e) => setFromWalletId(e.target.value)}
                  className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-semibold dark:text-white"
                >
                  {wallets.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} (Số dư: {formatCurrency(w.balance)})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">
                  Đến Ví / Tài khoản:
                </label>
                <select
                  value={toWalletId}
                  onChange={(e) => setToWalletId(e.target.value)}
                  className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-semibold dark:text-white"
                >
                  {wallets
                    .filter((w) => w.id !== fromWalletId)
                    .map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name} (Số dư: {formatCurrency(w.balance)})
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">
                  Số tiền chuyển (VNĐ)
                </label>
                <input
                  type="number"
                  required
                  autoFocus
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(e.target.value)}
                  placeholder="0"
                  className="w-full text-2xl font-bold px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">
                  Phí chuyển (nếu có)
                </label>
                <input
                  type="number"
                  value={transferFee}
                  onChange={(e) => setTransferFee(e.target.value)}
                  placeholder="0"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Ghi chú</label>
                <input
                  type="text"
                  value={transferNote}
                  onChange={(e) => setTransferNote(e.target.value)}
                  placeholder="Ví dụ: Rút tiền mặt, chuyển tiền tiết kiệm..."
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm dark:text-white"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setTransferModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 rounded-xl"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-sm"
                >
                  Thực hiện chuyển
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

interface WalletCardProps {
  wallet: Wallet;
  onEdit: () => void;
  onDelete: () => void;
}

const WalletCard: React.FC<WalletCardProps> = ({ wallet, onEdit, onDelete }) => {
  return (
    <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm relative group hover:border-slate-300 transition-all">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center space-x-3">
          <div
            className="w-11 h-11 rounded-2xl flex items-center justify-center text-white shadow-sm"
            style={{ backgroundColor: wallet.color }}
          >
            <IconHelper name={wallet.icon} size={20} />
          </div>
          <div>
            <h4 className="text-sm font-bold text-slate-800 dark:text-white">{wallet.name}</h4>
            <p className="text-[11px] text-slate-400">
              {wallet.bankName ? `${wallet.bankName} • ${wallet.accountNumber || ''}` : 'Tiền mặt'}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={onEdit}
            className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded-lg transition-colors"
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => {
              if (confirm(`Bạn có chắc muốn xóa ví ${wallet.name}?`)) {
                onDelete();
              }
            }}
            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
        <span className="text-[10px] uppercase font-semibold text-slate-400">
          {wallet.type === 'CREDIT' ? 'Dư nợ hiện tại' : 'Số dư'}
        </span>
        <p
          className={`text-xl font-black mt-0.5 ${
            wallet.type === 'CREDIT' ? 'text-rose-600 dark:text-rose-400' : 'text-slate-800 dark:text-white'
          }`}
        >
          {formatCurrency(wallet.balance)}
        </p>

        {wallet.type === 'CREDIT' && wallet.creditLimit && (
          <div className="flex justify-between text-[11px] text-slate-400 mt-2">
            <span>Hạn mức: {formatCurrency(wallet.creditLimit)}</span>
            <span className="text-emerald-500 font-semibold">
              Còn lại: {formatCurrency(Math.max(0, wallet.creditLimit - wallet.balance))}
            </span>
          </div>
        )}

        {wallet.type === 'SAVINGS' && wallet.interestRate && (
          <div className="flex justify-between text-[11px] text-slate-400 mt-2">
            <span>Lãi suất:</span>
            <span className="text-emerald-500 font-bold">{wallet.interestRate}% / năm</span>
          </div>
        )}
      </div>
    </div>
  );
};
