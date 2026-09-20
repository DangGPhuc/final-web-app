/**
 * Internal Bank Email Parser Registry & Financial Event Extraction
 *
 * Requirements:
 * - Internal parser registry for known Vietnamese bank senders and notification patterns.
 * - Extracts objective financial facts: direction, amount, time, bank, account hint, counterparty.
 * - Detects normalized merchant context (e.g. Highlands Coffee, Grab, Shopee) as display hint only.
 * - If amount or direction cannot be determined reliably, returns null (do NOT create transaction).
 */

import crypto from 'crypto';
import { detectMerchantContext } from '@/lib/finance/calculations';

export interface RawEmailData {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  bodyText: string;
  date: string;
}

export interface ParsedBankEvent {
  gmailMessageId: string;
  gmailThreadId?: string;
  bankRefId?: string;
  fingerprint: string;
  bankCode: string;
  bankName: string;
  accountHint?: string;
  direction: 'IN' | 'OUT';
  amount: number;
  currency: string;
  occurredAt: Date;
  counterparty?: string;
  merchantLabel?: string;
  summary: string;
}

/**
 * Extract bank transaction or reference code from text
 */
export function extractBankRefId(text: string): string | undefined {
  const refMatch =
    text.match(/(?:mã\s*gd|số\s*gd|so\s*gd|ma\s*gd|ref(?:erence)?|ft\s*no\.?)[:\s#]*([a-zA-Z0-9.\-_]{5,30})/i) ||
    text.match(/\b(FT[0-9]{8,22})\b/i);
  return refMatch ? refMatch[1].trim() : undefined;
}

/**
 * Generate conservative normalized event fingerprint for cross-account forwarding deduplication
 */
export function generateFinancialFingerprint(params: {
  bankCode: string;
  accountHint?: string;
  direction: 'IN' | 'OUT';
  amount: number;
  occurredAt: Date;
  summary: string;
}): string {
  const timeKey = params.occurredAt.toISOString().slice(0, 16); // YYYY-MM-DDTHH:mm
  const normalizedSummary = params.summary
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')
    .slice(0, 40);
  const raw = `${params.bankCode}|${params.accountHint || ''}|${params.direction}|${params.amount}|${timeKey}|${normalizedSummary}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * Decode Gmail base64url encoded string
 */
export function decodeBase64Url(data: string): string {
  try {
    const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(base64, 'base64').toString('utf-8');
  } catch {
    return '';
  }
}

/**
 * Sanitize HTML to plain text
 */
export function sanitizeHtmlToText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse an email into a normalized Bank Financial Event
 */
export function parseBankNotification(email: RawEmailData): ParsedBankEvent | null {
  const combined = `${email.subject} ${email.snippet} ${email.bodyText}`;
  const lower = combined.toLowerCase();
  const fromLower = email.from.toLowerCase();

  // 1. Vietcombank Parser (VCB)
  if (
    fromLower.includes('vietcombank') ||
    fromLower.includes('vcb') ||
    lower.includes('vcb:') ||
    lower.includes('vietcombank')
  ) {
    // Patterns:
    // VCB: TK 1234| GD: +25,000,000 VND | 05/09/2026 | Cong ty CP Cong nghe chuyen luong Thang 9
    // VCB: TK 1234| GD: -120,000 VND | 06/09/2026 | Thanh toan Cafe Highland Nguyen Du
    // So tien: +/-X VND
    const vcbMatch =
      combined.match(/GD:\s*([+-])\s*([\d,.]+)\s*(?:VND|đ)/i) ||
      combined.match(/([+-])\s*([\d,.]+)\s*(?:VND|đ)/i) ||
      combined.match(/(?:số tiền|so tien)[:\s]*([+-]?\s*[\d,.]+)\s*(?:VND|đ)/i);

    if (vcbMatch) {
      let direction: 'IN' | 'OUT' = 'OUT';
      let amountStr = '';

      if (vcbMatch[1] === '+' || vcbMatch[1] === '-') {
        direction = vcbMatch[1] === '+' ? 'IN' : 'OUT';
        amountStr = vcbMatch[2];
      } else {
        const raw = vcbMatch[1] || vcbMatch[0];
        if (raw.includes('+') || lower.includes('ghi có') || lower.includes('nhận tiền')) direction = 'IN';
        amountStr = raw.replace(/[^\d]/g, '');
      }

      const cleanAmount = parseInt(amountStr.replace(/[^\d]/g, ''), 10);
      if (!isNaN(cleanAmount) && cleanAmount > 0) {
        const acctMatch = combined.match(/(?:TK|tài khoản)[:\s]*([0-9xX*•\s]+)/i);
        const accountHint = acctMatch ? acctMatch[1].trim().slice(-4) : undefined;

        // Counterparty / details from pipe or subject
        const parts = combined.split('|');
        const detailPart = parts.length >= 4 ? parts[3].trim() : email.subject;
        const merchantHint = detectMerchantContext(detailPart);

        let date = new Date(email.date);
        if (isNaN(date.getTime())) date = new Date();

        const bankRefId = extractBankRefId(combined);
        const fingerprint = generateFinancialFingerprint({
          bankCode: 'VCB',
          accountHint,
          direction,
          amount: cleanAmount,
          occurredAt: date,
          summary: detailPart,
        });

        return {
          gmailMessageId: email.id,
          bankRefId,
          fingerprint,
          bankCode: 'VCB',
          bankName: 'Vietcombank',
          accountHint: accountHint ? `••••${accountHint}` : undefined,
          direction,
          amount: cleanAmount,
          currency: 'VND',
          occurredAt: date,
          counterparty: detailPart.slice(0, 80),
          merchantLabel: merchantHint || undefined,
          summary: detailPart.slice(0, 150) || email.subject,
        };
      }
    }
  }

  // 2. Techcombank Parser (TCB)
  if (
    fromLower.includes('techcombank') ||
    fromLower.includes('tcb') ||
    lower.includes('techcombank')
  ) {
    // Pattern: So tien ghi no/ghi co: 1,850,000 VND luc ... Dien giai: ...
    const isCredit = lower.includes('ghi có') || lower.includes('ghi co') || lower.includes('nhận');
    const isDebit = lower.includes('ghi nợ') || lower.includes('ghi no') || lower.includes('thanh toán');

    const amountMatch = combined.match(/(?:số tiền|so tien|ghi nợ|ghi có|ghi no|ghi co)[:\s]*([\d,.]+)\s*(?:VND|đ)?/i);
    if (amountMatch) {
      const cleanAmount = parseInt(amountMatch[1].replace(/[^\d]/g, ''), 10);
      if (!isNaN(cleanAmount) && cleanAmount > 0) {
        const direction: 'IN' | 'OUT' = isCredit ? 'IN' : 'OUT';

        const acctMatch = combined.match(/(?:TK|tài khoản)[:\s]*([0-9xX*•\s]+)/i);
        const accountHint = acctMatch ? acctMatch[1].trim().slice(-4) : undefined;

        const descMatch = combined.match(/(?:diễn giải|dien giai|nội dung|noi dung)[:\s]*([^.]+)/i);
        const summary = descMatch ? descMatch[1].trim() : email.subject;
        const merchantHint = detectMerchantContext(summary);

        let date = new Date(email.date);
        if (isNaN(date.getTime())) date = new Date();

        const bankRefId = extractBankRefId(combined);
        const fingerprint = generateFinancialFingerprint({
          bankCode: 'TCB',
          accountHint,
          direction,
          amount: cleanAmount,
          occurredAt: date,
          summary,
        });

        return {
          gmailMessageId: email.id,
          bankRefId,
          fingerprint,
          bankCode: 'TCB',
          bankName: 'Techcombank',
          accountHint: accountHint ? `••••${accountHint}` : undefined,
          direction,
          amount: cleanAmount,
          currency: 'VND',
          occurredAt: date,
          counterparty: summary.slice(0, 80),
          merchantLabel: merchantHint || undefined,
          summary: summary.slice(0, 150),
        };
      }
    }
  }

  // 3. Generic Fallback Parser for other Vietnamese Banks (MB, ACB, VPBank, etc.)
  const amountMatch =
    combined.match(/([+-])\s*([\d,.]+)\s*(?:VND|đ|đồng)/i) ||
    combined.match(/(?:số tiền|so tien)[:\s]*([+-]?\s*[\d,.]+)\s*(?:VND|đ|đồng)/i) ||
    combined.match(/(?:ghi nợ|ghi no|ghi có|ghi co)[:\s]*([\d,.]+)\s*(?:VND|đ|đồng)?/i);

  if (amountMatch) {
    let direction: 'IN' | 'OUT' = 'OUT';
    let rawAmount = '';

    if (amountMatch[1] === '+' || amountMatch[1] === '-') {
      direction = amountMatch[1] === '+' ? 'IN' : 'OUT';
      rawAmount = amountMatch[2];
    } else {
      rawAmount = amountMatch[1];
      if (
        lower.includes('ghi có') ||
        lower.includes('ghi co') ||
        lower.includes('nhận tiền') ||
        lower.includes('cộng tiền')
      ) {
        direction = 'IN';
      }
    }

    const cleanAmount = parseInt(rawAmount.replace(/[^\d]/g, ''), 10);
    if (!isNaN(cleanAmount) && cleanAmount > 0) {
      // Determine bank name if mentioned
      let bankCode = 'GENERIC';
      let bankName = 'Ngân hàng';
      if (lower.includes('mb bank') || lower.includes('mbbank')) {
        bankCode = 'MB';
        bankName = 'MB Bank';
      } else if (lower.includes('acb')) {
        bankCode = 'ACB';
        bankName = 'ACB';
      } else if (lower.includes('vpbank')) {
        bankCode = 'VPB';
        bankName = 'VPBank';
      } else if (lower.includes('bidv')) {
        bankCode = 'BIDV';
        bankName = 'BIDV';
      }

      const acctMatch = combined.match(/(?:TK|tài khoản)[:\s]*([0-9xX*•\s]+)/i);
      const accountHint = acctMatch ? acctMatch[1].trim().slice(-4) : undefined;
      const merchantHint = detectMerchantContext(combined);

      let date = new Date(email.date);
      if (isNaN(date.getTime())) date = new Date();

      const bankRefId = extractBankRefId(combined);
      const summaryText = email.subject || email.snippet.slice(0, 100);
      const fingerprint = generateFinancialFingerprint({
        bankCode,
        accountHint,
        direction,
        amount: cleanAmount,
        occurredAt: date,
        summary: summaryText,
      });

      return {
        gmailMessageId: email.id,
        bankRefId,
        fingerprint,
        bankCode,
        bankName,
        accountHint: accountHint ? `••••${accountHint}` : undefined,
        direction,
        amount: cleanAmount,
        currency: 'VND',
        occurredAt: date,
        counterparty: merchantHint || email.from.split('@')[0],
        merchantLabel: merchantHint || undefined,
        summary: summaryText,
      };
    }
  }

  // Could not reliably determine amount or direction -> Skip, DO NOT guess
  return null;
}
