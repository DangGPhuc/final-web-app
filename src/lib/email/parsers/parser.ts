/**
 * Email Parser Interface
 * Each bank email format requires a specific parser.
 */

import type { EmailMessage } from '../provider';

export interface ParsedTransaction {
  direction: 'IN' | 'OUT';
  amount: number;
  currency: string;
  occurredAt: string;
  bank: string;
  counterparty?: string;
  description: string;
  accountHint?: string;
  confidence: number; // 0.0 - 1.0
}

export interface EmailParser {
  readonly name: string;
  readonly bankCode: string;

  /**
   * Check if this parser can handle the given email message
   */
  canParse(message: EmailMessage): boolean;

  /**
   * Parse the email and extract transaction data
   */
  parse(message: EmailMessage): ParsedTransaction | null;
}
