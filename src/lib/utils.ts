import { Wallet, Transaction, Budget, FinancialSummary, RecurringBill } from '@/types';

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
 * Strictly validates calendar date and time. Returns null if invalid or impossible (e.g. 2026-02-31).
 * Never silently substitutes current time.
 */
export function localDateTimeInputToISO(value: string): string | null {
  if (!value || typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return null;
  const y = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const d = parseInt(match[3], 10);
  const hh = parseInt(match[4], 10);
  const mm = parseInt(match[5], 10);
  const ss = match[6] ? parseInt(match[6], 10) : 0;
  if (m < 1 || m > 12) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59 || ss < 0 || ss > 59) return null;
  const daysInMonth = new Date(y, m, 0).getDate();
  if (d < 1 || d > daysInMonth) return null;
  const localDate = new Date(y, m - 1, d, hh, mm, ss);
  if (isNaN(localDate.getTime())) return null;
  if (localDate.getFullYear() !== y || localDate.getMonth() !== m - 1 || localDate.getDate() !== d) {
    return null;
  }
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

/**
 * Sanitize a string value for safe inclusion in CSV/spreadsheet output.
 *
 * Spreadsheet applications (Excel, LibreOffice, Google Sheets) interpret cells
 * beginning with =, +, -, or @ as formula expressions when imported from CSV.
 * This allows CSV Injection / Formula Injection attacks where user-controlled
 * data can execute macros or exfiltrate data.
 *
 * Mitigation: prefix dangerous cells with a tab character (\t).
 * The tab is invisible in most spreadsheet views but prevents formula execution.
 * The original data is preserved — only the injection vector is neutralized.
 *
 * OWASP Reference: OWASP Testing Guide — OTG-INPVAL-017
 */
export function sanitizeCsvCell(val: string): string {
  if (val && /^[=+\-@]/.test(val)) {
    return `\t${val}`;
  }
  return val;
}

// ─── Receipt / File Upload Security Foundation ────────────────────────────────

/**
 * Maximum allowed local receipt file size (bytes).
 * 1 MB conservative local limit to avoid localStorage exhaustion.
 * Future private object-storage upload pipeline may support up to 5 MB.
 */
export const LOCAL_RECEIPT_MAX_BYTES = 1 * 1024 * 1024; // 1 MB
export const RECEIPT_MAX_BYTES = LOCAL_RECEIPT_MAX_BYTES;

/** Allowed MIME types for receipt images. SVG is excluded (active content risk). */
export const RECEIPT_ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/**
 * Client-side receipt file validation.
 *
 * Validates file size and declared MIME type against a strict allowlist.
 */
export function validateReceiptFile(file: File): { ok: boolean; valid: boolean; error?: string } {
  if (!file) {
    return { ok: false, valid: false, error: 'Tệp không hợp lệ' };
  }
  if (file.size > RECEIPT_MAX_BYTES) {
    return {
      ok: false,
      valid: false,
      error: `Ảnh biên lai quá lớn (${(file.size / 1024 / 1024).toFixed(1)} MB). Giới hạn lưu trữ cục bộ: ${RECEIPT_MAX_BYTES / (1024 * 1024)} MB.`,
    };
  }
  if (!RECEIPT_ALLOWED_MIMES.includes(file.type as (typeof RECEIPT_ALLOWED_MIMES)[number])) {
    return {
      ok: false,
      valid: false,
      error: `Định dạng tệp không được hỗ trợ (${file.type || 'không rõ'}). Chỉ chấp nhận: JPEG, PNG, WEBP.`,
    };
  }
  return { ok: true, valid: true };
}

export function exportToCSV(transactions: Transaction[], filename = 'bao-cao-giao-dich.csv'): void {
  const headers = ['Mã GD', 'Thời gian', 'Loại GD', 'Danh mục', 'Số tiền (VND)', 'Ví nguồn', 'Ví đích/Ghi chú', 'Nhãn'];
  const rows = transactions.map((t) => [
    t.id,
    formatDate(t.date, 'full'),
    t.type === 'EXPENSE' ? 'Chi tiêu' : t.type === 'INCOME' ? 'Thu nhập' : 'Chuyển khoản',
    sanitizeCsvCell(t.categoryName || 'Không có'),
    t.amount,
    sanitizeCsvCell(t.walletName || t.walletId),
    sanitizeCsvCell(t.type === 'TRANSFER' ? (t.toWalletName || t.toWalletId || '') : (t.note || '')),
    sanitizeCsvCell((t.tags || []).join('; ')),
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

export async function exportToExcel(
  transactions: Transaction[],
  budgets: Budget[],
  wallets: Wallet[],
  summary: FinancialSummary,
  filename = 'Bao-Cao-Tai-Chinh-Chi-Tieu.xlsx'
): Promise<void> {
  const ExcelJSModule = await import('exceljs');
  const ExcelJS = ExcelJSModule.default || ExcelJSModule;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'FinTrack Pro v2';
  wb.created = new Date();

  // Sheet 1: Danh sách giao dịch
  const wsTx = wb.addWorksheet('Sổ Giao Dịch');
  wsTx.columns = [
    { header: 'STT', key: 'stt', width: 6 },
    { header: 'Mã GD', key: 'id', width: 15 },
    { header: 'Thời gian', key: 'date', width: 22 },
    { header: 'Loại giao dịch', key: 'type', width: 20 },
    { header: 'Danh mục', key: 'category', width: 20 },
    { header: 'Số tiền (₫)', key: 'amount', width: 16 },
    { header: 'Tài khoản / Ví', key: 'wallet', width: 22 },
    { header: 'Ví đích (nếu chuyển)', key: 'toWallet', width: 22 },
    { header: 'Ghi chú', key: 'note', width: 30 },
    { header: 'Nhãn phân loại', key: 'tags', width: 20 },
  ];
  transactions.forEach((t, idx) => {
    wsTx.addRow({
      stt: idx + 1,
      id: t.id,
      date: formatDate(t.date, 'full'),
      type: t.type === 'EXPENSE' ? 'Khoản chi' : t.type === 'INCOME' ? 'Khoản thu' : 'Chuyển khoản nội bộ',
      category: sanitizeCsvCell(t.categoryName || 'Khác'),
      amount: t.amount,
      wallet: sanitizeCsvCell(t.walletName || t.walletId),
      toWallet: sanitizeCsvCell(t.toWalletName || ''),
      note: sanitizeCsvCell(t.note || ''),
      tags: sanitizeCsvCell((t.tags || []).join(', ')),
    });
  });

  // Sheet 2: Tổng hợp tài sản & Ví
  const wsWallets = wb.addWorksheet('Tài Khoản & Ví');
  wsWallets.columns = [
    { header: 'Tên Ví / Tài khoản', key: 'name', width: 25 },
    { header: 'Loại ví', key: 'type', width: 16 },
    { header: 'Số dư hiện tại (₫)', key: 'balance', width: 18 },
    { header: 'Hạn mức (Thẻ tín dụng)', key: 'limit', width: 22 },
    { header: 'Lãi suất (%/năm)', key: 'rate', width: 16 },
    { header: 'Số tài khoản / Thẻ', key: 'acc', width: 22 },
  ];
  wallets.forEach((w) => {
    wsWallets.addRow({
      name: sanitizeCsvCell(w.name),
      type: w.type === 'CASH' ? 'Tiền mặt' : w.type === 'BANK' ? 'Ngân hàng' : w.type === 'CREDIT' ? 'Thẻ tín dụng' : 'Sổ tiết kiệm',
      balance: w.balance,
      limit: w.creditLimit || '-',
      rate: w.interestRate ? `${w.interestRate}%` : '-',
      acc: sanitizeCsvCell(w.accountNumber || '-'),
    });
  });

  // Sheet 3: Báo cáo ngân sách
  const wsBudgets = wb.addWorksheet('Theo Dõi Ngân Sách');
  wsBudgets.columns = [
    { header: 'Danh mục', key: 'cat', width: 22 },
    { header: 'Hạn mức tháng (₫)', key: 'amount', width: 18 },
    { header: 'Đã chi tiêu (₫)', key: 'spent', width: 18 },
    { header: 'Còn lại (₫)', key: 'rem', width: 18 },
    { header: 'Tỷ lệ đã dùng (%)', key: 'pct', width: 18 },
    { header: 'Tình trạng cảnh báo', key: 'status', width: 24 },
  ];
  const budgetStatuses = calculateBudgetStatuses(budgets, transactions);
  budgetStatuses.forEach((bs) => {
    wsBudgets.addRow({
      cat: sanitizeCsvCell(bs.budget.categoryName),
      amount: bs.budget.amount,
      spent: bs.spent,
      rem: bs.remaining,
      pct: `${bs.percentage}%`,
      status: bs.status === 'EXCEEDED' ? 'VƯỢT 100% NGÂN SÁCH' : bs.status === 'WARNING' ? 'CẢNH BÁO (>80%)' : 'An toàn',
    });
  });

  // Sheet 4: Chỉ số tài chính tổng quan
  const wsKPI = wb.addWorksheet('Tổng Hợp Tài Chính');
  wsKPI.columns = [
    { header: 'Chỉ tiêu', key: 'label', width: 35 },
    { header: 'Giá trị (₫)', key: 'val', width: 20 },
  ];
  const kpiData = [
    { label: 'Tổng tài sản ròng', val: summary.totalAssets },
    { label: 'Số dư khả dụng (Tiền mặt + Ngân hàng)', val: summary.availableBalance },
    { label: 'Dư nợ thẻ tín dụng', val: summary.totalCreditDebt },
    { label: 'Tổng tiền gửi tiết kiệm', val: summary.totalSavings },
    { label: 'Tổng thu nhập tháng này', val: summary.monthlyIncome },
    { label: 'Tổng chi tiêu tháng này', val: summary.monthlyExpense },
    { label: 'Tích lũy ròng trong tháng', val: summary.netSavingsThisMonth },
    { label: 'Tỷ lệ tiết kiệm', val: `${summary.savingsRate}%` },
  ];
  kpiData.forEach((r) => wsKPI.addRow(r));

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
