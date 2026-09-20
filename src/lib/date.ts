/**
 * Date & Timezone Utilities
 *
 * Requirements:
 * - Strict calendar validation (month ranges, actual days per month, leap years).
 * - Format local HTML date inputs as YYYY-MM-DD without UTC shift bugs.
 * - Convert Vietnam calendar dates (Asia/Ho_Chi_Minh +07:00) into exact UTC / Unix epoch seconds for Gmail queries.
 * - Enforce financial transaction occurrence boundaries (occurredAt).
 */

/**
 * Determine if a year is a leap year in Gregorian calendar
 */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Get number of days in a given month (1-indexed)
 */
export function getDaysInMonth(year: number, month: number): number {
  if (month < 1 || month > 12) return 0;
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if ([4, 6, 9, 11].includes(month)) return 30;
  return 31;
}

/**
 * Validate that a year, month, and day form a valid calendar date
 */
export function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }
  if (year < 1900 || year > 2100) return false;
  if (month < 1 || month > 12) return false;
  const maxDays = getDaysInMonth(year, month);
  return day >= 1 && day <= maxDays;
}

/**
 * Strictly parse and validate an ISO calendar string "YYYY-MM-DD"
 * Rejects impossible dates (e.g. 2026-02-31, 2026-02-29, 2026-13-01) instead of normalizing them.
 */
export function parseAndValidateIsoDate(dateStr: string): { year: number; month: number; day: number } {
  if (typeof dateStr !== 'string') {
    throw new Error(`Định dạng ngày không hợp lệ: ${String(dateStr)}`);
  }
  const trimmed = dateStr.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) {
    throw new Error(`Định dạng ngày không hợp lệ (yêu cầu YYYY-MM-DD): ${dateStr}`);
  }

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  if (!isValidCalendarDate(year, month, day)) {
    throw new Error(`Ngày không hợp lệ (không tồn tại trong lịch): ${dateStr}`);
  }

  return { year, month, day };
}

/**
 * Format a Date object as a local calendar string "YYYY-MM-DD"
 * Uses local getFullYear(), getMonth(), getDate() — NEVER toISOString() which shifts to UTC
 */
export function formatLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Get default Vietnam-local date range for current month-to-date:
 * fromDate: 1st day of user's current month
 * toDate: current day
 */
export function getDefaultLocalDateRange(now: Date = new Date()): { fromDate: string; toDate: string } {
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    fromDate: formatLocalDate(firstDay),
    toDate: formatLocalDate(now),
  };
}

/**
 * Convert a Vietnamese calendar date "YYYY-MM-DD" at 00:00:00 +07:00 into Unix epoch seconds
 * Uses strict calendar validation to prevent impossible date normalization.
 */
export function vietnamMidnightToEpochSeconds(dateStr: string): number {
  const { year, month, day } = parseAndValidateIsoDate(dateStr);
  const yStr = String(year).padStart(4, '0');
  const mStr = String(month).padStart(2, '0');
  const dStr = String(day).padStart(2, '0');
  const isoWithOffset = `${yStr}-${mStr}-${dStr}T00:00:00+07:00`;
  const ms = Date.parse(isoWithOffset);
  if (isNaN(ms)) {
    throw new Error(`Giá trị ngày không hợp lệ: ${dateStr}`);
  }
  return Math.floor(ms / 1000);
}

/**
 * Given a "YYYY-MM-DD" date, calculate the start of the NEXT calendar day at 00:00:00 +07:00 in epoch seconds.
 * Used for exclusive upper bound queries.
 */
export function getNextDayVietnamMidnightToEpochSeconds(dateStr: string): number {
  const startSeconds = vietnamMidnightToEpochSeconds(dateStr);
  // Exactly 24 hours (86400 seconds) later in standard UTC+7 (no DST in Vietnam)
  return startSeconds + 86400;
}

/**
 * Get millisecond range boundaries for transaction occurredAt filtering
 */
export function getVietnamDateRangeBoundaries(
  fromDateStr?: string,
  toDateStr?: string
): { rangeStartMs?: number; rangeEndMs?: number } {
  let rangeStartMs: number | undefined;
  let rangeEndMs: number | undefined;

  if (fromDateStr) {
    rangeStartMs = vietnamMidnightToEpochSeconds(fromDateStr) * 1000;
  }
  if (toDateStr) {
    rangeEndMs = getNextDayVietnamMidnightToEpochSeconds(toDateStr) * 1000;
  }

  return { rangeStartMs, rangeEndMs };
}

