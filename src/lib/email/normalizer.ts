/**
 * Email Normalizer — converts parsed email data into Transaction objects
 * Handles deduplication and confidence-based status assignment.
 */

import type { Transaction } from '@/types';
import type { EmailMessage } from './provider';
import type { EmailParser, ParsedTransaction } from './parsers/parser';
import { GenericParser, VietcombankParser } from './parsers/generic-parser';
import { classifyTransaction, generateId } from '@/lib/finance/calculations';
import type { MerchantRule } from '@/types';

// Registry of available parsers
const PARSERS: EmailParser[] = [
  new VietcombankParser(),
  new GenericParser(), // Fallback — always last
];

export function getAvailableParsers(): EmailParser[] {
  return PARSERS;
}

/**
 * Parse an email message using the first matching parser
 */
export function parseEmailMessage(message: EmailMessage): ParsedTransaction | null {
  for (const parser of PARSERS) {
    if (parser.canParse(message)) {
      const result = parser.parse(message);
      if (result) return result;
    }
  }
  return null;
}

/**
 * Normalize a parsed email into a Transaction
 */
export function normalizeToTransaction(
  parsed: ParsedTransaction,
  message: EmailMessage,
  merchantRules: MerchantRule[],
  trustedSenders: string[],
  autoPostMinConfidence: number
): Transaction {
  const now = new Date().toISOString();

  // Classify
  const classification = classifyTransaction(
    parsed.description,
    parsed.counterparty,
    merchantRules
  );

  // Determine status
  const isTrustedSender = trustedSenders.some(s =>
    message.from.toLowerCase().includes(s.toLowerCase())
  );
  const isHighConfidence = parsed.confidence >= autoPostMinConfidence;

  const status: Transaction['status'] =
    isTrustedSender && isHighConfidence ? 'POSTED' : 'NEEDS_REVIEW';

  return {
    id: generateId(),
    source: 'EMAIL',
    sourceMessageId: message.id,
    sourceProvider: 'gmail',
    bank: parsed.bank,
    accountHint: parsed.accountHint,
    direction: parsed.direction,
    amount: parsed.amount,
    currency: parsed.currency,
    occurredAt: parsed.occurredAt,
    counterparty: parsed.counterparty,
    description: parsed.description,
    category: classification.category,
    fundId: classification.fundId,
    status,
    parserConfidence: parsed.confidence,
    rawSubject: message.subject,
    createdAt: now,
    updatedAt: now,
  };
}
