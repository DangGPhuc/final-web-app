import { Wallet, Transaction, Budget, FinancialSummary, RecurringBill } from '@/types';
import * as XLSX from 'xlsx';

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(dateString: string, type: 'short' | 'full' | 'time' | 'dateOnly' = 'short'): string {
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;

    if (type === 'time') {
      return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    }

    if (type === 'dateOnly') {
      return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }

    if (type === 'full') {
      return date.toLocaleDateString('vi-VN', {
        weekday: 'short',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    }

    return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return dateString;
  }
}

/**
 * Convert a Date, ISO string, or timestamp into local HTML datetime-local input string:
 * YYYY-MM-DDTHH:mm using the browser's local timezone.
 * DO NOT use toISOString().slice(0, 16).
 */
export function toLocalDateTimeInputValue(dateOrIso: Date | string | number = new Date()): string {
  const d = dateOrIso instanceof Date ? dateOrIso : new Date(dateOrIso);
  if (isNaN(d.getTime())) {
    const fallback = new Date();
    const y = fallback.getFullYear();
    const m = String(fallback.getMonth() + 1).padStart(2, '0');
    const day = String(fallback.getDate()).padStart(2, '0');
    const hh = String(fallback.getHours()).padStart(2, '0');
    const mm = String(fallback.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${day}T${hh}:${mm}`;
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day}T${hh}:${mm}`;
}

/**
 * Convert local datetime-local value (YYYY-MM-DDTHH:mm or with seconds) to canonical ISO timestamp.
 */
export function localDateTimeInputToISO(value: string): string {
  if (!value) return new Date().toISOString();
  const [datePart, timePart = '00:00'] = value.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm, ss = 0] = timePart.split(':').map(Number);
  const localDate = new Date(y, m - 1, d, hh, mm, ss);
  if (isNaN(localDate.getTime())) return new Date().toISOString();
  return localDate.toISOString();
}

/**
 * Get local calendar date key: YYYY-MM-DD based on local timezone.
 */
export function getLocalDateKey(dateOrIso: Date | string | number): string {
  const d = dateOrIso instanceof Date ? dateOrIso : new Date(dateOrIso);
  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Get local calendar year-month: YYYY-MM based on local timezone.
 */
export function getLocalYearMonth(dateOrIso: Date | string | number): string {
  const d = dateOrIso instanceof Date ? dateOrIso : new Date(dateOrIso);
  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * Check if a date falls into target yearMonth (YYYY-MM) in the local timezone.
 */
export function isDateInLocalYearMonth(dateOrIso: Date | string | number, yearMonth: string): boolean {
  if (!dateOrIso || !yearMonth) return false;
  return getLocalYearMonth(dateOrIso) === yearMonth;
}

/**
 * Standard Date & Time Helpers
 */
export function getCurrentYearMonth(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function getCurrentYear(d: Date = new Date()): string {
  return String(d.getFullYear());
}

export function getPreviousYearMonth(d: Date = new Date()): string {
  const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  return getCurrentYearMonth(prev);
}

export function getCurrentMonthLabel(d: Date = new Date()): string {
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `Tháng ${month}/${d.getFullYear()}`;
}

export function formatMonthLabel(yearMonthStr: string): string {
  if (!yearMonthStr || !yearMonthStr.includes('-')) return yearMonthStr;
  const parts = yearMonthStr.split('-');
  return `Tháng ${parts[1]}/${parts[0]}`;
}

export function formatMonthShortLabel(yearMonthStr: string): string {
  if (!yearMonthStr || !yearMonthStr.includes('-')) return yearMonthStr;
  const parts = yearMonthStr.split('-');
  return `T${parseInt(parts[1], 10)}/${parts[0]}`;
}

export function isDateInCurrentMonth(dateStr: string, currentYm: string = getCurrentYearMonth()): boolean {
  if (!dateStr) return false;
  return isDateInLocalYearMonth(dateStr, currentYm);
}

export { calculateFinancialSummary } from './domain-engine';

export interface BudgetStatusItem {
  budget: Budget;
  spent: number;
  remaining: number;
  percentage: number;
  status: 'SAFE' | 'WARNING' | 'EXCEEDED';
}

export function calculateBudgetStatuses(
  budgets: Budget[],
  transactions: Transaction[],
  monthStr: string = getCurrentYearMonth()
): BudgetStatusItem[] {
  const currentMonthExpenses = transactions.filter(
    (t) => t.type === 'EXPENSE' && isDateInLocalYearMonth(t.date, monthStr)
  );

  const monthBudgets = budgets.filter((b) => b.month === monthStr);

  return monthBudgets.map((b) => {
    const spent = currentMonthExpenses
      .filter((t) => t.categoryId === b.categoryId)
      .reduce((sum, t) => sum + t.amount, 0);

    const percentage = b.amount > 0 ? (spent / b.amount) * 100 : 0;
    const remaining = b.amount - spent;

    let status: 'SAFE' | 'WARNING' | 'EXCEEDED' = 'SAFE';
    if (percentage >= 100) {
      status = 'EXCEEDED';
    } else if (percentage >= 80) {
      status = 'WARNING';
    }

    return {
      budget: b,
      spent,
      remaining,
      percentage: Math.round(percentage * 10) / 10,
      status,
    };
  });
}

export function exportToCSV(transactions: Transaction[], filename = 'bao-cao-giao-dich.csv'): void {
  const headers = ['Mã GD', 'Thời gian', 'Loại GD', 'Danh mục', 'Số tiền (VND)', 'Ví nguồn', 'Ví đích/Ghi chú', 'Nhãn'];
  const rows = transactions.map((t) => [
    t.id,
    formatDate(t.date, 'full'),
    t.type === 'EXPENSE' ? 'Chi tiêu' : t.type === 'INCOME' ? 'Thu nhập' : 'Chuyển khoản',
    t.categoryName || 'Không có',
    t.amount,
    t.walletName || t.walletId,
    t.type === 'TRANSFER' ? (t.toWalletName || t.toWalletId || '') : (t.note || ''),
    (t.tags || []).join('; '),
  ]);

  const csvContent =
    '\uFEFF' +
    [headers, ...rows]
      .map((e) => e.map((val) => `"${String(val).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function exportToExcel(
  transactions: Transaction[],
  budgets: Budget[],
  wallets: Wallet[],
  summary: FinancialSummary,
  filename = 'Bao-Cao-Tai-Chinh-Chi-Tieu.xlsx'
): void {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Danh sách giao dịch
  const txData = transactions.map((t, idx) => ({
    'STT': idx + 1,
    'Mã GD': t.id,
    'Thời gian': formatDate(t.date, 'full'),
    'Loại giao dịch': t.type === 'EXPENSE' ? 'Khoản chi' : t.type === 'INCOME' ? 'Khoản thu' : 'Chuyển khoản nội bộ',
    'Danh mục': t.categoryName || 'Khác',
    'Số tiền (₫)': t.amount,
    'Tài khoản / Ví': t.walletName || t.walletId,
    'Ví đích (nếu chuyển)': t.toWalletName || '',
    'Ghi chú': t.note,
    'Nhãn phân loại': (t.tags || []).join(', '),
  }));
  const wsTx = XLSX.utils.json_to_sheet(txData);
  XLSX.utils.book_append_sheet(wb, wsTx, 'Sổ Giao Dịch');

  // Sheet 2: Tổng hợp tài sản & Ví
  const walletData = wallets.map((w) => ({
    'Tên Ví / Tài khoản': w.name,
    'Loại ví': w.type === 'CASH' ? 'Tiền mặt' : w.type === 'BANK' ? 'Ngân hàng' : w.type === 'CREDIT' ? 'Thẻ tín dụng' : 'Sổ tiết kiệm',
    'Số dư hiện tại (₫)': w.balance,
    'Hạn mức (Thẻ tín dụng)': w.creditLimit || '-',
    'Lãi suất (%/năm)': w.interestRate ? `${w.interestRate}%` : '-',
    'Số tài khoản / Thẻ': w.accountNumber || '-',
  }));
  const wsWallets = XLSX.utils.json_to_sheet(walletData);
  XLSX.utils.book_append_sheet(wb, wsWallets, 'Tài Khoản & Ví');

  // Sheet 3: Báo cáo ngân sách
  const budgetStatuses = calculateBudgetStatuses(budgets, transactions);
  const budgetData = budgetStatuses.map((bs) => ({
    'Danh mục': bs.budget.categoryName,
    'Hạn mức tháng (₫)': bs.budget.amount,
    'Đã chi tiêu (₫)': bs.spent,
    'Còn lại (₫)': bs.remaining,
    'Tỷ lệ đã dùng (%)': `${bs.percentage}%`,
    'Tình trạng cảnh báo': bs.status === 'EXCEEDED' ? 'VƯỢT 100% NGÂN SÁCH' : bs.status === 'WARNING' ? 'CẢNH BÁO (>80%)' : 'An toàn',
  }));
  const wsBudgets = XLSX.utils.json_to_sheet(budgetData);
  XLSX.utils.book_append_sheet(wb, wsBudgets, 'Theo Dõi Ngân Sách');

  // Sheet 4: Chỉ số tài chính tổng quan
  const kpiData = [
    { 'Chỉ tiêu': 'Tổng tài sản ròng', 'Giá trị (₫)': summary.totalAssets },
    { 'Chỉ tiêu': 'Số dư khả dụng (Tiền mặt + Ngân hàng)', 'Giá trị (₫)': summary.availableBalance },
    { 'Chỉ tiêu': 'Dư nợ thẻ tín dụng', 'Giá trị (₫)': summary.totalCreditDebt },
    { 'Chỉ tiêu': 'Tổng tiền gửi tiết kiệm', 'Giá trị (₫)': summary.totalSavings },
    { 'Chỉ tiêu': 'Tổng thu nhập tháng này', 'Giá trị (₫)': summary.monthlyIncome },
    { 'Chỉ tiêu': 'Tổng chi tiêu tháng này', 'Giá trị (₫)': summary.monthlyExpense },
    { 'Chỉ tiêu': 'Tích lũy ròng trong tháng', 'Giá trị (₫)': summary.netSavingsThisMonth },
    { 'Chỉ tiêu': 'Tỷ lệ tiết kiệm', 'Giá trị (₫)': `${summary.savingsRate}%` },
  ];
  const wsKPI = XLSX.utils.json_to_sheet(kpiData);
  XLSX.utils.book_append_sheet(wb, wsKPI, 'Tổng Hợp Tài Chính');

  XLSX.writeFile(wb, filename);
}
