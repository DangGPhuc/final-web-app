import { describe, it, expect } from 'vitest';
import {
  parseVietnameseBankTimestamp,
  extractBankRefId,
  parseBankNotification,
  type RawEmailData,
} from '@/lib/email/bank-parsers';
import { buildBankSearchQuery, BANK_NOTIFICATION_REGISTRY } from '@/lib/email/gmail-client';

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

    it('falls back to emailReceivedAt when notification contains no extractable bank timestamp', () => {
      const email: RawEmailData = {
        id: 'msg_fallback_001',
        from: 'vietcombank@vcb.com.vn',
        subject: 'VCB: TK ••••1234| GD: -50,000 VND | Chuyen tien',
        snippet: 'VCB: TK ••••1234| GD: -50,000 VND',
        bodyText: 'VCB: TK ••••1234| GD: -50,000 VND | Chuyen tien',
        date: '2026-09-07T08:00:00.000Z',
      };

      const parsed = parseBankNotification(email);
      expect(parsed).not.toBeNull();
      expect(parsed!.occurredAt.toISOString()).toBe('2026-09-07T08:00:00.000Z');
      expect(parsed!.emailReceivedAt.toISOString()).toBe('2026-09-07T08:00:00.000Z');
    });
  });

  describe('Bank Reference Normalization', () => {
    it('normalizes bank reference ID to uppercase and strips trailing punctuation', () => {
      expect(extractBankRefId('Giao dịch thành công. Mã GD: ft262490001.')).toBe('FT262490001');
      expect(extractBankRefId('Số GD: 98231; tai khoan 123')).toBe('98231');
      expect(extractBankRefId('Ref: VCB-2026-XYZ-99.')).toBe('VCB-2026-XYZ-99');
    });
  });

  describe('Targeted Bank Search Query Generator', () => {
    it('builds query with per-bank sender and signature clauses', () => {
      const query = buildBankSearchQuery();
      expect(query).toContain('@vietcombank.com.vn');
      expect(query).toContain('@techcombank.com.vn');
      expect(query).toContain('Fwd:');
      expect(query).toContain('chuyển tiếp');
    });

    it('includes after and before date filters when provided', () => {
      const query = buildBankSearchQuery({
        fromDate: new Date('2026-09-01T00:00:00Z'),
        toDate: new Date('2026-09-10T00:00:00Z'),
      });
      expect(query).toContain('after:2026/09/01');
      expect(query).toContain('before:2026/09/11');
    });
  });
});
