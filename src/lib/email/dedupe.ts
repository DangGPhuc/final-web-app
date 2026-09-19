/**
 * Deduplication module for email-sourced transactions
 * Ensures repeated Gmail syncs don't create duplicate transactions.
 */

import type { Transaction } from '@/types';

/**
 * Filter out transactions that already exist based on sourceMessageId.
 * If sync runs 10 times for the same email, only 1 Transaction exists.
 */
export function deduplicateTransactions(
  existing: Transaction[],
  incoming: Transaction[]
): Transaction[] {
  const existingMessageIds = new Set<string>();

  for (const tx of existing) {
    if (tx.source === 'EMAIL' && tx.sourceMessageId) {
      existingMessageIds.add(tx.sourceMessageId);
    }
  }

  return incoming.filter(tx => {
    if (!tx.sourceMessageId) return true; // manual transactions always pass
    if (existingMessageIds.has(tx.sourceMessageId)) return false;
    // Add to set to also dedupe within the incoming batch
    existingMessageIds.add(tx.sourceMessageId);
    return true;
  });
}

/**
 * Create a deterministic hash for an email transaction
 * Used as fallback when sourceMessageId is not available
 */
export function createTransactionHash(
  bank: string,
  amount: number,
  direction: string,
  occurredAt: string
): string {
  const key = `${bank}|${amount}|${direction}|${occurredAt}`;
  // Simple hash
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    const char = key.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return `hash_${Math.abs(hash).toString(36)}`;
}
