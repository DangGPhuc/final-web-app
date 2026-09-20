import { describe, it, expect, vi } from 'vitest';
import {
  decodeBase64Url,
  sanitizeHtmlToText,
  parseBankNotification,
  type RawEmailData,
} from '../src/lib/email/bank-parsers';
import {
  buildBankSearchQuery,
  ingestFromGmail,
  GmailTokenRevokedError,
  GmailConfigError,
  GmailTransientError,
} from '../src/lib/email/gmail-client';
import { formatLocalDate } from '../src/lib/date';

describe('Gmail Ingestion & Bank Parsing', () => {
  describe('Local Date Formatter', () => {
    it('formats dates in YYYY-MM-DD for local input', () => {
      const date = new Date(2026, 8, 5); // Sep 5, 2026
      expect(formatLocalDate(date)).toBe('2026-09-05');
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

    it('extracts bankRefId and generates deterministic financial fingerprint', () => {
      const email: RawEmailData = {
        id: 'msg-ref-1',
        from: 'vietcombank@vcb.com.vn',
        subject: 'VCB: TK ••••1234| GD: -120,000 VND | Ref: FT262500001 | Highlands Coffee',
        snippet: 'VCB: TK ••••1234| GD: -120,000 VND | Ref: FT262500001 | Highlands Coffee',
        bodyText: '',
        date: '2026-09-06T14:15:00.000Z',
      };

      const event = parseBankNotification(email);
      expect(event).not.toBeNull();
      expect(event?.bankRefId).toBe('FT262500001');
      expect(event?.fingerprint).toBeDefined();
      expect(event?.fingerprint.length).toBe(64);
    });
  });

  describe('Bank Search Query Generation with Documented Syntax', () => {
    it('generates tightly grouped query with controlled sender domains and subject signatures', () => {
      const query = buildBankSearchQuery({
        fromDate: '2026-09-01',
        toDate: '2026-09-20',
      });

      expect(query).toContain('from:vietcombank.com.vn');
      expect(query).toContain('from:techcombank.com.vn');
      expect(query).toContain('biến động');
      expect(query).toContain('Fwd:');
      expect(query).toContain('chuyển tiếp');
      expect(query).toContain('after:1788195600');
      expect(query).toContain('before:1789923600');
    });
  });

  describe('Error Classification for Reconnects and API Failures', () => {
    it('differentiates revoked refresh token, API configuration, and transient server errors', () => {
      const revoked = new GmailTokenRevokedError('Token invalid');
      const configErr = new GmailConfigError('Insufficient scope');
      const transient = new GmailTransientError('503 Service Unavailable');

      expect(revoked instanceof GmailTokenRevokedError).toBe(true);
      expect(configErr instanceof GmailConfigError).toBe(true);
      expect(transient instanceof GmailTransientError).toBe(true);
      expect(configErr).not.toBeInstanceOf(GmailTokenRevokedError);
      expect(transient).not.toBeInstanceOf(GmailTokenRevokedError);
    });
  });

  describe('Pagination Beyond 200 Messages & Truncation Handling', () => {
    it('safely paginates across multiple pages without silent 200 truncation', async () => {
      const origFetch = global.fetch;
      try {
        let callCount = 0;
        global.fetch = vi.fn().mockImplementation((url: string) => {
          if (url.includes('users/me/messages?')) {
            callCount++;
            if (callCount === 1) {
              return Promise.resolve({
                ok: true,
                json: () =>
                  Promise.resolve({
                    messages: Array.from({ length: 100 }, (_, i) => ({
                      id: `msg_page1_${i}`,
                      threadId: `t1_${i}`,
                    })),
                    nextPageToken: 'token_page2',
                  }),
              });
            } else if (callCount === 2) {
              return Promise.resolve({
                ok: true,
                json: () =>
                  Promise.resolve({
                    messages: Array.from({ length: 100 }, (_, i) => ({
                      id: `msg_page2_${i}`,
                      threadId: `t2_${i}`,
                    })),
                    nextPageToken: 'token_page3',
                  }),
              });
            } else {
              return Promise.resolve({
                ok: true,
                json: () =>
                  Promise.resolve({
                    messages: Array.from({ length: 50 }, (_, i) => ({
                      id: `msg_page3_${i}`,
                      threadId: `t3_${i}`,
                    })),
                  }),
              });
            }
          }

          // Detail calls return a valid VCB email
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                id: 'mock_detail_id',
                snippet: 'VCB: TK 1234| GD: -50,000 VND | 10/09/2026 | Cafe',
                internalDate: '1788950000000',
                payload: {
                  headers: [
                    { name: 'From', value: 'vietcombank@vcb.com.vn' },
                    { name: 'Subject', value: 'VCB: TK 1234| GD: -50,000 VND | Cafe' },
                    { name: 'Date', value: '2026-09-10T10:00:00Z' },
                  ],
                  body: { data: Buffer.from('VCB: TK 1234| GD: -50,000 VND | Cafe').toString('base64') },
                },
              }),
          });
        });

        process.env.ALLOW_MOCK_OAUTH = 'true';
        const result = await ingestFromGmail('mock_refresh_token_test', {
          maxMessages: 500,
        });

        expect(result.totalFetched).toBe(250);
        expect(result.truncated).toBe(false);
        expect(callCount).toBe(3);
      } finally {
        global.fetch = origFetch;
      }
    });

    it('exposes truncated: true and nextPageToken when safety limit is reached', async () => {
      const origFetch = global.fetch;
      try {
        global.fetch = vi.fn().mockImplementation((url: string) => {
          if (url.includes('users/me/messages?')) {
            return Promise.resolve({
              ok: true,
              json: () =>
                Promise.resolve({
                  messages: Array.from({ length: 100 }, (_, i) => ({
                    id: `msg_p1_${i}`,
                    threadId: `t_${i}`,
                  })),
                  nextPageToken: 'token_next_page_overflow',
                }),
            });
          }
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                id: 'mock_detail',
                snippet: 'VCB: TK 1234| GD: -50,000 VND | Test',
                internalDate: '1788950000000',
                payload: { headers: [], body: {} },
              }),
          });
        });

        const result = await ingestFromGmail('mock_refresh_token_test', {
          maxMessages: 50,
        });

        expect(result.totalFetched).toBe(50);
        expect(result.truncated).toBe(true);
        expect(result.nextPageToken).toBe('token_next_page_overflow');
      } finally {
        global.fetch = origFetch;
      }
    });
  });
});
