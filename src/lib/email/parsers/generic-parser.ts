/**
 * Generic Email Parser — fallback parser
 *
 * Attempts to extract transaction data from common Vietnamese bank email formats.
 * This is a DEMO parser. Real bank emails vary widely.
 * Confidence is lower than bank-specific parsers.
 *
 * Currently supported patterns (demo):
 * - "Số tiền ghi nợ / ghi có: X VND"
 * - "+/- X VND" patterns
 * - Common Vietnamese bank notification formats
 */

import type { EmailMessage } from '../provider';
import type { EmailParser, ParsedTransaction } from './parser';

export class GenericParser implements EmailParser {
  readonly name = 'Generic Vietnamese Bank Parser';
  readonly bankCode = 'GENERIC';

  canParse(message: EmailMessage): boolean {
    const text = `${message.subject} ${message.snippet}`.toLowerCase();
    return (
      text.includes('vnd') ||
      text.includes('giao dịch') ||
      text.includes('ghi nợ') ||
      text.includes('ghi có') ||
      text.includes('biến động') ||
      text.includes('số dư') ||
      text.includes('chuyển tiền') ||
      text.includes('thanh toán')
    );
  }

  parse(message: EmailMessage): ParsedTransaction | null {
    const text = `${message.subject} ${message.snippet}`;

    // Try to extract amount
    const amountMatch =
      text.match(/([+-])\s*([\d,.]+)\s*(?:VND|đ|đồng)/i) ||
      text.match(/(?:số tiền|so tien|amount)[:\s]*([\d,.]+)\s*(?:VND|đ|đồng)/i) ||
      text.match(/(?:ghi nợ|ghi no|ghi có|ghi co|debit|credit|thanh toán|thanh toan)[:\s]*([\d,.]+)\s*(?:VND|đ|đồng)?/i) ||
      text.match(/([\d,.]+)\s*(?:VND|đ|đồng)/i);

    if (!amountMatch) return null;

    // Determine direction
    let direction: 'IN' | 'OUT' = 'OUT';
    const textLower = text.toLowerCase();

    if (amountMatch[1] === '+') {
      direction = 'IN';
    } else if (amountMatch[1] === '-') {
      direction = 'OUT';
    } else if (
      textLower.includes('ghi có') ||
      textLower.includes('ghi co') ||
      textLower.includes('credit') ||
      textLower.includes('nhận') ||
      textLower.includes('nhan') ||
      textLower.includes('cộng') ||
      textLower.includes('cong')
    ) {
      direction = 'IN';
    } else if (
      textLower.includes('ghi nợ') ||
      textLower.includes('ghi no') ||
      textLower.includes('debit') ||
      textLower.includes('trừ') ||
      textLower.includes('tru') ||
      textLower.includes('thanh toán') ||
      textLower.includes('thanh toan')
    ) {
      direction = 'OUT';
    }

    // Parse amount string
    const rawVal = amountMatch[2] || amountMatch[1] || '0';
    const amountStr = rawVal.replace(/[,.]/g, m => (m === ',' ? '' : ''));
    const amount = parseInt(amountStr, 10);

    if (isNaN(amount) || amount <= 0) return null;

    // Try to extract account hint
    const accountMatch = text.match(/(?:TK|tài khoản|account)[:\s]*(\S+)/i);
    const accountHint = accountMatch ? accountMatch[1].slice(-4) : undefined;

    // Try to identify bank from sender
    const senderLower = message.from.toLowerCase();
    let bank = 'Unknown';
    if (senderLower.includes('vietcombank') || senderLower.includes('vcb')) bank = 'Vietcombank';
    else if (senderLower.includes('techcombank') || senderLower.includes('tcb')) bank = 'Techcombank';
    else if (senderLower.includes('mbbank') || senderLower.includes('mb')) bank = 'MB Bank';
    else if (senderLower.includes('acb')) bank = 'ACB';
    else if (senderLower.includes('vpbank') || senderLower.includes('vpb')) bank = 'VPBank';
    else if (senderLower.includes('bidv')) bank = 'BIDV';
    else if (senderLower.includes('tpbank') || senderLower.includes('tpb')) bank = 'TPBank';
    else if (senderLower.includes('vib')) bank = 'VIB';

    return {
      direction,
      amount,
      currency: 'VND',
      occurredAt: message.receivedAt || new Date().toISOString(),
      bank,
      counterparty: undefined,
      description: message.subject || message.snippet.slice(0, 100),
      accountHint,
      confidence: 0.5, // Generic parser = low confidence
    };
  }
}

/**
 * Demo Vietcombank Parser
 * Pattern: "VCB: TK xxxx| GD: +/-X VND | ..."
 */
export class VietcombankParser implements EmailParser {
  readonly name = 'Vietcombank Parser (Demo)';
  readonly bankCode = 'VCB';

  canParse(message: EmailMessage): boolean {
    const from = message.from.toLowerCase();
    const text = `${message.subject} ${message.snippet}`.toLowerCase();
    return (
      from.includes('vietcombank') ||
      from.includes('vcb') ||
      text.startsWith('vcb:')
    );
  }

  parse(message: EmailMessage): ParsedTransaction | null {
    const text = `${message.subject} ${message.snippet}`;

    const amountMatch = text.match(/([+-])([\d,]+)\s*VND/i);
    if (!amountMatch) return null;

    const direction = amountMatch[1] === '+' ? 'IN' : 'OUT';
    const amount = parseInt(amountMatch[2].replace(/,/g, ''), 10);
    if (isNaN(amount) || amount <= 0) return null;

    const accountMatch = text.match(/TK\s*(\w+)/i);

    return {
      direction,
      amount,
      currency: 'VND',
      occurredAt: message.receivedAt || new Date().toISOString(),
      bank: 'Vietcombank',
      description: message.subject || message.snippet.slice(0, 100),
      accountHint: accountMatch ? accountMatch[1].slice(-4) : undefined,
      confidence: 0.85,
    };
  }
}
