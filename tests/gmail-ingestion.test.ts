import { describe, it, expect } from 'vitest';
import {
  decodeBase64Url,
  sanitizeHtmlToText,
  parseBankNotification,
  type RawEmailData,
} from '../src/lib/email/bank-parsers';
import { formatGmailDateQuery } from '../src/lib/email/gmail-client';

describe('Gmail Ingestion & Bank Parsing', () => {
  describe('Gmail Query Date Formatter', () => {
    it('formats dates in YYYY/MM/DD for Gmail search queries', () => {
      const date = new Date('2026-09-05T12:00:00Z');
      expect(formatGmailDateQuery(date)).toBe('2026/09/05');
    });
  });

  describe('MIME & Base64url Decoding', () => {
    it('decodes base64url data correctly', () => {
      const original = 'Số tiền ghi có: 25,000,000 VND';
      const base64url = Buffer.from(original, 'utf-8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      expect(decodeBase64Url(base64url)).toBe(original);
    });

    it('sanitizes HTML body to plain text', () => {
      const html = `
        <html>
          <head><style>.blue { color: blue; }</style></head>
          <body>
            <p>VCB: TK 1234| GD: -120,000 VND | <strong>Thanh toan Cafe Highland</strong></p>
          </body>
        </html>
      `;
      const plain = sanitizeHtmlToText(html);
      expect(plain).not.toContain('<p>');
      expect(plain).not.toContain('<strong>');
      expect(plain).not.toContain('.blue');
      expect(plain).toContain('VCB: TK 1234| GD: -120,000 VND | Thanh toan Cafe Highland');
    });
  });

  describe('Bank Financial Event Extraction', () => {
    it('parses Vietcombank expense email with merchant hint', () => {
      const raw: RawEmailData = {
        id: 'msg-vcb-1',
        from: 'vietcombank@vcb.com.vn',
        subject: 'VCB: TK ••••1234| GD: -120,000 VND | 06/09/2026 | Thanh toan Cafe Highland Nguyen Du',
        snippet: 'VCB: TK ••••1234| GD: -120,000 VND | 06/09/2026 | Thanh toan Cafe Highland Nguyen Du',
        bodyText: 'Chi tiet giao dich...',
        date: '2026-09-06T14:15:00.000Z',
      };

      const event = parseBankNotification(raw);
      expect(event).not.toBeNull();
      expect(event?.bankCode).toBe('VCB');
      expect(event?.direction).toBe('OUT');
      expect(event?.amount).toBe(120000);
      expect(event?.currency).toBe('VND');
      expect(event?.accountHint).toBe('••••1234');
      expect(event?.merchantLabel).toBe('Highlands Coffee');
    });

    it('parses Vietcombank salary credit email', () => {
      const raw: RawEmailData = {
        id: 'msg-vcb-2',
        from: 'vietcombank@vcb.com.vn',
        subject: 'VCB: TK ••••1234| GD: +25,000,000 VND | 05/09/2026 | Cong ty CP Cong nghe chuyen luong Thang 9',
        snippet: 'VCB: TK ••••1234| GD: +25,000,000 VND | 05/09/2026 | Cong ty CP Cong nghe chuyen luong Thang 9',
        bodyText: '',
        date: '2026-09-05T09:30:00.000Z',
      };

      const event = parseBankNotification(raw);
      expect(event).not.toBeNull();
      expect(event?.direction).toBe('IN');
      expect(event?.amount).toBe(25000000);
      expect(event?.bankName).toBe('Vietcombank');
    });

    it('parses Techcombank debit email with Shopee merchant hint', () => {
      const raw: RawEmailData = {
        id: 'msg-tcb-1',
        from: 'alert@techcombank.com.vn',
        subject: 'Thông báo biến động số dư tài khoản',
        snippet: 'So tien ghi no: 1,850,000 VND luc 10/09/2026 tai khoan 8821. Dien giai: Mua sam Shopee don hang 98231',
        bodyText: '',
        date: '2026-09-10T19:20:00.000Z',
      };

      const event = parseBankNotification(raw);
      expect(event).not.toBeNull();
      expect(event?.bankCode).toBe('TCB');
      expect(event?.direction).toBe('OUT');
      expect(event?.amount).toBe(1850000);
      expect(event?.merchantLabel).toBe('Shopee');
    });

    it('returns null for spam / non-financial emails without guessing money movement', () => {
      const spam: RawEmailData = {
        id: 'msg-spam',
        from: 'newsletter@promo.com',
        subject: 'Ưu đãi thẻ tín dụng cuối năm',
        snippet: 'Nhận hoàn tiền lên tới 50% khi mở thẻ tín dụng mới',
        bodyText: 'Chương trình áp dụng cho tất cả khách hàng mới',
        date: '2026-09-15T00:00:00.000Z',
      };

      const event = parseBankNotification(spam);
      expect(event).toBeNull();
    });
  });
});
