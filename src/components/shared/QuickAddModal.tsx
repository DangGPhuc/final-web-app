'use client';

import React, { useState } from 'react';
import { useApp } from '@/context/AppContext';
import { DEFAULT_CATEGORIES } from '@/lib/constants';
import { toLocalDateTimeInputValue, formatCurrency } from '@/lib/utils';
import {
  ArrowDownLeft,
  ArrowUpRight,
  X,
  Plus,
  Calendar,
  Layers,
} from 'lucide-react';

export function QuickAddModal() {
  const { quickAddOpen, setQuickAddOpen, addTransaction, funds } = useApp();

  const [direction, setDirection] = useState<'IN' | 'OUT'>('OUT');
  const [amount, setAmount] = useState<number | ''>('');
  const [description, setDescription] = useState('');
  const [counterparty, setCounterparty] = useState('');
  const [category, setCategory] = useState<string>(DEFAULT_CATEGORIES[3]); // Ăn uống
  const [fundId, setFundId] = useState<string>('');
  const [occurredAt, setOccurredAt] = useState<string>(toLocalDateTimeInputValue());

  if (!quickAddOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || amount <= 0 || !description.trim()) return;

    addTransaction({
      source: 'MANUAL',
      direction,
      amount: Number(amount),
      currency: 'VND',
      occurredAt: new Date(occurredAt).toISOString(),
      description: description.trim(),
      counterparty: counterparty.trim() || undefined,
      category,
      fundId: direction === 'OUT' && fundId ? fundId : undefined,
      status: 'POSTED',
    });

    // Reset & Close
    setAmount('');
    setDescription('');
    setCounterparty('');
    setFundId('');
    setQuickAddOpen(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="cockpit-card-elevated max-w-md w-full p-6 space-y-4">
        {/* Modal Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-base font-medium text-[#f5f5f7]">Ghi chép giao dịch thủ công</h2>
          <button
            onClick={() => setQuickAddOpen(false)}
            className="text-[#9f9fa0] hover:text-[#f5f5f7] p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Direction Switch */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setDirection('OUT')}
              className={`py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                direction === 'OUT'
                  ? 'bg-[#f43f5e] text-[#ffffff]'
                  : 'bg-[#17181a] border border-[#232427] text-[#9f9fa0]'
              }`}
            >
              <ArrowUpRight className="w-4 h-4" /> TIỀN RA (CHI)
            </button>
            <button
              type="button"
              onClick={() => setDirection('IN')}
              className={`py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                direction === 'IN'
                  ? 'bg-[#10b981] text-[#000000]'
                  : 'bg-[#17181a] border border-[#232427] text-[#9f9fa0]'
              }`}
            >
              <ArrowDownLeft className="w-4 h-4" /> TIỀN VÀO (THU)
            </button>
          </div>

          {/* Amount */}
          <div>
            <label className="text-xs text-[#9f9fa0] block mb-1 font-mono-data">
              SỐ TIỀN (VND) *
            </label>
            <input
              type="number"
              required
              step={1000}
              placeholder="0"
              value={amount}
              onChange={e => setAmount(e.target.value === '' ? '' : parseFloat(e.target.value))}
              className="cockpit-input w-full text-base font-mono font-medium"
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-xs text-[#9f9fa0] block mb-1">NỘI DUNG GIAO DỊCH *</label>
            <input
              type="text"
              required
              placeholder="VD: Cơm trưa văn phòng, Mua xăng xe..."
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="cockpit-input w-full text-xs"
            />
          </div>

          {/* Counterparty */}
          <div>
            <label className="text-xs text-[#9f9fa0] block mb-1">
              ĐỐI TÁC / ĐỊA ĐIỂM (TÙY CHỌN)
            </label>
            <input
              type="text"
              placeholder="VD: Highland Coffee, Grab, Shopee..."
              value={counterparty}
              onChange={e => setCounterparty(e.target.value)}
              className="cockpit-input w-full text-xs"
            />
          </div>

          {/* Category & Fund Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[#9f9fa0] block mb-1">DANH MỤC</label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
                className="cockpit-input w-full text-xs"
              >
                {DEFAULT_CATEGORIES.map(c => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            {direction === 'OUT' && (
              <div>
                <label className="text-xs text-[#9f9fa0] block mb-1">PHÂN BỔ QUỸ</label>
                <select
                  value={fundId}
                  onChange={e => setFundId(e.target.value)}
                  className="cockpit-input w-full text-xs"
                >
                  <option value="">-- Chưa gán quỹ --</option>
                  {funds.map(f => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Date & Time */}
          <div>
            <label className="text-xs text-[#9f9fa0] block mb-1">THỜI GIAN GIAO DỊCH</label>
            <input
              type="datetime-local"
              value={occurredAt}
              onChange={e => setOccurredAt(e.target.value)}
              className="cockpit-input w-full text-xs font-mono"
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-3 border-t border-[#232427]">
            <button
              type="button"
              onClick={() => setQuickAddOpen(false)}
              className="btn-secondary text-xs"
            >
              Hủy
            </button>
            <button type="submit" className="btn-primary text-xs">
              Ghi sổ ngay
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
