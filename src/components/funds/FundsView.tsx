'use client';

import React, { useState, useMemo } from 'react';
import { useApp } from '@/context/AppContext';
import {
  formatCurrency,
  formatMonthLabel,
  calculateUnallocated,
  getTransactionYearMonth,
} from '@/lib/finance/calculations';
import type { Fund } from '@/types';
import {
  Plus,
  Edit2,
  Trash2,
  Calendar,
  Lock,
  PieChart,
} from 'lucide-react';

export function FundsView() {
  const {
    funds,
    fundStatuses,
    selectedMonth,
    setSelectedMonth,
    selectedMonthCashflow,
    monthlySnapshots,
    createFund,
    editFund,
    deleteFund,
    closeMonth,
    transactions,
  } = useApp();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingFund, setEditingFund] = useState<Fund | null>(null);

  // Form states
  const [name, setName] = useState('');
  const [monthlyAllocation, setMonthlyAllocation] = useState(3000000);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Available months
  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    set.add(selectedMonth);
    for (const s of monthlySnapshots) set.add(s.month);
    for (const t of transactions) {
      const ym = getTransactionYearMonth(t);
      if (ym) set.add(ym);
    }
    return Array.from(set).sort().reverse();
  }, [monthlySnapshots, transactions, selectedMonth]);

  const totalAllocated = useMemo(() => {
    return funds.filter(f => f.active).reduce((sum, f) => sum + f.monthlyAllocation, 0);
  }, [funds]);

  const unallocatedAmount = useMemo(() => {
    return calculateUnallocated(selectedMonthCashflow.totalIn, funds);
  }, [selectedMonthCashflow.totalIn, funds]);

  const isCurrentMonthClosed = useMemo(() => {
    return monthlySnapshots.some(s => s.month === selectedMonth);
  }, [monthlySnapshots, selectedMonth]);

  const openCreateModal = () => {
    setEditingFund(null);
    setName('');
    setMonthlyAllocation(3000000);
    setModalOpen(true);
  };

  const openEditModal = (fund: Fund) => {
    setEditingFund(fund);
    setName(fund.name);
    setMonthlyAllocation(fund.monthlyAllocation);
    setModalOpen(true);
  };

  const handleSaveFund = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSubmitting(true);
    try {
      if (editingFund) {
        await editFund(editingFund.id, {
          name: name.trim(),
          monthlyAllocation,
        });
      } else {
        await createFund(name.trim(), monthlyAllocation);
      }
      setModalOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl text-[#f5f5f7]">Quỹ ngân sách</h1>
          <p className="text-xs text-[#9f9fa0] mt-1">
            Phân bổ thu nhập vào các quỹ chi tiêu độc lập — không thay đổi tổng số dư tài chính
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Month Selector */}
          <div className="flex items-center gap-1.5 bg-[#17181a] px-3 py-1.5 rounded-lg border border-[#232427]">
            <Calendar className="w-3.5 h-3.5 text-[#9f9fa0]" />
            <select
              value={selectedMonth}
              onChange={e => setSelectedMonth(e.target.value)}
              className="bg-transparent text-xs text-[#f5f5f7] font-mono focus:outline-none"
            >
              {availableMonths.map(m => (
                <option key={m} value={m} className="bg-[#17181a]">
                  {formatMonthLabel(m)}
                </option>
              ))}
            </select>
          </div>

          {/* Close Month Button */}
          <button
            onClick={() => closeMonth(selectedMonth)}
            className="btn-secondary text-xs flex items-center gap-1.5"
            title="Lưu bản snapshot chốt sổ tháng này vào lịch sử tích lũy"
          >
            <Lock className="w-3.5 h-3.5 text-[#00b3dd]" />
            <span>{isCurrentMonthClosed ? 'Cập nhật chốt sổ' : 'Chốt sổ tháng'}</span>
          </button>

          {/* Add Fund Button */}
          <button
            onClick={openCreateModal}
            className="btn-primary text-xs flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Tạo quỹ</span>
          </button>
        </div>
      </div>

      {/* Allocation Overview Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="cockpit-card p-5">
          <div className="text-xs text-[#9f9fa0] font-mono-data mb-1">
            TỔNG THU NHẬP THÁNG {selectedMonth}
          </div>
          <div className="text-2xl font-light text-[#10b981] font-mono">
            +{formatCurrency(selectedMonthCashflow.totalIn)}
          </div>
          <div className="text-[11px] text-[#9f9fa0] mt-1">
            Nguồn tiền đưa vào phân bổ quỹ
          </div>
        </div>

        <div className="cockpit-card p-5">
          <div className="text-xs text-[#9f9fa0] font-mono-data mb-1">
            TỔNG TIỀN ĐÃ PHÂN BỔ VÀO CÁC QUỸ
          </div>
          <div className="text-2xl font-light text-[#f5f5f7] font-mono">
            {formatCurrency(totalAllocated)}
          </div>
          <div className="text-[11px] text-[#9f9fa0] mt-1">
            Tổng hạn mức định kỳ của {funds.length} quỹ
          </div>
        </div>

        <div className="cockpit-card p-5">
          <div className="text-xs text-[#9f9fa0] font-mono-data mb-1">
            CHƯA PHÂN BỔ (UNALLOCATED)
          </div>
          <div
            className={`text-2xl font-light font-mono ${
              unallocatedAmount >= 0 ? 'text-[#00b3dd]' : 'text-[#f43f5e]'
            }`}
          >
            {formatCurrency(unallocatedAmount)}
          </div>
          <div className="text-[11px] text-[#9f9fa0] mt-1">
            {unallocatedAmount >= 0
              ? 'Tiền dôi dư có thể chuyển sang tiết kiệm / đầu tư'
              : 'Phân bổ đang vượt quá thu nhập tháng này'}
          </div>
        </div>
      </div>

      {/* Funds Cards Grid */}
      {funds.length === 0 ? (
        <div className="cockpit-card p-12 text-center space-y-3">
          <PieChart className="w-8 h-8 text-[#9f9fa0] mx-auto opacity-40" />
          <div className="text-sm text-[#f5f5f7]">Chưa có quỹ nào được tạo</div>
          <div className="text-xs text-[#9f9fa0] max-w-sm mx-auto">
            Hãy tạo các quỹ như Quỹ ăn uống, Quỹ sinh hoạt, Quỹ dự phòng để kiểm soát chi tiêu theo từng mục tiêu.
          </div>
          <button onClick={openCreateModal} className="btn-primary text-xs mt-2">
            Tạo quỹ đầu tiên
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {funds.map(fund => {
            const status = fundStatuses.find(s => s.fundId === fund.id) || {
              fundId: fund.id,
              name: fund.name,
              allocated: fund.monthlyAllocation,
              spent: 0,
              remaining: fund.monthlyAllocation,
              usagePercent: 0,
              overAmount: 0,
              status: 'UNDER' as const,
            };

            const isOver = status.status === 'OVER';
            const visualProgress = Math.min(status.usagePercent, 100);

            return (
              <div
                key={fund.id}
                className={`cockpit-card p-6 flex flex-col justify-between space-y-4 ${
                  isOver ? 'border-[#f43f5e]/40' : ''
                }`}
              >
                <div>
                  {/* Fund Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-base font-medium text-[#f5f5f7]">{fund.name}</h3>
                      <div className="text-[11px] text-[#9f9fa0] mt-0.5">
                        Hạn mức: <span className="font-mono text-[#f5f5f7]">{formatCurrency(fund.monthlyAllocation)}</span>/tháng
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openEditModal(fund)}
                        className="p-1 rounded hover:bg-[#2e2e2e] text-[#9f9fa0] hover:text-[#f5f5f7]"
                        title="Chỉnh sửa quỹ"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => deleteFund(fund.id)}
                        className="p-1 rounded hover:bg-[#f43f5e]/10 text-[#9f9fa0] hover:text-[#f43f5e]"
                        title="Xóa quỹ"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Fund Metrics */}
                  <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-[#232427]">
                    <div>
                      <div className="text-[10px] text-[#9f9fa0] font-mono-data">ĐÃ CHI TIÊU</div>
                      <div className="text-lg font-light text-[#f5f5f7] mt-0.5 font-mono">
                        {formatCurrency(status.spent)}
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="text-[10px] text-[#9f9fa0] font-mono-data">
                        {isOver ? 'VƯỢT HẠN MỨC' : 'CÒN LẠI'}
                      </div>
                      <div
                        className={`text-lg font-light mt-0.5 font-mono ${
                          isOver ? 'text-[#f43f5e]' : 'text-[#10b981]'
                        }`}
                      >
                        {isOver ? `-${formatCurrency(status.overAmount)}` : formatCurrency(status.remaining)}
                      </div>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="mt-4 space-y-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-[#9f9fa0]">Tiến độ sử dụng</span>
                      <span
                        className={`font-mono ${
                          isOver ? 'text-[#f43f5e] font-semibold' : 'text-[#f5f5f7]'
                        }`}
                      >
                        {status.usagePercent}%
                      </span>
                    </div>

                    <div className="w-full h-2 rounded-full bg-[#090a0b] overflow-hidden border border-[#232427]">
                      <div
                        className={`h-full transition-all duration-300 ${
                          isOver
                            ? 'bg-[#f43f5e]'
                            : status.usagePercent >= 85
                            ? 'bg-[#f59e0b]'
                            : 'bg-[#ffffff]'
                        }`}
                        style={{ width: `${visualProgress}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Fund Create / Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <form
            onSubmit={handleSaveFund}
            className="cockpit-card-elevated max-w-md w-full p-6 space-y-5 bg-[#17181a] border border-[#34363a]"
          >
            <h3 className="text-base font-medium text-[#f5f5f7]">
              {editingFund ? 'Chỉnh sửa quỹ' : 'Tạo quỹ mới'}
            </h3>

            {/* Fund Name */}
            <div>
              <label className="text-xs text-[#9f9fa0] block mb-1">Tên quỹ</label>
              <input
                type="text"
                required
                autoFocus
                placeholder="VD: Quỹ ăn uống, Quỹ sinh hoạt..."
                value={name}
                onChange={e => setName(e.target.value)}
                className="cockpit-input w-full text-xs"
              />
            </div>

            {/* Monthly Allocation */}
            <div>
              <label className="text-xs text-[#9f9fa0] block mb-1">
                Hạn mức phân bổ hàng tháng (VND)
              </label>
              <input
                type="number"
                min={0}
                step={100000}
                required
                value={monthlyAllocation}
                onChange={e => setMonthlyAllocation(Number(e.target.value) || 0)}
                className="cockpit-input w-full text-xs font-mono"
              />
              <div className="text-[11px] text-[#9f9fa0] mt-1">
                Số tiền này dùng để theo dõi giới hạn chi tiêu, KHÔNG làm thay đổi tổng số dư tài chính.
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex justify-end gap-2 pt-4 border-t border-[#232427]">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="btn-secondary text-xs"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !name.trim()}
                className="btn-primary text-xs"
              >
                {isSubmitting
                  ? 'Đang lưu...'
                  : editingFund
                  ? 'Lưu thay đổi'
                  : 'Tạo quỹ'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
