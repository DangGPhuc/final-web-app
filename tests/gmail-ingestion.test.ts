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

    it('proves pagination cap with maxMessages = 50 does not skip remainder of 100 messages across continuation', async () => {
      const origFetch = global.fetch;
      try {
        const totalMessages = Array.from({ length: 100 }, (_, i) => ({
          id: `msg_candidate_${i}`,
          threadId: `t_${i}`,
        }));

        global.fetch = vi.fn().mockImplementation((urlStr: string) => {
          const parsedUrl = new URL(urlStr);
          if (urlStr.includes('users/me/messages?')) {
            const pageToken = parsedUrl.searchParams.get('pageToken');
            const maxResults = parseInt(parsedUrl.searchParams.get('maxResults') || '100', 10);

            if (!pageToken) {
              // First batch: return first maxResults messages (e.g. 50) and token pointing to 50
              const batch = totalMessages.slice(0, maxResults);
              return Promise.resolve({
                ok: true,
                json: () =>
                  Promise.resolve({
                    messages: batch,
                    nextPageToken: 'token_batch_2',
                  }),
              });
            } else if (pageToken === 'token_batch_2') {
              // Second batch: return remainder (50 to 100)
              const batch = totalMessages.slice(50, 50 + maxResults);
              return Promise.resolve({
                ok: true,
                json: () =>
                  Promise.resolve({
                    messages: batch,
                    nextPageToken: undefined,
                  }),
              });
            }
          }

          // Message detail mock
          const msgId = parsedUrl.pathname.split('/').pop() || 'unknown';
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                id: msgId,
                snippet: 'VCB: TK ••••1234| GD: -10,000 VND | Test',
                internalDate: '1788950000000',
                payload: {
                  headers: [
                    { name: 'From', value: 'vietcombank@vcb.com.vn' },
                    { name: 'Subject', value: 'VCB: TK ••••1234| GD: -10,000 VND | Test' },
                    { name: 'Date', value: '2026-09-10T10:00:00Z' },
                  ],
                  body: { data: Buffer.from('VCB: TK ••••1234| GD: -10,000 VND | Test').toString('base64') },
                },
              }),
          });
        });

        // Run 1: maxMessages = 50
        const batch1 = await ingestFromGmail('mock_refresh_token_test', {
          maxMessages: 50,
        });

        expect(batch1.totalFetched).toBe(50);
        expect(batch1.truncated).toBe(true);
        expect(batch1.nextPageToken).toBe('token_batch_2');
        expect(batch1.events.map(e => e.gmailMessageId)).toEqual(
          totalMessages.slice(0, 50).map(m => m.id)
        );

        // Run 2: continuation with pageToken = batch1.nextPageToken
        const batch2 = await ingestFromGmail('mock_refresh_token_test', {
          maxMessages: 50,
          pageToken: batch1.nextPageToken,
        });

        expect(batch2.totalFetched).toBe(50);
        expect(batch2.truncated).toBe(false);
        expect(batch2.nextPageToken).toBeUndefined();
        expect(batch2.events.map(e => e.gmailMessageId)).toEqual(
          totalMessages.slice(50, 100).map(m => m.id)
        );

        // All 100 messages processed without skipping any messages
        const allFetchedIds = [
          ...batch1.events.map(e => e.gmailMessageId),
          ...batch2.events.map(e => e.gmailMessageId),
        ];
        expect(allFetchedIds).toHaveLength(100);
        expect(allFetchedIds).toEqual(totalMessages.map(m => m.id));
      } finally {
        global.fetch = origFetch;
      }
    });

    it('generates exact instant bounds with defensive overlap for Quick Scan snapshot mode', () => {
      // Default safety overlap of 2 seconds
      const queryWithOverlap = buildBankSearchQuery({
        mode: 'QUICK',
        lowerBoundEpoch: 1788195600,
        upperBoundEpoch: 1788199200,
      });

      // lowerBoundEpoch - 2s = 1788195598
      expect(queryWithOverlap).toContain('after:1788195598');
      // upperBoundEpoch + 2s = 1788199202
      expect(queryWithOverlap).toContain('before:1788199202');

      // Without overlap (exact seconds)
      const exactQuery = buildBankSearchQuery({
        mode: 'QUICK',
        lowerBoundEpoch: 1788195600,
        upperBoundEpoch: 1788199200,
        safetyOverlapSeconds: 0,
      });
      expect(exactQuery).toContain('after:1788195600');
      expect(exactQuery).toContain('before:1788199200');
    });

    describe('Authoritative Half-Open internalDate Boundary Filter ([lowerBoundEpoch, upperBoundEpoch))', () => {
      const lowerBoundEpoch = 1788195600; // e.g. T0
      const upperBoundEpoch = 1788199200; // e.g. T1
      const lowerBoundMs = lowerBoundEpoch * 1000;
      const upperBoundMs = upperBoundEpoch * 1000;

      async function testMessageWithInternalDate(internalDateStr: string) {
        const origFetch = global.fetch;
        try {
          global.fetch = vi.fn().mockImplementation(async (urlStr: string) => {
            if (urlStr.includes('/messages?')) {
              return {
                ok: true,
                status: 200,
                json: async () => ({
                  messages: [{ id: 'msg-boundary-test', threadId: 'th-1' }],
                }),
              };
            }
            if (urlStr.includes('/messages/msg-boundary-test')) {
              return {
                ok: true,
                status: 200,
                json: async () => ({
                  id: 'msg-boundary-test',
                  snippet: 'VCB: TK 1234| GD: -10,000 VND | 05/09/2026',
                  internalDate: internalDateStr,
                  payload: {
                    headers: [
                      { name: 'From', value: 'vietcombank@vcb.com.vn' },
                      { name: 'Subject', value: 'VCB: TK 1234| GD: -10,000 VND | 05/09/2026' },
                      { name: 'Date', value: 'Sat, 05 Sep 2026 09:30:00 +0700' },
                    ],
                    body: {
                      data: Buffer.from('VCB: TK 1234| GD: -10,000 VND | 05/09/2026').toString('base64'),
                    },
                  },
                }),
              };
            }
            return { ok: true, status: 200, json: async () => ({}) };
          });

          return await ingestFromGmail('test-refresh-token', {
            mode: 'QUICK',
            lowerBoundEpoch,
            upperBoundEpoch,
          });
        } finally {
          global.fetch = origFetch;
        }
      }

      it('message internalDate = lower bound → INCLUDED', async () => {
        const res = await testMessageWithInternalDate(String(lowerBoundMs));
        expect(res.events).toHaveLength(1);
        expect(res.events[0].gmailMessageId).toBe('msg-boundary-test');
      });

      it('message internalDate = lower bound - 1 ms → EXCLUDED', async () => {
        const res = await testMessageWithInternalDate(String(lowerBoundMs - 1));
        expect(res.events).toHaveLength(0);
      });

      it('message internalDate = upper bound - 1 ms → INCLUDED', async () => {
        const res = await testMessageWithInternalDate(String(upperBoundMs - 1));
        expect(res.events).toHaveLength(1);
        expect(res.events[0].gmailMessageId).toBe('msg-boundary-test');
      });

      it('message internalDate = upper bound → EXCLUDED', async () => {
        const res = await testMessageWithInternalDate(String(upperBoundMs));
        expect(res.events).toHaveLength(0);
      });

      it('two consecutive scans sharing the same watermark have no uncovered instant', async () => {
        const watermarkInstant = String(upperBoundMs); // This instant sits right on the shared watermark boundary

        // Scan 1: [T0, T1) - should exclude watermarkInstant
        const scan1 = await testMessageWithInternalDate(watermarkInstant);
        expect(scan1.events).toHaveLength(0);

        // Scan 2: [T1, T2) where lowerBoundEpoch = T1 - should include watermarkInstant
        const origFetch = global.fetch;
        try {
          global.fetch = vi.fn().mockImplementation(async (urlStr: string) => {
            if (urlStr.includes('/messages?')) {
              return {
                ok: true,
                status: 200,
                json: async () => ({
                  messages: [{ id: 'msg-boundary-test', threadId: 'th-1' }],
                }),
              };
            }
            if (urlStr.includes('/messages/msg-boundary-test')) {
              return {
                ok: true,
                status: 200,
                json: async () => ({
                  id: 'msg-boundary-test',
                  snippet: 'VCB: TK 1234| GD: -10,000 VND | 05/09/2026',
                  internalDate: watermarkInstant,
                  payload: {
                    headers: [
                      { name: 'From', value: 'vietcombank@vcb.com.vn' },
                      { name: 'Subject', value: 'VCB: TK 1234| GD: -10,000 VND | 05/09/2026' },
                      { name: 'Date', value: 'Sat, 05 Sep 2026 09:30:00 +0700' },
                    ],
                    body: {
                      data: Buffer.from('VCB: TK 1234| GD: -10,000 VND | 05/09/2026').toString('base64'),
                    },
                  },
                }),
              };
            }
            return { ok: true, status: 200, json: async () => ({}) };
          });

          const scan2 = await ingestFromGmail('test-refresh-token', {
            mode: 'QUICK',
            lowerBoundEpoch: upperBoundEpoch, // T1
            upperBoundEpoch: upperBoundEpoch + 3600, // T2
          });

          expect(scan2.events).toHaveLength(1);
          expect(scan2.events[0].gmailMessageId).toBe('msg-boundary-test');
        } finally {
          global.fetch = origFetch;
        }
      });

      it('QUICK + missing internalDate → event excluded → failedCount increments', async () => {
        const origFetch = global.fetch;
        try {
          global.fetch = vi.fn().mockImplementation(async (urlStr: string) => {
            if (urlStr.includes('/messages?')) {
              return {
                ok: true,
                status: 200,
                json: async () => ({ messages: [{ id: 'msg-no-internal-date' }] }),
              };
            }
            if (urlStr.includes('/messages/msg-no-internal-date')) {
              return {
                ok: true,
                status: 200,
                json: async () => ({
                  id: 'msg-no-internal-date',
                  snippet: 'VCB: TK 1234| GD: -10,000 VND | 05/09/2026',
                  // internalDate missing completely!
                  payload: {
                    headers: [
                      { name: 'From', value: 'vietcombank@vcb.com.vn' },
                      { name: 'Subject', value: 'VCB: TK 1234| GD: -10,000 VND | 05/09/2026' },
                      { name: 'Date', value: 'Sat, 05 Sep 2026 09:30:00 +0700' },
                    ],
                    body: {
                      data: Buffer.from('VCB: TK 1234| GD: -10,000 VND | 05/09/2026').toString('base64'),
                    },
                  },
                }),
              };
            }
            return { ok: true, status: 200, json: async () => ({}) };
          });

          const res = await ingestFromGmail('test-refresh-token', {
            mode: 'QUICK',
            lowerBoundEpoch,
            upperBoundEpoch,
          });

          expect(res.events).toHaveLength(0);
          expect(res.failedCount).toBe(1);
        } finally {
          global.fetch = origFetch;
        }
      });

      it('QUICK + invalid internalDate (non-numeric or <= 0) → event excluded → failedCount increments', async () => {
        const origFetch = global.fetch;
        try {
          global.fetch = vi.fn().mockImplementation(async (urlStr: string) => {
            if (urlStr.includes('/messages?')) {
              return {
                ok: true,
                status: 200,
                json: async () => ({ messages: [{ id: 'msg-invalid-internal-date' }] }),
              };
            }
            if (urlStr.includes('/messages/msg-invalid-internal-date')) {
              return {
                ok: true,
                status: 200,
                json: async () => ({
                  id: 'msg-invalid-internal-date',
                  snippet: 'VCB: TK 1234| GD: -10,000 VND | 05/09/2026',
                  internalDate: 'not-a-number', // non-numeric
                  payload: {
                    headers: [
                      { name: 'From', value: 'vietcombank@vcb.com.vn' },
                      { name: 'Subject', value: 'VCB: TK 1234| GD: -10,000 VND | 05/09/2026' },
                      { name: 'Date', value: 'Sat, 05 Sep 2026 09:30:00 +0700' },
                    ],
                    body: {
                      data: Buffer.from('VCB: TK 1234| GD: -10,000 VND | 05/09/2026').toString('base64'),
                    },
                  },
                }),
              };
            }
            return { ok: true, status: 200, json: async () => ({}) };
          });

          const res = await ingestFromGmail('test-refresh-token', {
            mode: 'QUICK',
            lowerBoundEpoch,
            upperBoundEpoch,
          });

          expect(res.events).toHaveLength(0);
          expect(res.failedCount).toBe(1);
        } finally {
          global.fetch = origFetch;
        }
      });

      it('QUICK + valid internalDate → normal half-open filter applies', async () => {
        const res = await testMessageWithInternalDate(String(lowerBoundMs + 5000));
        expect(res.events).toHaveLength(1);
        expect(res.events[0].gmailMessageId).toBe('msg-boundary-test');
        expect(res.failedCount).toBe(0);
      });
    });
  });
});
