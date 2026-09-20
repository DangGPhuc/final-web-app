'use client';

import React, { useState } from 'react';
import type { BankTransaction, Category, Fund } from '@/types';
import { formatCurrency, formatDate } from '@/lib/finance/calculations';
import {
  X,
  Tag,
  Layers,
  ArrowDownLeft,
  ArrowUpRight,
  Plus,
  Building,
  CreditCard,
  Clock,
  Sparkles,
  AlertTriangle,
} from 'lucide-react';

interface ClassificationModalProps {
  transaction: BankTransaction | null;
  categories: Category[];
  funds: Fund[];
  onClose: () => void;
  onClassify: (
    transactionId: string,
    categoryName: string,
    fundId?: string
  ) => Promise<void>;
}

export function ClassificationModal({
  transaction,
  categories,
  funds,
  onClose,
  onClassify,
}: ClassificationModalProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>(
    transaction?.category?.name || (categories[0]?.name ?? '__NEW__')
  );
  const [customCategoryName, setCustomCategoryName] = useState<string>('');
  const [selectedFundId, setSelectedFundId] = useState<string>(
    transaction?.fundId || ''
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!transaction) return null;

  const isIn = transaction.direction === 'IN';
  const isCustomMode = selectedCategory === '__NEW__';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalCategoryName = isCustomMode
      ? customCategoryName.trim()
      : selectedCategory;

    if (!finalCategoryName) return;

    setIsSubmitting(true);
    setError(null);
    try {
      await onClassify(
        transaction.id,
        finalCategoryName,
        !isIn && selectedFundId ? selectedFundId : undefined
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi phân loại giao dịch');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="cockpit-card-elevated max-w-lg w-full p-6 space-y-5 border border-[#34363a] bg-[#17181a]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#232427] pb-3">
          <div className="flex items-center gap-2">
            <Tag className="w-4 h-4 text-[#00b3dd]" />
            <h2 className="text-base font-medium text-[#f5f5f7]">
              Phân loại biến động số dư
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-[#9f9fa0] hover:text-[#f5f5f7] p-1 rounded-md transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Read-Only Transaction Facts */}
        <div className="p-4 rounded-xl bg-[#090a0b] border border-[#232427] space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div
                className={`w-7 h-7 rounded-lg flex items-center justify-center ${
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
              <div>
                <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-[#232427] text-[#9f9fa0]">
                  {transaction.bankName || transaction.bankCode || 'Ngân hàng'}
                </span>
                {transaction.accountHint && (
                  <span className="text-xs font-mono text-[#6b6b70] ml-2">
                    {transaction.accountHint}
                  </span>
                )}
              </div>
            </div>

            <div
              className={`text-lg font-mono font-medium ${
                isIn ? 'text-[#10b981]' : 'text-[#f5f5f7]'
              }`}
            >
              {isIn ? '+' : '-'}
              {formatCurrency(transaction.amount, transaction.currency)}
            </div>
          </div>

          <div className="text-xs text-[#f5f5f7] font-medium pt-1">
            {transaction.summary || transaction.counterparty || 'Biến động tài khoản'}
          </div>

          {transaction.merchantLabel && (
            <div className="flex items-center gap-1.5 text-[11px] text-[#00b3dd] bg-[#00b3dd]/10 px-2 py-1 rounded w-fit">
              <Sparkles className="w-3 h-3" />
              <span>Gợi ý đối tác: {transaction.merchantLabel}</span>
            </div>
          )}

          <div className="flex items-center justify-between text-[11px] text-[#6b6b70] pt-2 border-t border-[#1f2022]">
            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              <span>{formatDate(transaction.occurredAt, 'full')}</span>
            </div>
            {transaction.sourceEmail && (
              <span className="font-mono truncate max-w-[200px]">
                {transaction.sourceEmail}
              </span>
            )}
          </div>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="p-3 rounded-lg bg-[#f43f5e]/15 border border-[#f43f5e]/30 text-xs text-[#f43f5e] flex items-center gap-2 animate-in fade-in duration-150">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Classification Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Category Selection */}
          <div>
            <label className="text-xs text-[#9f9fa0] block mb-1.5 font-medium">
              Danh mục chi tiêu / thu nhập
            </label>
            <div className="space-y-2">
              <select
                value={selectedCategory}
                onChange={e => setSelectedCategory(e.target.value)}
                className="cockpit-input w-full text-xs font-medium"
              >
                {categories.map(c => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
                <option value="__NEW__">
                  + Khác... (Tạo danh mục mới)
                </option>
              </select>

              {isCustomMode && (
                <div className="animate-in fade-in duration-150">
                  <input
                    type="text"
                    required
                    autoFocus
                    placeholder="Nhập tên danh mục mới (VD: Cafe, Mua đồ công nghệ...)"
                    value={customCategoryName}
                    onChange={e => setCustomCategoryName(e.target.value)}
                    className="cockpit-input w-full text-xs"
                  />
                  <span className="text-[11px] text-[#9f9fa0] mt-1 block">
                    Danh mục mới sẽ được lưu vĩnh viễn và dùng lại cho các lần sau.
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Fund Selection (for OUT transactions only) */}
          {!isIn && (
            <div>
              <label className="text-xs text-[#9f9fa0] block mb-1.5 font-medium">
                Gán vào Quỹ ngân sách (Tùy chọn)
              </label>
              {funds.length === 0 ? (
                <div className="text-[11px] text-[#6b6b70] p-2.5 rounded-lg bg-[#090a0b] border border-[#232427]">
                  Chưa có quỹ ngân sách nào. Bạn có thể tạo quỹ trong mục "Quỹ" để theo dõi hạn mức.
                </div>
              ) : (
                <select
                  value={selectedFundId}
                  onChange={e => setSelectedFundId(e.target.value)}
                  className="cockpit-input w-full text-xs"
                >
                  <option value="">-- Không gán vào quỹ --</option>
                  {funds.map(f => (
                    <option key={f.id} value={f.id}>
                      {f.name} ({formatCurrency(f.monthlyAllocation)}/tháng)
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#232427]">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary text-xs"
            >
              Đóng
            </button>
            <button
              type="submit"
              disabled={isSubmitting || (isCustomMode && !customCategoryName.trim())}
              className="btn-primary text-xs flex items-center gap-1.5"
            >
              <span>{isSubmitting ? 'Đang lưu...' : 'Lưu phân loại'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
