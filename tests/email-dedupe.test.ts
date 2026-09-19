import { describe, it, expect } from 'vitest';
import { deduplicateTransactions } from '../src/lib/email/dedupe';
import { parseEmailMessage, normalizeToTransaction } from '../src/lib/email/normalizer';
import { VietcombankParser, GenericParser } from '../src/lib/email/parsers/generic-parser';
import type { Transaction, EmailMessage } from '../src/types';

describe('Email Ingestion — Deduplication & Parsers', () => {
  describe('Deduplication', () => {
    it('only creates 1 transaction when synced 10 times for the same email message', () => {
      let existing: Transaction[] = [];

      const incomingBatch: Transaction[] = [
        {
          id: 'tx-1',
          source: 'EMAIL',
          sourceMessageId: 'msg_vcb_123',
          direction: 'IN',
          amount: 25000000,
          currency: 'VND',
          occurredAt: '2026-09-01T09:00:00Z',
          description: 'Lương tháng 9',
          category: 'Lương',
          status: 'POSTED',
          createdAt: '',
          updatedAt: '',
        },
      ];

      // Sync 1: Adds transaction
      const sync1 = deduplicateTransactions(existing, incomingBatch);
      expect(sync1.length).toBe(1);
      existing = [...existing, ...sync1];

      // Sync 2 to 10: Should all be filtered out!
      for (let i = 2; i <= 10; i++) {
        const nextSync = deduplicateTransactions(existing, incomingBatch);
        expect(nextSync.length).toBe(0);
      }

      // Final existing array must contain exactly 1 transaction
      expect(existing.length).toBe(1);
    });

    it('allows manual transactions without sourceMessageId to pass', () => {
      const existing: Transaction[] = [
        {
          id: 'tx-manual-1',
          source: 'MANUAL',
          direction: 'OUT',
          amount: 50000,
          currency: 'VND',
          occurredAt: '2026-09-01T09:00:00Z',
          description: 'Cafe',
          category: 'Ăn uống',
          status: 'POSTED',
          createdAt: '',
          updatedAt: '',
        },
      ];

      const incomingManual: Transaction[] = [
        {
          id: 'tx-manual-2',
          source: 'MANUAL',
          direction: 'OUT',
          amount: 60000,
          currency: 'VND',
          occurredAt: '2026-09-01T10:00:00Z',
          description: 'Trà đá',
          category: 'Ăn uống',
          status: 'POSTED',
          createdAt: '',
          updatedAt: '',
        },
      ];

      const result = deduplicateTransactions(existing, incomingManual);
      expect(result.length).toBe(1);
    });
  });

  describe('Parser Safety & Review Flow', () => {
    it('sets POSTED status only for trusted sender with high confidence', () => {
      const msg: EmailMessage = {
        id: 'msg-trusted',
        from: 'vietcombank@vcb.com.vn',
        subject: 'VCB: TK 1234| GD: +20,000,000 VND | Chuyen luong',
        snippet: 'VCB: TK 1234| GD: +20,000,000 VND | Chuyen luong',
        receivedAt: '2026-09-05T08:00:00Z',
      };

      const parsed = parseEmailMessage(msg);
      expect(parsed).not.toBeNull();

      const tx = normalizeToTransaction(
        parsed!,
        msg,
        [],
        ['vietcombank@vcb.com.vn'], // Trusted sender
        0.8 // Min confidence
      );

      expect(tx.status).toBe('POSTED');
      expect(tx.amount).toBe(20000000);
      expect(tx.direction).toBe('IN');
      expect(tx.bank).toBe('Vietcombank');
    });

    it('sets NEEDS_REVIEW status for unrecognized sender even if parsed', () => {
      const msg: EmailMessage = {
        id: 'msg-untrusted',
        from: 'random@unknown-domain.org',
        subject: 'Thanh toan 150,000 VND',
        snippet: 'Ghi no: 150,000 VND luc 10:00',
        receivedAt: '2026-09-05T08:00:00Z',
      };

      const parsed = parseEmailMessage(msg);
      expect(parsed).not.toBeNull();

      const tx = normalizeToTransaction(
        parsed!,
        msg,
        [],
        ['vietcombank@vcb.com.vn'], // Untrusted sender!
        0.8
      );

      expect(tx.status).toBe('NEEDS_REVIEW');
    });
  });

  describe('Bank Parsers', () => {
    it('Vietcombank parser extracts debit transaction correctly', () => {
      const parser = new VietcombankParser();
      const msg: EmailMessage = {
        id: '1',
        from: 'vietcombank@vcb.com.vn',
        subject: 'VCB: TK 9876| GD: -120,000 VND | 06/09/2026 | Cafe Highland',
        snippet: 'VCB: TK 9876| GD: -120,000 VND | 06/09/2026 | Cafe Highland',
        receivedAt: '2026-09-06T14:00:00Z',
      };

      expect(parser.canParse(msg)).toBe(true);
      const res = parser.parse(msg);
      expect(res).not.toBeNull();
      expect(res?.direction).toBe('OUT');
      expect(res?.amount).toBe(120000);
      expect(res?.bank).toBe('Vietcombank');
      expect(res?.accountHint).toBe('9876');
    });

    it('Generic parser extracts credit transaction correctly', () => {
      const parser = new GenericParser();
      const msg: EmailMessage = {
        id: '2',
        from: 'alert@techcombank.com.vn',
        subject: 'Thông báo giao dịch',
        snippet: 'Số tiền ghi có: 5,000,000 VND ngày 07/09/2026',
        receivedAt: '2026-09-07T10:00:00Z',
      };

      expect(parser.canParse(msg)).toBe(true);
      const res = parser.parse(msg);
      expect(res).not.toBeNull();
      expect(res?.direction).toBe('IN');
      expect(res?.amount).toBe(5000000);
      expect(res?.confidence).toBe(0.5); // Generic parser has lower confidence
    });
  });
});
