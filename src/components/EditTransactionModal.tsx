'use client';

import React, { useState, useEffect } from 'react';
import { useApp } from '@/context/AppContext';
import { Transaction, TransactionType } from '@/types';
import { X, Upload, Trash2, Calendar, Tag, FileText, ArrowRightLeft, DollarSign } from 'lucide-react';
import { POPULAR_TAGS } from '@/lib/constants';
import { toLocalDateTimeInputValue, localDateTimeInputToISO, validateReceiptFile } from '@/lib/utils';

interface EditTransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  transaction: Transaction | null;
}

export const EditTransactionModal: React.FC<EditTransactionModalProps> = ({
  isOpen,
  onClose,
  transaction,
}) => {
  const { wallets, categories, editTransaction, deleteTransaction } = useApp();

  const [type, setType] = useState<TransactionType>('EXPENSE');
  const [amount, setAmount] = useState<number>(0);
  const [categoryId, setCategoryId] = useState<string>('');
  const [walletId, setWalletId] = useState<string>('');
  const [toWalletId, setToWalletId] = useState<string>('');
  const [fee, setFee] = useState<number>(0);
  const [date, setDate] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [tags, setTags] = useState<string[]>([]);
  const [receiptImage, setReceiptImage] = useState<string | undefined>(undefined);
  const [receiptError, setReceiptError] = useState<string | null>(null);

  useEffect(() => {
    if (transaction) {
      setType(transaction.type);
      setAmount(transaction.amount);
      setCategoryId(transaction.categoryId || '');
      setWalletId(transaction.walletId || (wallets[0]?.id ?? ''));
      setToWalletId(transaction.toWalletId || '');
      setFee(transaction.fee || 0);
      setDate(transaction.date ? toLocalDateTimeInputValue(transaction.date) : toLocalDateTimeInputValue());
      setNote(transaction.note || '');
      setTags(transaction.tags || []);
      setReceiptImage(transaction.receiptImage);
      setReceiptError(null);
    }
  }, [transaction, wallets]);

  if (!isOpen || !transaction) return null;

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    setReceiptError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const validation = validateReceiptFile(file);
    if (!validation.valid) {
      const err = validation.error || 'Tập tin hình ảnh không hợp lệ';
      setReceiptError(err);
      alert(err);
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      setReceiptImage(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleTagToggle = (tag: string) => {
    if (tags.includes(tag)) {
      setTags(tags.filter((t) => t !== tag));
    } else {
      setTags([...tags, tag]);
    }
  };

  const isSystemTx = transaction.origin === 'GOAL' || transaction.origin === 'BILL_PAYMENT';

  const handleSave = () => {
    if (isSystemTx) {
      alert('Không thể chỉnh sửa trực tiếp giao dịch tự động của hệ thống (Hũ tích lũy / Hóa đơn).');
      return;
    }

    if (!amount || amount <= 0) {
      alert('Vui lòng nhập số tiền hợp lệ');
      return;
    }

    const isoDate = localDateTimeInputToISO(date);
    if (!isoDate) {
      alert('Thời gian giao dịch không hợp lệ hoặc ngày trong lịch không tồn tại (ví dụ: ngày 31/02). Vui lòng chọn lại.');
      return;
    }

    const selectedWallet = wallets.find((w) => w.id === walletId);
    const selectedToWallet = wallets.find((w) => w.id === toWalletId);
    const selectedCategory = categories.find((c) => c.id === categoryId);

    const res = editTransaction(transaction.id, {
      type,
      amount: Number(amount),
      categoryId: type === 'TRANSFER' ? undefined : categoryId,
      categoryName: type === 'TRANSFER' ? undefined : (selectedCategory?.name || 'Khác'),
      walletId,
      walletName: selectedWallet?.name,
      toWalletId: type === 'TRANSFER' ? toWalletId : undefined,
      toWalletName: type === 'TRANSFER' ? selectedToWallet?.name : undefined,
      fee: type === 'TRANSFER' ? Number(fee) : 0,
      date: isoDate,
      note,
      tags,
      receiptImage,
    });

    if (res && !res.ok) {
      return;
    }

    onClose();
  };

  const handleDelete = () => {
    if (isSystemTx) {
      alert('Không thể xóa trực tiếp giao dịch tự động của hệ thống (Hũ tích lũy / Hóa đơn).');
      return;
    }

    if (confirm('Bạn có chắc chắn muốn xóa giao dịch này? Số dư ví sẽ được tự động hoàn tác.')) {
      const res = deleteTransaction(transaction.id);
      if (res && !res.ok) {
        return;
      }
      onClose();
    }
  };

  const filteredCategories = categories.filter((c) => c.type === (type === 'INCOME' ? 'INCOME' : 'EXPENSE'));
  const selectableWallets = type === 'INCOME' ? wallets.filter((w) => w.type !== 'CREDIT') : wallets;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="relative max-w-xl w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden my-8">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800">
          <h2 className="text-xl font-bold text-slate-800 dark:text-white">Chỉnh sửa Giao dịch</h2>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
          {isSystemTx && (
            <div className="p-3.5 bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-800 rounded-xl text-xs text-amber-900 dark:text-amber-200">
              <strong>Giao dịch tự động của hệ thống:</strong> Giao dịch này liên kết với{' '}
              {transaction.origin === 'GOAL' ? 'Hũ tích lũy' : 'Hóa đơn định kỳ'}. Để bảo toàn tính toàn vẹn tài chính, giao dịch không thể chỉnh sửa hoặc xóa trực tiếp từ sổ giao dịch. Vui lòng thao tác từ mục tương ứng.
            </div>
          )}
          {/* Type Selector */}
          <div className="grid grid-cols-3 gap-2 bg-slate-100 dark:bg-slate-800/60 p-1.5 rounded-xl">
            <button
              type="button"
              onClick={() => setType('EXPENSE')}
              className={`py-2 text-sm font-semibold rounded-lg transition-all ${
                type === 'EXPENSE'
                  ? 'bg-rose-500 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Khoản chi
            </button>
            <button
              type="button"
              onClick={() => {
                setType('INCOME');
                const currentW = wallets.find((w) => w.id === walletId);
                if (currentW?.type === 'CREDIT') {
                  const nonCredit = wallets.find((w) => w.type !== 'CREDIT');
                  if (nonCredit) setWalletId(nonCredit.id);
                }
              }}
              className={`py-2 text-sm font-semibold rounded-lg transition-all ${
                type === 'INCOME'
                  ? 'bg-emerald-500 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Khoản thu
            </button>
            <button
              type="button"
              onClick={() => setType('TRANSFER')}
              className={`py-2 text-sm font-semibold rounded-lg transition-all ${
                type === 'TRANSFER'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Chuyển khoản
            </button>
          </div>

          {/* Amount */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
              Số tiền (VNĐ)
            </label>
            <div className="relative">
              <input
                type="number"
                value={amount || ''}
                onChange={(e) => setAmount(Number(e.target.value))}
                placeholder="0"
                className="w-full text-2xl font-bold px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none dark:text-white"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-semibold">₫</span>
            </div>
          </div>

          {/* Wallet */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                {type === 'TRANSFER' ? 'Từ ví / tài khoản' : 'Ví thanh toán'}
              </label>
              <select
                value={walletId}
                onChange={(e) => setWalletId(e.target.value)}
                className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none text-sm"
              >
                {selectableWallets.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({new Intl.NumberFormat('vi-VN').format(w.balance)} ₫)
                  </option>
                ))}
              </select>
            </div>

            {type === 'TRANSFER' ? (
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                  Đến ví / tài khoản
                </label>
                <select
                  value={toWalletId}
                  onChange={(e) => setToWalletId(e.target.value)}
                  className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none text-sm"
                >
                  <option value="">-- Chọn ví đích --</option>
                  {wallets
                    .filter((w) => w.id !== walletId)
                    .map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                </select>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                  Danh mục
                </label>
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none text-sm"
                >
                  <option value="">-- Chọn danh mục --</option>
                  {filteredCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Date & Time */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
              Thời gian giao dịch
            </label>
            <input
              type="datetime-local"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none text-sm"
            />
          </div>

          {/* Note */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
              Ghi chú
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Nhập ghi chú chi tiết..."
              className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none text-sm"
            />
          </div>

          {/* Tags */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
              Nhãn (Tags)
            </label>
            <div className="flex flex-wrap gap-1.5">
              {POPULAR_TAGS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => handleTagToggle(tag)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                    tags.includes(tag)
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
                  }`}
                >
                  #{tag}
                </button>
              ))}
            </div>
          </div>

          {/* Receipt Image */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
              Ảnh hóa đơn / chứng từ
            </label>
            {receiptImage ? (
              <div className="relative inline-block border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={receiptImage} alt="Hóa đơn" className="h-32 object-contain bg-slate-100 dark:bg-slate-800" />
                <button
                  type="button"
                  onClick={() => setReceiptImage(undefined)}
                  className="absolute top-2 right-2 p-1.5 bg-rose-600 text-white rounded-lg hover:bg-rose-700 transition-colors shadow"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center p-4 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl cursor-pointer hover:border-blue-500 transition-colors">
                <Upload className="w-6 h-6 text-slate-400 mb-1" />
                <span className="text-xs text-slate-500 dark:text-slate-400">Tải ảnh hóa đơn lên (JPG, PNG, WebP)</span>
                <span className="text-[11px] text-slate-400 mt-0.5">Tối đa 1MB</span>
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleImageUpload} className="hidden" />
              </label>
            )}
            {receiptError && (
              <p className="text-xs text-rose-500 font-medium mt-1">{receiptError}</p>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
          <button
            type="button"
            disabled={isSystemTx}
            onClick={handleDelete}
            className={`flex items-center space-x-1.5 px-4 py-2.5 rounded-xl font-medium text-sm transition-colors ${
              isSystemTx
                ? 'text-slate-400 cursor-not-allowed opacity-50'
                : 'text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40'
            }`}
          >
            <Trash2 className="w-4 h-4" />
            <span>Xóa giao dịch</span>
          </button>

          <div className="flex items-center space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-xl font-medium text-sm transition-colors"
            >
              Đóng
            </button>
            <button
              type="button"
              disabled={isSystemTx}
              onClick={handleSave}
              className={`px-5 py-2.5 font-medium rounded-xl text-sm transition-colors shadow-sm ${
                isSystemTx
                  ? 'bg-slate-400 text-white cursor-not-allowed opacity-50'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
            >
              Lưu thay đổi
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
