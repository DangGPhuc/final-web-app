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
import { ClassificationModal } from '@/components/shared/ClassificationModal';
import { Toast } from '@/components/shared/Toast';
import { OwnerUnlockScreen } from '@/components/shared/OwnerUnlockScreen';

function MainContent() {
  const {
    activeTab,
    classifyingTransaction,
    setClassifyingTransaction,
    classifyTransaction,
    categories,
    funds,
  } = useApp();

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

      {classifyingTransaction && (
        <ClassificationModal
          transaction={classifyingTransaction}
          categories={categories}
          funds={funds}
          onClose={() => setClassifyingTransaction(null)}
          onClassify={classifyTransaction}
        />
      )}

      <Toast />

      {/* Minimal Cockpit Footer */}
      <footer className="border-t border-[#232427] bg-[#090a0b]/60 py-4 text-xs text-[#6b6b70]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div>Personal Finance Cockpit • Single-Owner Local Architecture</div>
          <div className="font-mono text-[11px] text-[#9f9fa0]">
            PostgreSQL &amp; Prisma • Gmail OAuth • AES-256-GCM
          </div>
        </div>
      </footer>
    </div>
  );
}

function CockpitApp() {
  const { isOwnerAuthenticated } = useApp();

  // Initial authentication check
  if (isOwnerAuthenticated === null) {
    return (
      <div className="min-h-screen bg-[#090a0b] flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-emerald-500/20 border-t-emerald-500 animate-spin" />
      </div>
    );
  }

  // Unauthenticated single-owner protection screen
  if (isOwnerAuthenticated === false) {
    return <OwnerUnlockScreen />;
  }

  // Authenticated owner view
  return <MainContent />;
}

export default function Home() {
  return (
    <AppProvider>
      <CockpitApp />
    </AppProvider>
  );
}
