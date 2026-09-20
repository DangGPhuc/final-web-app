import { describe, it, expect } from 'vitest';
import {
  parseVietnameseBankTimestamp,
  extractBankRefId,
  parseBankNotification,
  type RawEmailData,
} from '@/lib/email/bank-parsers';
import { buildBankSearchQuery, BANK_NOTIFICATION_REGISTRY } from '@/lib/email/gmail-client';
import {
  vietnamMidnightToEpochSeconds,
  getNextDayVietnamMidnightToEpochSeconds,
  formatLocalDate,
  getVietnamDateRangeBoundaries,
} from '@/lib/date';

describe('Bank Transaction Timestamp & Notification Parsing', () => {
  describe('Vietnamese Banking Timestamp Parsing (Asia/Ho_Chi_Minh UTC+7)', () => {
    it('parses DD/MM/YYYY HH:mm into exact UTC instant', () => {
      const parsed = parseVietnameseBankTimestamp('Giao dịch thực hiện lúc 05/09/2026 09:30');
      expect(parsed).not.toBeNull();
      // 09:30 in UTC+7 is 02:30 in UTC
      expect(parsed!.toISOString()).toBe('2026-09-05T02:30:00.000Z');
    });

    it('parses DD/MM/YYYY HH:mm:ss into exact UTC instant', () => {
      const parsed = parseVietnameseBankTimestamp('Thời gian: 05/09/2026 09:30:15');
      expect(parsed).not.toBeNull();
      expect(parsed!.toISOString()).toBe('2026-09-05T02:30:15.000Z');
    });

    it('parses pipe-separated VCB notification format (05/09/2026 | 09:30)', () => {
      const parsed = parseVietnameseBankTimestamp('VCB: TK ••••1234| GD: +25,000,000 VND | 05/09/2026 09:30 | Chuyen tien');
      expect(parsed).not.toBeNull();
      expect(parsed!.toISOString()).toBe('2026-09-05T02:30:00.000Z');
    });

    it('parses Techcombank timestamp format (luc 10/09/2026 19:20)', () => {
      const parsed = parseVietnameseBankTimestamp('So tien ghi no: 1,850,000 VND luc 10/09/2026 19:20 tai khoan 8821');
      expect(parsed).not.toBeNull();
      // 19:20 in UTC+7 is 12:20 in UTC
      expect(parsed!.toISOString()).toBe('2026-09-10T12:20:00.000Z');
    });

    it('falls back to noon UTC+7 when only date is present (DD/MM/YYYY)', () => {
      const parsed = parseVietnameseBankTimestamp('Giao dich ngay 05/09/2026');
      expect(parsed).not.toBeNull();
      // 12:00 in UTC+7 is 05:00 in UTC
      expect(parsed!.toISOString()).toBe('2026-09-05T05:00:00.000Z');
    });
  });

  describe('Strict Calendar Date Validation (Leap Years & Impossible Days)', () => {
    it('accepts 2026-02-28 as valid standard year February end', () => {
      expect(() => vietnamMidnightToEpochSeconds('2026-02-28')).not.toThrow();
    });

    it('accepts 2028-02-29 as valid leap year February leap day', () => {
      expect(() => vietnamMidnightToEpochSeconds('2028-02-29')).not.toThrow();
    });

    it('rejects 2026-02-29 as invalid non-leap year date', () => {
      expect(() => vietnamMidnightToEpochSeconds('2026-02-29')).toThrow(/không tồn tại trong lịch/);
    });

    it('rejects 2026-02-31 as impossible calendar date', () => {
      expect(() => vietnamMidnightToEpochSeconds('2026-02-31')).toThrow(/không tồn tại trong lịch/);
    });

    it('rejects 2026-13-01 as impossible month', () => {
      expect(() => vietnamMidnightToEpochSeconds('2026-13-01')).toThrow(/không tồn tại trong lịch/);
    });

    it('does NOT normalize invalid bank calendar dates like 31/02/2026 into March', () => {
      const parsed = parseVietnameseBankTimestamp('Giao dich thuc hien luc 31/02/2026 09:30');
      // Must return null, NOT March 3rd!
      expect(parsed).toBeNull();
    });

    it('falls back to emailReceivedAt when notification contains an invalid bank calendar date', () => {
      const email: RawEmailData = {
        id: 'msg_invalid_date_001',
        from: 'vietcombank@vcb.com.vn',
        subject: 'VCB: TK ••••1234| GD: -100,000 VND | 31/02/2026 09:30 | Cafe',
        snippet: 'VCB: TK ••••1234| GD: -100,000 VND | 31/02/2026 09:30',
        bodyText: 'VCB: TK ••••1234| GD: -100,000 VND | 31/02/2026 09:30',
        date: '2026-09-05T09:35:00.000Z',
      };
      const result = parseBankNotification(email);
      expect(result).not.toBeNull();
      // Should fall back to emailReceivedAt, not silently normalize to March 3rd
      expect(result!.occurredAt.toISOString()).toBe('2026-09-05T09:35:00.000Z');
    });
  });

  describe('Vietnam Calendar Date Boundaries to Unix Epoch Seconds', () => {
    it('proves 2026-09-01 Vietnam local midnight produces the correct UTC/epoch instant', () => {
      const epochSeconds = vietnamMidnightToEpochSeconds('2026-09-01');
      // 2026-09-01 00:00:00 +07:00 is 2026-08-31 17:00:00 UTC
      expect(epochSeconds).toBe(1788195600);
      const utcDate = new Date(epochSeconds * 1000);
      expect(utcDate.toISOString()).toBe('2026-08-31T17:00:00.000Z');
    });

    it('calculates the next day midnight exclusive boundary for 2026-09-20', () => {
      const epochSeconds = getNextDayVietnamMidnightToEpochSeconds('2026-09-20');
      // Next day is 2026-09-21 00:00:00 +07:00 -> 2026-09-20 17:00:00 UTC
      expect(epochSeconds).toBe(1789923600);
      const utcDate = new Date(epochSeconds * 1000);
      expect(utcDate.toISOString()).toBe('2026-09-20T17:00:00.000Z');
    });

    it('returns boundary milliseconds for occurredAt filtering', () => {
      const { rangeStartMs, rangeEndMs } = getVietnamDateRangeBoundaries('2026-09-01', '2026-09-20');
      expect(rangeStartMs).toBe(1788195600 * 1000);
      expect(rangeEndMs).toBe(1789923600 * 1000);
    });
  });

  describe('Local HTML Date Generation (formatLocalDate)', () => {
    it('formats a date as YYYY-MM-DD using local calendar date', () => {
      const date = new Date(2026, 8, 1); // September 1st, 2026
      expect(formatLocalDate(date)).toBe('2026-09-01');
    });
  });

  describe('Forwarded Mail Timestamp Separation (occurredAt vs emailReceivedAt)', () => {
    it('preserves the original bank occurredAt even when email is delivered/forwarded one day later', () => {
      // Email was forwarded and received on 06/09/2026
      const emailReceivedDate = '2026-09-06T10:00:00.000Z';

      const email: RawEmailData = {
        id: 'msg_fwd_001',
        from: 'secondary.account@gmail.com', // forwarded by user
        subject: 'Fwd: VCB: TK ••••1234| GD: -120,000 VND | 05/09/2026 09:30 | Thanh toan Cafe Highland',
        snippet: '---------- Forwarded message --------- VCB: TK ••••1234| GD: -120,000 VND | 05/09/2026 09:30',
        bodyText:
          '---------- Forwarded message --------- From: vietcombank@vcb.com.vn VCB: TK ••••1234| GD: -120,000 VND | 05/09/2026 09:30 | Mã GD: FT262490001 | Thanh toan Cafe Highland',
        date: emailReceivedDate,
      };

      const parsed = parseBankNotification(email);
      expect(parsed).not.toBeNull();

      // Financial occurredAt must be the bank timestamp (05/09/2026 09:30 UTC+7 -> 02:30 UTC)
      expect(parsed!.occurredAt.toISOString()).toBe('2026-09-05T02:30:00.000Z');

      // Raw emailReceivedAt must be the actual Gmail receipt time (06/09/2026 10:00 UTC)
      expect(parsed!.emailReceivedAt.toISOString()).toBe('2026-09-06T10:00:00.000Z');

      expect(parsed!.amount).toBe(120000);
      expect(parsed!.direction).toBe('OUT');
      expect(parsed!.bankCode).toBe('VCB');
      expect(parsed!.bankRefId).toBe('FT262490001');
    });

    it('prefers Gmail internalDate over RFC Date header for emailReceivedAt', () => {
      const email: RawEmailData = {
        id: 'msg_internal_date_001',
        from: 'vietcombank@vcb.com.vn',
        subject: 'VCB: TK ••••1234| GD: -50,000 VND | 05/09/2026 09:30 | Chuyen tien',
        snippet: 'VCB: TK ••••1234| GD: -50,000 VND',
        bodyText: 'VCB: TK ••••1234| GD: -50,000 VND | Chuyen tien',
        date: '2026-09-05T09:35:00.000Z', // RFC Date header
        internalDate: '1788602400000', // 2026-09-05T10:00:00.000Z in epoch ms
      };

      const parsed = parseBankNotification(email);
      expect(parsed).not.toBeNull();
      // occurredAt extracted from text
      expect(parsed!.occurredAt.toISOString()).toBe('2026-09-05T02:30:00.000Z');
      // emailReceivedAt must use internalDate
      expect(parsed!.emailReceivedAt.getTime()).toBe(1788602400000);
    });

    it('falls back to RFC Date header when internalDate is absent', () => {
      const email: RawEmailData = {
        id: 'msg_fallback_header_001',
        from: 'vietcombank@vcb.com.vn',
        subject: 'VCB: TK ••••1234| GD: -50,000 VND | 05/09/2026 09:30 | Chuyen tien',
        snippet: 'VCB: TK ••••1234| GD: -50,000 VND',
        bodyText: 'VCB: TK ••••1234| GD: -50,000 VND | Chuyen tien',
        date: '2026-09-05T09:35:00.000Z',
      };

      const parsed = parseBankNotification(email);
      expect(parsed).not.toBeNull();
      expect(parsed!.emailReceivedAt.toISOString()).toBe('2026-09-05T09:35:00.000Z');
    });
  });

  describe('Bank Reference Normalization', () => {
    it('normalizes bank reference ID to uppercase and strips trailing punctuation', () => {
      expect(extractBankRefId('Giao dịch thành công. Mã GD: ft262490001.')).toBe('FT262490001');
      expect(extractBankRefId('Số GD: 98231; tai khoan 123')).toBe('98231');
      expect(extractBankRefId('Ref: VCB-2026-XYZ-99.')).toBe('VCB-2026-XYZ-99');
    });
  });

  describe('Documented Targeted Bank Search Query Generator', () => {
    it('builds query with documented per-bank sender and signature clauses', () => {
      const query = buildBankSearchQuery();
      expect(query).toContain('from:vietcombank.com.vn');
      expect(query).toContain('from:techcombank.com.vn');
      expect(query).toContain('from:mbbank.com.vn');
      expect(query).toContain('Fwd:');
      expect(query).toContain('chuyển tiếp');
    });

    it('includes after and before epoch second filters converted from Vietnam midnight', () => {
      const query = buildBankSearchQuery({
        fromDate: '2026-09-01',
        toDate: '2026-09-20',
        candidateCushionSeconds: 0,
      });
      // 2026-09-01 00:00:00 +07:00 is 1788195600
      expect(query).toContain('after:1788195600');
      // 2026-09-21 00:00:00 +07:00 is 1789923600
      expect(query).toContain('before:1789923600');
    });
  });
});
