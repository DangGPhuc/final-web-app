'use client';

import React from 'react';
import { AppProvider, useApp } from '@/context/AppContext';
import { Navigation } from '@/components/Navigation';
import { DashboardView } from '@/components/DashboardView';
import { TransactionsView } from '@/components/TransactionsView';
import { BudgetsView } from '@/components/BudgetsView';
import { WhatIfSimulatorView } from '@/components/WhatIfSimulatorView';
import { BillsView } from '@/components/BillsView';
import { ReportsView } from '@/components/ReportsView';
import { WalletsView } from '@/components/WalletsView';
import { SettingsView } from '@/components/SettingsView';
import { QuickAddModal } from '@/components/QuickAddModal';
import { StorageStatusBanner } from '@/components/StorageStatusBanner';

function MainContent() {
  const { activeTab } = useApp();

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
      <Navigation />
      <StorageStatusBanner />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 pt-4 lg:pt-6 pb-24 lg:pb-6">
        {activeTab === 'dashboard' && <DashboardView />}
        {activeTab === 'transactions' && <TransactionsView />}
        {activeTab === 'budgets' && <BudgetsView />}
        {activeTab === 'whatif' && <WhatIfSimulatorView />}
        {activeTab === 'bills' && <BillsView />}
        {activeTab === 'reports' && <ReportsView />}
        {activeTab === 'wallets' && <WalletsView />}
        {activeTab === 'settings' && <SettingsView />}
      </main>

      <QuickAddModal />

      {/* Footer chỉ hiện trên desktop */}
      <footer className="hidden lg:block border-t border-slate-100 bg-white/50 py-6 text-center text-xs text-slate-500 print:hidden">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <p>© 2026 FinTrack Pro • Hệ thống Quản lý Chi tiêu Cá nhân & Ngân sách Thông minh</p>
          <p className="font-semibold text-slate-700">
            Next.js 15 • Tailwind CSS • Recharts
          </p>
        </div>
      </footer>
    </div>
  );
}

export default function Home() {
  return (
    <AppProvider>
      <MainContent />
    </AppProvider>
  );
}
