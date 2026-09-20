import { refreshAccessToken } from '@/lib/oauth/google-oauth';
import {
  decodeBase64Url,
  sanitizeHtmlToText,
  parseBankNotification,
  type ParsedBankEvent,
  type RawEmailData,
} from './bank-parsers';
import {
  GmailTokenRevokedError,
  GmailConfigError,
  GmailTransientError,
  GmailTokenExpiredError,
} from './gmail-errors';
import {
  vietnamMidnightToEpochSeconds,
  getNextDayVietnamMidnightToEpochSeconds,
  formatLocalDate,
} from '@/lib/date';

export {
  GmailTokenRevokedError,
  GmailConfigError,
  GmailTransientError,
  GmailTokenExpiredError,
};

interface GmailMessageListResponse {
  messages?: { id: string; threadId: string }[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

interface GmailPart {
  mimeType: string;
  body?: { data?: string };
  parts?: GmailPart[];
}

interface GmailMessageDetailResponse {
  id: string;
  threadId: string;
  snippet: string;
  internalDate: string;
  payload: {
    headers: { name: string; value: string }[];
    body?: { data?: string };
    parts?: GmailPart[];
  };
}

export interface FetchEmailOptions {
  mode?: 'QUICK' | 'HISTORICAL';
  fromDate?: Date | string;
  toDate?: Date | string;
  lowerBoundEpoch?: number;
  upperBoundEpoch?: number;
  maxMessages?: number;
  pageToken?: string;
  candidateCushionSeconds?: number;
  safetyOverlapSeconds?: number;
}

export interface IngestionResult {
  events: ParsedBankEvent[];
  totalFetched: number;
  failedCount: number;
  truncated: boolean;
  nextPageToken?: string;
}

export interface BankRegistryEntry {
  bankCode: string;
  bankName: string;
  senderQuery: string;
  signatureQuery: string;
}

/**
 * Internal registry of recognized Vietnamese banks with strict sender domains and signatures
 * Documented Gmail search syntax without ambiguous symbols
 */
export const BANK_NOTIFICATION_REGISTRY: BankRegistryEntry[] = [
  {
    bankCode: 'VCB',
    bankName: 'Vietcombank',
    senderQuery: '(from:vietcombank.com.vn OR from:vcb.com.vn)',
    signatureQuery: '("biến động số dư" OR "biến động" OR "số dư" OR "giao dịch" OR "VCB:" OR "TK ••••")',
  },
  {
    bankCode: 'TCB',
    bankName: 'Techcombank',
    senderQuery: '(from:techcombank.com.vn OR from:tcb.com.vn)',
    signatureQuery: '("biến động số dư" OR "biến động" OR "số dư" OR "ghi nợ" OR "ghi có" OR "Techcombank")',
  },
  {
    bankCode: 'MB',
    bankName: 'MB Bank',
    senderQuery: 'from:mbbank.com.vn',
    signatureQuery: '("biến động số dư" OR "biến động" OR "số dư" OR "giao dịch" OR "MBBank")',
  },
  {
    bankCode: 'ACB',
    bankName: 'ACB',
    senderQuery: 'from:acb.com.vn',
    signatureQuery: '("biến động số dư" OR "biến động" OR "số dư" OR "ACB")',
  },
  {
    bankCode: 'VPB',
    bankName: 'VPBank',
    senderQuery: 'from:vpbank.com.vn',
    signatureQuery: '("biến động số dư" OR "biến động" OR "số dư" OR "VPBank")',
  },
  {
    bankCode: 'BIDV',
    bankName: 'BIDV',
    senderQuery: 'from:bidv.com.vn',
    signatureQuery: '("biến động số dư" OR "biến động" OR "số dư" OR "BIDV")',
  },
];

/**
 * Recursively extract text content from Gmail payload parts
 */
function extractBodyText(part: GmailPart): string {
  if (part.mimeType === 'text/plain' && part.body?.data) {
    return decodeBase64Url(part.body.data);
  }

  if (part.mimeType === 'text/html' && part.body?.data) {
    return sanitizeHtmlToText(decodeBase64Url(part.body.data));
  }

  if (part.parts && part.parts.length > 0) {
    for (const child of part.parts) {
      const text = extractBodyText(child);
      if (text) return text;
    }
  }

  return '';
}

/**
 * Build privacy-preserving targeted Gmail search query strictly from BANK_NOTIFICATION_REGISTRY.
 * Supports:
 * - Quick Scan snapshot mode: exact lowerBoundEpoch and upperBoundEpoch instants.
 * - Historical mode: Asia/Ho_Chi_Minh (+07:00) midnight boundaries with candidate boundary cushion.
 * Form: ( (Bank A sender AND signature) OR (Bank B sender AND signature) ... OR (Forwarded Bank Notification) ) after:... before:...
 */
export function buildBankSearchQuery(options: {
  mode?: 'QUICK' | 'HISTORICAL';
  fromDate?: Date | string;
  toDate?: Date | string;
  lowerBoundEpoch?: number;
  upperBoundEpoch?: number;
  candidateCushionSeconds?: number;
  safetyOverlapSeconds?: number;
} = {}): string {
  const bankClauses = BANK_NOTIFICATION_REGISTRY.map(
    entry => `(${entry.senderQuery} AND ${entry.signatureQuery})`
  );

  const forwardedClause =
    '(("Fwd:" OR "chuyển tiếp" OR "forwarded message") AND (vietcombank OR techcombank OR mbbank OR acb OR vpbank OR bidv) AND ("biến động" OR "số dư" OR "giao dịch"))';

  const combinedClauses = `(${bankClauses.join(' OR ')} OR ${forwardedClause})`;
  const parts = [combinedClauses];

  // Exact epoch boundaries take precedence (used by Quick Scan snapshot)
  if (options.lowerBoundEpoch !== undefined) {
    const overlap = options.safetyOverlapSeconds ?? 2;
    const queryAfter = Math.max(0, options.lowerBoundEpoch - overlap);
    parts.push(`after:${queryAfter}`);
  } else if (options.fromDate) {
    const cushion = options.candidateCushionSeconds ?? 0;
    let startSec: number;
    if (typeof options.fromDate === 'string') {
      startSec = vietnamMidnightToEpochSeconds(options.fromDate);
    } else {
      startSec = vietnamMidnightToEpochSeconds(formatLocalDate(options.fromDate));
    }
    const queryAfter = Math.max(0, startSec - cushion);
    parts.push(`after:${queryAfter}`);
  }

  if (options.upperBoundEpoch !== undefined) {
    const overlap = options.safetyOverlapSeconds ?? 2;
    const queryBefore = options.upperBoundEpoch + overlap;
    parts.push(`before:${queryBefore}`);
  } else if (options.toDate) {
    const cushion = options.candidateCushionSeconds ?? 0;
    let endSec: number;
    if (typeof options.toDate === 'string') {
      endSec = getNextDayVietnamMidnightToEpochSeconds(options.toDate);
    } else {
      endSec = getNextDayVietnamMidnightToEpochSeconds(formatLocalDate(options.toDate));
    }
    const queryBefore = endSec + cushion;
    parts.push(`before:${queryBefore}`);
  }

  return parts.join(' ');
}

/**
 * Ingest bank notifications from Gmail account
 */
export async function ingestFromGmail(
  refreshToken: string,
  options: FetchEmailOptions = {}
): Promise<IngestionResult> {
  const accessToken = await refreshAccessToken(refreshToken);

  const query = buildBankSearchQuery({
    ...options,
    candidateCushionSeconds:
      options.mode === 'QUICK' ? 0 : (options.candidateCushionSeconds ?? 86400),
    safetyOverlapSeconds:
      options.mode === 'QUICK' ? (options.safetyOverlapSeconds ?? 2) : 0,
  });
  const maxMessages = options.maxMessages || 1000;

  let pageToken: string | undefined = options.pageToken;
  let truncated = false;
  let remainingToken: string | undefined;
  const messageIds: string[] = [];

  // 1. Pagination loop with nextPageToken across multiple pages
  do {
    const remainingCapacity = maxMessages - messageIds.length;
    const batchLimit = Math.max(1, Math.min(remainingCapacity, 100));

    const listUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
    listUrl.searchParams.set('q', query);
    listUrl.searchParams.set('maxResults', String(batchLimit));
    if (pageToken) {
      listUrl.searchParams.set('pageToken', pageToken);
    }

    const listRes = await fetch(listUrl.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!listRes.ok) {
      if (listRes.status === 401) {
        throw new GmailTokenRevokedError(`Gmail API unauthorized: ${listRes.status}`);
      }
      if (listRes.status === 403) {
        throw new GmailConfigError(`Gmail API forbidden: ${listRes.status}`);
      }
      if (listRes.status >= 500) {
        throw new GmailTransientError(`Gmail API server error: ${listRes.status}`);
      }
      throw new Error(`Gmail API list failed: ${listRes.status}`);
    }

    const listData: GmailMessageListResponse = await listRes.json();
    if (listData.messages) {
      for (const m of listData.messages) {
        if (messageIds.length < maxMessages) {
          messageIds.push(m.id);
        }
      }
    }

    if (messageIds.length >= maxMessages) {
      if (listData.nextPageToken) {
        truncated = true;
        remainingToken = listData.nextPageToken;
      }
      break;
    }

    pageToken = listData.nextPageToken;
  } while (pageToken && messageIds.length < maxMessages);

  // 2. Fetch MIME details for candidates
  const events: ParsedBankEvent[] = [];
  let failedCount = 0;

  for (const msgId of messageIds) {
    try {
      const detailUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=full`;
      const detailRes = await fetch(detailUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!detailRes.ok) {
        failedCount++;
        continue;
      }

      const msgData: GmailMessageDetailResponse = await detailRes.json();
      const headers = msgData.payload.headers || [];

      const from = headers.find(h => h.name.toLowerCase() === 'from')?.value || '';
      const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value || '';
      const dateStr = headers.find(h => h.name.toLowerCase() === 'date')?.value || '';

      let bodyText = '';
      if (msgData.payload.body?.data) {
        bodyText = decodeBase64Url(msgData.payload.body.data);
      } else if (msgData.payload.parts) {
        for (const p of msgData.payload.parts) {
          bodyText = extractBodyText(p);
          if (bodyText) break;
        }
      }

      const rawEmail: RawEmailData = {
        id: msgData.id,
        from,
        subject,
        snippet: msgData.snippet || '',
        bodyText,
        date: dateStr,
        internalDate: msgData.internalDate,
      };

      // In QUICK mode, enforce authoritative half-open interval filter on Gmail internalDate:
      // [lowerBoundEpoch * 1000, upperBoundEpoch * 1000)
      if (options.mode === 'QUICK') {
        let msgInternalDateMs: number | undefined;
        if (msgData.internalDate) {
          const parsedMs = Number(msgData.internalDate);
          if (!isNaN(parsedMs) && parsedMs > 0) {
            msgInternalDateMs = parsedMs;
          }
        }
        if (msgInternalDateMs === undefined && dateStr) {
          const parsedHeader = new Date(dateStr).getTime();
          if (!isNaN(parsedHeader) && parsedHeader > 0) {
            msgInternalDateMs = parsedHeader;
          }
        }

        if (msgInternalDateMs !== undefined) {
          if (
            options.lowerBoundEpoch !== undefined &&
            msgInternalDateMs < options.lowerBoundEpoch * 1000
          ) {
            continue;
          }
          if (
            options.upperBoundEpoch !== undefined &&
            msgInternalDateMs >= options.upperBoundEpoch * 1000
          ) {
            continue;
          }
        }
      }

      const parsed = parseBankNotification(rawEmail);
      if (parsed) {
        events.push(parsed);
      } else {
        failedCount++;
      }
    } catch {
      failedCount++;
    }
  }

  return {
    events,
    totalFetched: messageIds.length,
    failedCount,
    truncated,
    nextPageToken: remainingToken,
  };
}

// ─── Demo Fixture Fallback (For offline classroom demo when explicitly enabled) ──

export function getDemoBankEmails(): RawEmailData[] {
  return [
    {
      id: 'demo_msg_vcb_001',
      from: 'vietcombank@vcb.com.vn',
      subject: 'VCB: TK ••••1234| GD: +25,000,000 VND | 05/09/2026 09:30 | Cong ty CP Cong nghe chuyen luong Thang 9',
      snippet: 'VCB: TK ••••1234| GD: +25,000,000 VND | 05/09/2026 09:30 | Cong ty CP Cong nghe chuyen luong Thang 9',
      bodyText: 'VCB: TK ••••1234| GD: +25,000,000 VND | 05/09/2026 09:30 | Mã GD: FT262490001 | Cong ty CP Cong nghe chuyen luong Thang 9',
      date: '2026-09-05T09:35:00.000Z',
    },
    {
      id: 'demo_msg_vcb_002',
      from: 'vietcombank@vcb.com.vn',
      subject: 'VCB: TK ••••1234| GD: -120,000 VND | 06/09/2026 14:15 | Thanh toan Cafe Highland Nguyen Du',
      snippet: 'VCB: TK ••••1234| GD: -120,000 VND | 06/09/2026 14:15 | Thanh toan Cafe Highland Nguyen Du',
      bodyText: 'VCB: TK ••••1234| GD: -120,000 VND | 06/09/2026 14:15 | Mã GD: FT262500002 | Thanh toan Cafe Highland Nguyen Du',
      date: '2026-09-06T14:20:00.000Z',
    },
    {
      id: 'demo_msg_vcb_003',
      from: 'vietcombank@vcb.com.vn',
      subject: 'VCB: TK ••••1234| GD: -350,000 VND | 08/09/2026 08:00 | Thanh toan Grab Car di lam',
      snippet: 'VCB: TK ••••1234| GD: -350,000 VND | 08/09/2026 08:00 | Thanh toan Grab Car di lam',
      bodyText: 'VCB: TK ••••1234| GD: -350,000 VND | 08/09/2026 08:00 | Mã GD: FT262520003 | Thanh toan Grab Car di lam',
      date: '2026-09-08T08:05:00.000Z',
    },
    {
      id: 'demo_msg_tcb_004',
      from: 'alert@techcombank.com.vn',
      subject: 'Thông báo biến động số dư tài khoản',
      snippet: 'So tien ghi no: 1,850,000 VND luc 10/09/2026 19:20. Dien giai: Mua sam Shopee don hang 98231',
      bodyText: 'So tien ghi no: 1,850,000 VND luc 10/09/2026 19:20 tai khoan 8821. Mã GD: TCB98231. Dien giai: Mua sam Shopee don hang 98231',
      date: '2026-09-10T19:25:00.000Z',
    },
    {
      id: 'demo_msg_unknown_005',
      from: 'newsletter@spam.org',
      subject: 'Bản tin tài chính tuần 36',
      snippet: 'Tin tức thị trường đầu tư tháng 9 năm 2026',
      bodyText: 'Tin tức thị trường đầu tư tháng 9 năm 2026, không chứa số tiền chuyển khoản',
      date: '2026-09-12T11:00:00.000Z',
    },
  ];
}
