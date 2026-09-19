'use client';

import React from 'react';
import { useApp } from '@/context/AppContext';
import type { AppTab } from '@/types';
import {
  LayoutDashboard,
  ArrowLeftRight,
  PieChart,
  TrendingUp,
  LineChart,
  Settings,
  Plus,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';

interface TabItem {
  id: AppTab;
  label: string;
  icon: React.ElementType;
}

const TABS: TabItem[] = [
  { id: 'dashboard', label: 'Tổng quan', icon: LayoutDashboard },
  { id: 'cashflow', label: 'Dòng tiền', icon: ArrowLeftRight },
  { id: 'funds', label: 'Quỹ', icon: PieChart },
  { id: 'forecast', label: 'Dự báo', icon: TrendingUp },
  { id: 'trading', label: 'Demo Trading', icon: LineChart },
  { id: 'settings', label: 'Cài đặt', icon: Settings },
];

export function Navigation() {
  const {
    activeTab,
    setActiveTab,
    setQuickAddOpen,
    emailConnection,
    syncEmail,
    needsReviewTransactions,
  } = useApp();

  return (
    <header className="sticky top-0 z-40 bg-[#0f1011]/90 backdrop-blur-md border-b border-[#232427]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo / Cockpit Title */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#ffffff] flex items-center justify-center text-[#000000] font-semibold text-sm">
              FC
            </div>
            <div>
              <span className="text-sm font-semibold tracking-wide text-[#f5f5f7]">
                FINANCE COCKPIT
              </span>
              <span className="hidden sm:inline-block ml-2 text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-[#2e2e2e] text-[#9f9fa0]">
                Single User
              </span>
            </div>
          </div>

          {/* Desktop Navigation Tabs */}
          <nav className="hidden md:flex items-center gap-1 bg-[#17181a] p-1 rounded-xl border border-[#232427]">
            {TABS.map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors relative ${
                    isActive
                      ? 'bg-[#2e2e2e] text-[#ffffff]'
                      : 'text-[#9f9fa0] hover:text-[#f5f5f7] hover:bg-[#232427]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                  {tab.id === 'cashflow' && needsReviewTransactions.length > 0 && (
                    <span className="w-1.5 h-1.5 rounded-full bg-[#f59e0b]" />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Quick Actions */}
          <div className="flex items-center gap-2">
            {/* Email Sync Button / Indicator */}
            <button
              onClick={() => syncEmail(true)}
              disabled={emailConnection.syncStatus === 'syncing'}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono bg-[#17181a] border border-[#232427] hover:border-[#34363a] text-[#9f9fa0] hover:text-[#ffffff] transition-colors"
              title={
                emailConnection.connected
                  ? `Đã kết nối (${emailConnection.email}) - Bấm để đồng bộ`
                  : 'Đồng bộ email ngân hàng (chế độ demo/tự động)'
              }
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${
                  emailConnection.syncStatus === 'syncing' ? 'animate-spin text-[#00b3dd]' : ''
                }`}
              />
              <span>
                {emailConnection.syncStatus === 'syncing' ? 'Đang đọc...' : 'Đồng bộ'}
              </span>
            </button>

            {/* Unreviewed Alert indicator if any */}
            {needsReviewTransactions.length > 0 && (
              <button
                onClick={() => setActiveTab('cashflow')}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs bg-[#f59e0b]/10 border border-[#f59e0b]/30 text-[#f59e0b] hover:bg-[#f59e0b]/20 transition-colors"
                title={`${needsReviewTransactions.length} giao dịch cần duyệt`}
              >
                <AlertCircle className="w-3.5 h-3.5" />
                <span className="font-mono">{needsReviewTransactions.length}</span>
              </button>
            )}

            {/* Quick Add Button */}
            <button
              onClick={() => setQuickAddOpen(true)}
              className="btn-primary flex items-center gap-1.5 text-xs py-1.5 px-3.5 shadow-none"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Ghi chép</span>
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Bottom Navigation */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#0f1011]/95 backdrop-blur-lg border-t border-[#232427] px-2 py-2 pb-safe">
        <div className="grid grid-cols-6 gap-1">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex flex-col items-center justify-center py-1 rounded-lg text-[10px] transition-colors relative ${
                  isActive ? 'text-[#ffffff] font-medium' : 'text-[#9f9fa0]'
                }`}
              >
                <Icon className="w-4 h-4 mb-0.5" />
                <span className="truncate max-w-[50px]">{tab.label}</span>
                {tab.id === 'cashflow' && needsReviewTransactions.length > 0 && (
                  <span className="absolute top-1 right-3 w-1.5 h-1.5 rounded-full bg-[#f59e0b]" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </header>
  );
}
