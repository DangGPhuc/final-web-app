'use client';

import React from 'react';
import { AppProvider, useApp } from '@/context/AppContext';
import { Navigation } from '@/components/Navigation';
import { DashboardView } from '@/components/dashboard/DashboardView';
import { CashflowView } from '@/components/cashflow/CashflowView';
import { FundsView } from '@/components/funds/FundsView';
import { ForecastView } from '@/components/forecast/ForecastView';
import { TradingView } from '@/components/trading/TradingView';
import { SettingsView } from '@/components/settings/SettingsView';
import { QuickAddModal } from '@/components/shared/QuickAddModal';
import { Toast } from '@/components/shared/Toast';

function MainContent() {
  const { activeTab } = useApp();

  return (
    <div className="min-h-screen bg-[#0f1011] text-[#9f9fa0] flex flex-col antialiased">
      <Navigation />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-24 md:pb-12">
        {activeTab === 'dashboard' && <DashboardView />}
        {activeTab === 'cashflow' && <CashflowView />}
        {activeTab === 'funds' && <FundsView />}
        {activeTab === 'forecast' && <ForecastView />}
        {activeTab === 'trading' && <TradingView />}
        {activeTab === 'settings' && <SettingsView />}
      </main>

      <QuickAddModal />
      <Toast />

      {/* Minimal Cockpit Footer */}
      <footer className="border-t border-[#232427] bg-[#090a0b]/60 py-4 text-xs text-[#6b6b70]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div>Personal Finance Cockpit • Single-User Local Architecture</div>
          <div className="font-mono text-[11px] text-[#9f9fa0]">
            LocalStorage Adapter v3 • No Cloud DB • Deterministic Engine
          </div>
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
