/**
 * Date & Timezone Utilities
 *
 * Requirements:
 * - Format local HTML date inputs as YYYY-MM-DD without UTC shift bugs.
 * - Convert Vietnam calendar dates (Asia/Ho_Chi_Minh +07:00) into exact UTC / Unix epoch seconds for Gmail queries.
 * - Enforce financial transaction occurrence boundaries (occurredAt).
 */

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
 */
export function vietnamMidnightToEpochSeconds(dateStr: string): number {
  const trimmed = dateStr.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) {
    throw new Error(`Định dạng ngày không hợp lệ (yêu cầu YYYY-MM-DD): ${dateStr}`);
  }
  const isoWithOffset = `${match[1]}-${match[2]}-${match[3]}T00:00:00+07:00`;
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
