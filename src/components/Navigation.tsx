'use client';

import React, { useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import {
  LayoutDashboard,
  ReceiptText,
  PieChart,
  CalendarCheck,
  WalletCards,
  BarChart3,
  Settings,
  Plus,
  Bell,
  AlertTriangle,
  Flame,
  User,
  CheckCircle2,
  ChevronRight,
  Shield,
  LogIn,
  LogOut,
  Loader2,
} from 'lucide-react';
import { formatCurrency, calculateBudgetStatuses } from '@/lib/utils';

const navItems = [
  { id: 'dashboard', label: 'Tổng quan', icon: LayoutDashboard },
  { id: 'transactions', label: 'Sổ giao dịch', icon: ReceiptText },
  { id: 'budgets', label: 'Ngân sách', icon: PieChart },
  { id: 'bills', label: 'Định kỳ', icon: CalendarCheck },
  { id: 'reports', label: 'Báo cáo', icon: BarChart3 },
  { id: 'wallets', label: 'Ví', icon: WalletCards },
  { id: 'settings', label: 'Cài đặt', icon: Settings },
];

const bottomNavItems = [
  { id: 'dashboard', label: 'Tổng quan', icon: LayoutDashboard },
  { id: 'transactions', label: 'Sổ GD', icon: ReceiptText },
  { id: 'budgets', label: 'Ngân sách', icon: PieChart },
  { id: 'reports', label: 'Báo cáo', icon: BarChart3 },
  { id: 'settings', label: 'Cài đặt', icon: Settings },
];

export const Navigation: React.FC = () => {
  const {
    activeTab,
    setActiveTab,
    openQuickAdd,
    budgets,
    transactions,
    bills,
    financialSummary,
  } = useApp();

  const {
    status: authStatus,
    user: authUser,
    loginWithGoogle,
    logout,
  } = useAuth();

  const [showNotificationModal, setShowNotificationModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);

  const budgetStatuses = calculateBudgetStatuses(budgets, transactions);
  const warningBudgets = budgetStatuses.filter((b) => b.status === 'WARNING');
  const exceededBudgets = budgetStatuses.filter((b) => b.status === 'EXCEEDED');
  const unpaidUpcomingBills = bills.filter((b) => b.status === 'UNPAID');
  const alertCount = warningBudgets.length + exceededBudgets.length + unpaidUpcomingBills.length;

  return (
    <>
      {/* Mobile Top Header */}
      <header className="lg:hidden sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-slate-100">
        <div className="flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-500 to-emerald-600 flex items-center justify-center text-white shadow-sm">
              <Flame className="w-4 h-4 fill-current" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-slate-900 leading-tight">FinTrack Pro</h1>
              <p className="text-[11px] text-slate-500 leading-tight">Quản lý chi tiêu</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {authStatus === 'LOADING' && (
              <div className="w-8 h-8 flex items-center justify-center text-slate-400">
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
            )}
            {authStatus === 'UNAUTHENTICATED' && (
              <button
                onClick={loginWithGoogle}
                className="flex items-center gap-1 bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-semibold px-2.5 py-1.5 rounded-lg shadow-sm active:scale-95 transition-all"
                title="Đăng nhập Google"
              >
                <LogIn className="w-3 h-3 text-emerald-400" />
                <span>Google</span>
              </button>
            )}
            {authStatus === 'AUTHENTICATED' && (
              <button
                onClick={() => setShowProfileModal(!showProfileModal)}
                className="w-8 h-8 rounded-full overflow-hidden border border-slate-200 focus:outline-none"
                title={authUser?.displayName || authUser?.email || 'Tài khoản'}
              >
                {authUser?.avatarUrl ? (
                  <img
                    src={authUser.avatarUrl}
                    alt={authUser.displayName || 'Avatar'}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-xs">
                    {(authUser?.displayName || authUser?.email || 'U')[0].toUpperCase()}
                  </div>
                )}
              </button>
            )}
            <button
              onClick={() => setShowNotificationModal(!showNotificationModal)}
              className="relative w-10 h-10 flex items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 active:bg-slate-200 transition-colors"
              aria-label="Thông báo"
            >
              <Bell className="w-5 h-5" />
              {alertCount > 0 && (
                <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-rose-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                  {alertCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Desktop Top Header */}
      <header className="hidden lg:block sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-slate-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-emerald-600 flex items-center justify-center text-white shadow-sm">
              <Flame className="w-5 h-5 fill-current" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-extrabold text-lg tracking-tight text-slate-900">
                  FinTrack Pro
                </span>
                <span className="hidden sm:inline-block px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase bg-emerald-100 text-emerald-700 rounded-full border border-emerald-200">
                  Quản lý chi tiêu
                </span>
              </div>
              <p className="text-[11px] text-slate-500 hidden sm:block">
                Hệ thống tài chính cá nhân & Ngân sách thông minh
              </p>
            </div>
          </div>

          <div className="hidden md:flex items-center space-x-4 bg-slate-50 px-4 py-1.5 rounded-full border border-slate-100 text-xs">
            <div>
              <span className="text-slate-500 mr-1.5">Số dư khả dụng:</span>
              <span className="font-bold text-emerald-600">
                {formatCurrency(financialSummary.availableBalance)}
              </span>
            </div>
            <div className="w-px h-3.5 bg-slate-300" />
            <div>
              <span className="text-slate-500 mr-1.5">Tổng tài sản:</span>
              <span className="font-bold text-slate-800">
                {formatCurrency(financialSummary.totalAssets)}
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-2.5">
            <button
              onClick={() => openQuickAdd('EXPENSE')}
              className="flex items-center space-x-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2 rounded-xl text-sm font-semibold shadow-md shadow-emerald-500/20 transition-all active:scale-95"
            >
              <Plus className="w-4 h-4" />
              <span>Nhập nhanh</span>
            </button>

            <div className="relative">
              <button
                onClick={() => setShowNotificationModal(!showNotificationModal)}
                className="p-2 text-slate-600 hover:bg-slate-100 rounded-xl relative transition-colors"
                aria-label="Thông báo cảnh báo"
              >
                <Bell className="w-5 h-5" />
                {alertCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-rose-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center animate-pulse">
                    {alertCount}
                  </span>
                )}
              </button>
            </div>

            <div className="relative">
              {authStatus === 'LOADING' && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400">
                  <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                  <span>Đang tải...</span>
                </div>
              )}
              {authStatus === 'UNAUTHENTICATED' && (
                <button
                  onClick={loginWithGoogle}
                  className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold px-3 py-2 rounded-xl transition-all shadow-sm active:scale-95"
                >
                  <LogIn className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Đăng nhập Google</span>
                </button>
              )}
              {authStatus === 'AUTHENTICATED' && (
                <button
                  onClick={() => setShowProfileModal(!showProfileModal)}
                  className="flex items-center space-x-2 p-1.5 rounded-xl hover:bg-slate-100 transition-colors border border-transparent hover:border-slate-200"
                >
                  {authUser?.avatarUrl ? (
                    <img
                      src={authUser.avatarUrl}
                      alt={authUser.displayName || 'Avatar'}
                      className="w-8 h-8 rounded-full object-cover border border-slate-200"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-xs">
                      {(authUser?.displayName || authUser?.email || 'U')[0].toUpperCase()}
                    </div>
                  )}
                  <span className="text-xs font-semibold text-slate-700 hidden lg:inline max-w-[120px] truncate">
                    {authUser?.displayName || authUser?.email?.split('@')[0] || 'Tài khoản'}
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Desktop Tab Navigation */}
      <nav className="hidden lg:block bg-white border-b border-slate-100 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto flex space-x-1 overflow-x-auto no-scrollbar py-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-sm font-semibold whitespace-nowrap transition-all ${
                  isActive
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Mobile Bottom Navigation */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-slate-100 px-2 pb-safe shadow-[0_-4px_20px_rgba(15,23,42,0.06)]">
        <div className="flex items-center justify-around h-[64px]">
          {bottomNavItems.slice(0, 2).map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className="flex flex-col items-center justify-center flex-1 h-full min-w-0"
              >
                <div className={`p-1.5 rounded-xl transition-colors ${isActive ? 'bg-emerald-100 text-emerald-700' : 'text-slate-400'}`}>
                  <Icon className="w-5 h-5" />
                </div>
                <span className={`text-[10px] font-medium mt-0.5 ${isActive ? 'text-emerald-700 font-semibold' : 'text-slate-400'}`}>
                  {item.label}
                </span>
              </button>
            );
          })}

          {/* FAB */}
          <button
            onClick={() => openQuickAdd('EXPENSE')}
            className="flex-shrink-0 -mt-5 w-14 h-14 rounded-full bg-emerald-600 text-white shadow-lg shadow-emerald-500/30 flex items-center justify-center active:scale-90 transition-transform"
            aria-label="Thêm giao dịch"
          >
            <Plus className="w-7 h-7" />
          </button>

          {bottomNavItems.slice(2).map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className="flex flex-col items-center justify-center flex-1 h-full min-w-0"
              >
                <div className={`p-1.5 rounded-xl transition-colors ${isActive ? 'bg-emerald-100 text-emerald-700' : 'text-slate-400'}`}>
                  <Icon className="w-5 h-5" />
                </div>
                <span className={`text-[10px] font-medium mt-0.5 ${isActive ? 'text-emerald-700 font-semibold' : 'text-slate-400'}`}>
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Notification Dropdown (shared) */}
      {showNotificationModal && (
        <div className="fixed lg:absolute lg:right-8 lg:top-16 lg:w-80 inset-x-0 top-14 lg:top-auto lg:inset-x-auto bg-white border-b lg:border border-slate-100 lg:rounded-2xl shadow-lg p-4 z-40 max-h-[80vh] overflow-y-auto">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h4 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <Bell className="w-4 h-4 text-emerald-600" />
              <span>Trung tâm Cảnh báo</span>
            </h4>
            <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
              {alertCount} việc
            </span>
          </div>

          <div className="py-2 space-y-2 max-h-72 overflow-y-auto">
            {exceededBudgets.map((b) => (
              <div
                key={b.budget.id}
                className="p-2.5 rounded-xl bg-rose-50 border border-rose-100 flex items-start gap-2.5"
              >
                <AlertTriangle className="w-4 h-4 text-rose-600 mt-0.5 shrink-0" />
                <div className="text-xs">
                  <p className="font-bold text-rose-700">
                    Vượt ngân sách {b.budget.categoryName}
                  </p>
                  <p className="text-rose-600/80 mt-0.5">
                    Đã chi {formatCurrency(b.spent)} / {formatCurrency(b.budget.amount)} ({b.percentage}%)
                  </p>
                </div>
              </div>
            ))}

            {warningBudgets.map((b) => (
              <div
                key={b.budget.id}
                className="p-2.5 rounded-xl bg-amber-50 border border-amber-100 flex items-start gap-2.5"
              >
                <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                <div className="text-xs">
                  <p className="font-bold text-amber-700">
                    Cảnh báo 80%: {b.budget.categoryName}
                  </p>
                  <p className="text-amber-600/80 mt-0.5">
                    Đã sử dụng {b.percentage}%. Còn {formatCurrency(b.remaining)}.
                  </p>
                </div>
              </div>
            ))}

            {unpaidUpcomingBills.map((bill) => (
              <div
                key={bill.id}
                className="p-2.5 rounded-xl bg-blue-50 border border-blue-100 flex items-start gap-2.5"
              >
                <CalendarCheck className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                <div className="text-xs">
                  <p className="font-bold text-blue-700">Hóa đơn chưa thanh toán: {bill.name}</p>
                  <p className="text-blue-600/80 mt-0.5">
                    Hạn ngày {bill.dueDay} • {formatCurrency(bill.amount)}
                  </p>
                </div>
              </div>
            ))}

            {alertCount === 0 && (
              <div className="text-center py-6 text-slate-500">
                <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-500 mb-1" />
                <p className="text-xs font-semibold">Mọi chỉ số đều an toàn!</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Profile Modal */}
      {showProfileModal && authStatus === 'AUTHENTICATED' && (
        <div className="fixed lg:absolute lg:right-8 lg:top-16 lg:w-80 inset-x-4 top-14 lg:top-auto lg:inset-x-auto bg-white border border-slate-200 rounded-2xl shadow-xl p-4 z-50">
          <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
            {authUser?.avatarUrl ? (
              <img
                src={authUser.avatarUrl}
                alt={authUser.displayName || 'User'}
                className="w-10 h-10 rounded-full object-cover border border-slate-200"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-sm">
                {(authUser?.displayName || authUser?.email || 'U')[0].toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-slate-900 truncate">
                {authUser?.displayName || 'Tài khoản Google'}
              </p>
              <p className="text-xs text-slate-500 truncate">{authUser?.email}</p>
            </div>
          </div>

          <div className="py-3 text-xs text-slate-600 border-b border-slate-100 space-y-1.5">
            <div className="flex items-center gap-1.5 text-emerald-700 font-semibold">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>Đã xác thực Google OIDC</span>
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Lưu ý: Dữ liệu tài chính ở giai đoạn này vẫn đang lưu trữ cục bộ trong trình duyệt (localStorage).
            </p>
          </div>

          <div className="pt-3">
            <button
              onClick={() => {
                setShowProfileModal(false);
                logout();
              }}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold transition-colors"
            >
              <LogOut className="w-4 h-4" />
              <span>Đăng xuất</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
};
