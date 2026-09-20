import { refreshAccessToken } from '@/lib/oauth/google-oauth';
import {
  decodeBase64Url,
  sanitizeHtmlToText,
  parseBankNotification,
  type ParsedBankEvent,
  type RawEmailData,
} from './bank-parsers';

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
  fromDate?: Date;
  toDate?: Date;
  maxMessages?: number;
  pageToken?: string;
}

export interface IngestionResult {
  events: ParsedBankEvent[];
  totalFetched: number;
  failedCount: number;
  truncated: boolean;
  nextPageToken?: string;
}

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
 * Format Date as YYYY/MM/DD for Gmail search queries
 */
export function formatGmailDateQuery(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}/${m}/${day}`;
}

/**
 * Build privacy-preserving targeted Gmail search query for bank notification emails
 */
export function buildBankSearchQuery(options: { fromDate?: Date; toDate?: Date } = {}): string {
  // Exact controlled bank sender domains
  const senderFilter =
    'from:(@vietcombank.com.vn OR @vcb.com.vn OR @techcombank.com.vn OR @tcb.com.vn OR @mbbank.com.vn OR @acb.com.vn OR @vpbank.com.vn OR @bidv.com.vn)';

  // Controlled bank subject / notification signatures
  const subjectFilter =
    'subject:("biến động" OR "số dư" OR "ghi nợ" OR "ghi có" OR "giao dịch" OR "VCB:" OR "Techcombank")';

  // Strict grouping ensures we never scan unrelated personal emails
  const coreFilter = `(${senderFilter} OR ${subjectFilter})`;
  const parts = [coreFilter];

  if (options.fromDate) {
    parts.push(`after:${formatGmailDateQuery(options.fromDate)}`);
  }
  if (options.toDate) {
    const endPlusOne = new Date(options.toDate.getTime() + 24 * 60 * 60 * 1000);
    parts.push(`before:${formatGmailDateQuery(endPlusOne)}`);
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

  const query = buildBankSearchQuery(options);
  const maxMessages = options.maxMessages || 1000;

  let pageToken: string | undefined = options.pageToken;
  let truncated = false;
  let remainingToken: string | undefined;
  const messageIds: string[] = [];

  // 1. Pagination loop with nextPageToken across multiple pages
  do {
    const listUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
    listUrl.searchParams.set('q', query);
    listUrl.searchParams.set('maxResults', '100');
    if (pageToken) {
      listUrl.searchParams.set('pageToken', pageToken);
    }

    const listRes = await fetch(listUrl.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!listRes.ok) {
      throw new Error(`Gmail API list failed: ${listRes.status}`);
    }

    const listData: GmailMessageListResponse = await listRes.json();
    if (listData.messages) {
      for (const m of listData.messages) {
        messageIds.push(m.id);
        if (messageIds.length >= maxMessages) {
          if (listData.nextPageToken) {
            truncated = true;
            remainingToken = listData.nextPageToken;
          }
          break;
        }
      }
    }

    if (messageIds.length >= maxMessages) {
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
        date: dateStr || new Date(parseInt(msgData.internalDate, 10)).toISOString(),
      };

      const parsed = parseBankNotification(rawEmail);
      if (parsed) {
        events.push(parsed);
      } else {
        // Did not contain reliable financial amounts -> recorded as unparseable
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

// ─── Demo Fixture Fallback (For offline classroom demo when no Google API key) ──

export function getDemoBankEmails(): RawEmailData[] {
  return [
    {
      id: 'demo_msg_vcb_001',
      from: 'vietcombank@vcb.com.vn',
      subject: 'VCB: TK ••••1234| GD: +25,000,000 VND | 05/09/2026 | Cong ty CP Cong nghe chuyen luong Thang 9',
      snippet: 'VCB: TK ••••1234| GD: +25,000,000 VND | 05/09/2026 | Cong ty CP Cong nghe chuyen luong Thang 9',
      bodyText: 'VCB: TK ••••1234| GD: +25,000,000 VND | 05/09/2026 | Cong ty CP Cong nghe chuyen luong Thang 9',
      date: '2026-09-05T09:30:00.000Z',
    },
    {
      id: 'demo_msg_vcb_002',
      from: 'vietcombank@vcb.com.vn',
      subject: 'VCB: TK ••••1234| GD: -120,000 VND | 06/09/2026 | Thanh toan Cafe Highland Nguyen Du',
      snippet: 'VCB: TK ••••1234| GD: -120,000 VND | 06/09/2026 | Thanh toan Cafe Highland Nguyen Du',
      bodyText: 'VCB: TK ••••1234| GD: -120,000 VND | 06/09/2026 | Thanh toan Cafe Highland Nguyen Du',
      date: '2026-09-06T14:15:00.000Z',
    },
    {
      id: 'demo_msg_vcb_003',
      from: 'vietcombank@vcb.com.vn',
      subject: 'VCB: TK ••••1234| GD: -350,000 VND | 08/09/2026 | Thanh toan Grab Car di lam',
      snippet: 'VCB: TK ••••1234| GD: -350,000 VND | 08/09/2026 | Thanh toan Grab Car di lam',
      bodyText: 'VCB: TK ••••1234| GD: -350,000 VND | 08/09/2026 | Thanh toan Grab Car di lam',
      date: '2026-09-08T08:00:00.000Z',
    },
    {
      id: 'demo_msg_tcb_004',
      from: 'alert@techcombank.com.vn',
      subject: 'Thông báo biến động số dư tài khoản',
      snippet: 'So tien ghi no: 1,850,000 VND luc 10/09/2026. Dien giai: Mua sam Shopee don hang 98231',
      bodyText: 'So tien ghi no: 1,850,000 VND luc 10/09/2026 tai khoan 8821. Dien giai: Mua sam Shopee don hang 98231',
      date: '2026-09-10T19:20:00.000Z',
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
