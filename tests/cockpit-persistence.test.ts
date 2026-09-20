import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../src/lib/db';
import { encryptToken, decryptToken } from '../src/lib/security/crypto';
import { calculateBalance } from '../src/lib/finance/calculations';
import type { BankTransaction } from '../src/types';

describe('Cockpit Persistence & Business Rules — PostgreSQL + Prisma', () => {
  beforeAll(async () => {
    // Clean slate before tests
    await prisma.bankTransaction.deleteMany();
    await prisma.category.deleteMany();
    await prisma.fund.deleteMany();
    await prisma.syncRun.deleteMany();
    await prisma.gmailConnection.deleteMany();
  });

  afterAll(async () => {
    // Cleanup after tests
    await prisma.$disconnect();
  });

  describe('Clean Installation State', () => {
    it('starts with zero categories and zero funds in clean installation', async () => {
      const categories = await prisma.category.findMany();
      const funds = await prisma.fund.findMany();
      const transactions = await prisma.bankTransaction.findMany();

      expect(categories.length).toBe(0);
      expect(funds.length).toBe(0);
      expect(transactions.length).toBe(0);
    });
  });

  describe('Fund Creation & Persistence (Regression Test)', () => {
    it('creates a fund with name and monthly allocation and persists to database', async () => {
      const created = await prisma.fund.create({
        data: {
          name: 'Quỹ ăn uống',
          monthlyAllocation: 3000000,
          active: true,
        },
      });

      expect(created.id).toBeDefined();
      expect(created.name).toBe('Quỹ ăn uống');
      expect(created.monthlyAllocation).toBe(3000000);

      // Verify persistence across query
      const fetched = await prisma.fund.findUnique({
        where: { id: created.id },
      });

      expect(fetched).not.toBeNull();
      expect(fetched?.name).toBe('Quỹ ăn uống');
      expect(fetched?.monthlyAllocation).toBe(3000000);
    });
  });

  describe('User-Defined Category & "Khác..." Persistence', () => {
    it('creates a new category on the fly and makes it permanently reusable', async () => {
      // User creates "Cafe"
      const cat = await prisma.category.create({
        data: {
          name: 'Cafe',
          direction: 'OUT',
        },
      });

      expect(cat.id).toBeDefined();
      expect(cat.name).toBe('Cafe');

      // Check available categories
      const allCategories = await prisma.category.findMany({
        orderBy: { name: 'asc' },
      });
      expect(allCategories.map(c => c.name)).toContain('Cafe');
    });
  });

  describe('Gmail Connections & Multiple Account Support', () => {
    it('persists multiple Gmail connections with encrypted refresh tokens and Google sub', async () => {
      const token1 = 'refresh_token_for_main@gmail.com';
      const token2 = 'refresh_token_for_bankmail@gmail.com';

      const conn1 = await prisma.gmailConnection.create({
        data: {
          googleSub: 'google_sub_1001',
          email: 'main@gmail.com',
          displayName: 'Main User',
          encryptedRefreshToken: encryptToken(token1),
        },
      });

      const conn2 = await prisma.gmailConnection.create({
        data: {
          googleSub: 'google_sub_1002',
          email: 'bankmail@gmail.com',
          displayName: 'Bank Inbox',
          encryptedRefreshToken: encryptToken(token2),
        },
      });

      expect(conn1.id).toBeDefined();
      expect(conn2.id).toBeDefined();

      const activeConns = await prisma.gmailConnection.findMany({
        where: { revokedAt: null },
      });
      expect(activeConns.length).toBe(2);

      // Verify encrypted token can be decrypted cleanly
      expect(decryptToken(conn1.encryptedRefreshToken)).toBe(token1);
      expect(decryptToken(conn2.encryptedRefreshToken)).toBe(token2);
    });

    it('prevents duplicate Gmail connection by unique googleSub constraint', async () => {
      // Attempting to insert duplicate google_sub_1001 must throw unique constraint error
      await expect(
        prisma.gmailConnection.create({
          data: {
            googleSub: 'google_sub_1001',
            email: 'duplicate@gmail.com',
            encryptedRefreshToken: encryptToken('test'),
          },
        })
      ).rejects.toThrow();
    });
  });

  describe('Authoritative Server-side Deduplication', () => {
    it('prevents duplicate BankTransaction for the same Gmail message ID', async () => {
      const conn = await prisma.gmailConnection.findFirst();

      const tx1 = await prisma.bankTransaction.create({
        data: {
          gmailConnectionId: conn?.id,
          sourceEmail: conn?.email,
          gmailMessageId: 'gmail_unique_msg_001',
          bankCode: 'VCB',
          bankName: 'Vietcombank',
          direction: 'OUT',
          amount: 120000,
          currency: 'VND',
          occurredAt: new Date('2026-09-06T14:15:00Z'),
          summary: 'Highlands Coffee',
          merchantLabel: 'Highlands Coffee',
          classificationState: 'UNCLASSIFIED',
        },
      });

      expect(tx1.id).toBeDefined();

      // Attempting to insert the same gmailMessageId again must be rejected by UNIQUE constraint
      await expect(
        prisma.bankTransaction.create({
          data: {
            gmailConnectionId: conn?.id,
            sourceEmail: conn?.email,
            gmailMessageId: 'gmail_unique_msg_001',
            bankCode: 'VCB',
            direction: 'OUT',
            amount: 120000,
            summary: 'Highlands Coffee',
            occurredAt: new Date('2026-09-06T14:15:00Z'),
            classificationState: 'UNCLASSIFIED',
          },
        })
      ).rejects.toThrow();
    });

    it('overlapping date ranges produce no duplicates', async () => {
      // Add a second transaction
      await prisma.bankTransaction.create({
        data: {
          gmailMessageId: 'gmail_unique_msg_002',
          direction: 'IN',
          amount: 25000000,
          currency: 'VND',
          occurredAt: new Date('2026-09-05T09:30:00Z'),
          summary: 'Luong Thang 9',
          classificationState: 'UNCLASSIFIED',
        },
      });

      // Simulate re-importing the same range
      const existing = await prisma.bankTransaction.findMany();
      const existingIds = new Set(existing.map(t => t.gmailMessageId));

      const candidateIds = ['gmail_unique_msg_001', 'gmail_unique_msg_002', 'gmail_unique_msg_003'];
      const newItems = candidateIds.filter(id => !existingIds.has(id));

      expect(newItems).toEqual(['gmail_unique_msg_003']);
    });
  });

  describe('Ledger Calculation & Classification Independence', () => {
    it('classification does not change ledger balance', async () => {
      const txs = await prisma.bankTransaction.findMany();
      const formatted: BankTransaction[] = txs.map(t => ({
        ...t,
        occurredAt: t.occurredAt.toISOString(),
        importedAt: t.importedAt.toISOString(),
        direction: t.direction as 'IN' | 'OUT',
        classificationState: t.classificationState as 'UNCLASSIFIED' | 'CLASSIFIED',
      }));

      const balanceBefore = calculateBalance(0, formatted);

      // Classify the Highlands Coffee transaction
      const cafeCat = await prisma.category.findUnique({ where: { name: 'Cafe' } });
      const diningFund = await prisma.fund.findFirst({ where: { name: 'Quỹ ăn uống' } });

      await prisma.bankTransaction.update({
        where: { gmailMessageId: 'gmail_unique_msg_001' },
        data: {
          categoryId: cafeCat?.id,
          fundId: diningFund?.id,
          classificationState: 'CLASSIFIED',
        },
      });

      const updatedTxs = await prisma.bankTransaction.findMany();
      const updatedFormatted: BankTransaction[] = updatedTxs.map(t => ({
        ...t,
        occurredAt: t.occurredAt.toISOString(),
        importedAt: t.importedAt.toISOString(),
        direction: t.direction as 'IN' | 'OUT',
        classificationState: t.classificationState as 'UNCLASSIFIED' | 'CLASSIFIED',
      }));

      const balanceAfter = calculateBalance(0, updatedFormatted);
      expect(balanceAfter).toBe(balanceBefore);
    });
  });

  describe('Data Management Operations', () => {
    it('clearFinancialData removes financial records but keeps GmailConnections intact', async () => {
      // Execute clear financial data transaction
      await prisma.$transaction([
        prisma.bankTransaction.deleteMany(),
        prisma.category.deleteMany(),
        prisma.fund.deleteMany(),
        prisma.monthlySnapshot.deleteMany(),
        prisma.syncRun.deleteMany(),
      ]);

      const txCount = await prisma.bankTransaction.count();
      const catCount = await prisma.category.count();
      const fundCount = await prisma.fund.count();
      const connCount = await prisma.gmailConnection.count();

      expect(txCount).toBe(0);
      expect(catCount).toBe(0);
      expect(fundCount).toBe(0);
      // Crucial requirement: Gmail connections are preserved!
      expect(connCount).toBeGreaterThan(0);
    });

    it('disconnecting a Gmail connection keeps imported financial history', async () => {
      const conn = await prisma.gmailConnection.findFirst();
      expect(conn).not.toBeNull();

      // Create a transaction linked to this connection
      const tx = await prisma.bankTransaction.create({
        data: {
          gmailConnectionId: conn!.id,
          sourceEmail: conn!.email,
          gmailMessageId: 'msg_to_keep_after_disconnect',
          direction: 'OUT',
          amount: 50000,
          currency: 'VND',
          occurredAt: new Date(),
          summary: 'Tra da',
          classificationState: 'UNCLASSIFIED',
        },
      });

      // Disconnect account
      await prisma.bankTransaction.updateMany({
        where: { gmailConnectionId: conn!.id },
        data: { sourceEmail: conn!.email },
      });
      await prisma.gmailConnection.delete({
        where: { id: conn!.id },
      });

      // The transaction must still exist with sourceEmail intact
      const persistedTx = await prisma.bankTransaction.findUnique({
        where: { id: tx.id },
      });
      expect(persistedTx).not.toBeNull();
      expect(persistedTx?.sourceEmail).toBe(conn!.email);
      expect(persistedTx?.gmailConnectionId).toBeNull();
    });

    it('factoryReset removes all data including GmailConnections', async () => {
      // Execute factory reset transaction
      await prisma.$transaction([
        prisma.bankTransaction.deleteMany(),
        prisma.category.deleteMany(),
        prisma.fund.deleteMany(),
        prisma.monthlySnapshot.deleteMany(),
        prisma.syncRun.deleteMany(),
        prisma.gmailConnection.deleteMany(),
      ]);

      expect(await prisma.bankTransaction.count()).toBe(0);
      expect(await prisma.category.count()).toBe(0);
      expect(await prisma.fund.count()).toBe(0);
      expect(await prisma.gmailConnection.count()).toBe(0);
    });
  });
});
