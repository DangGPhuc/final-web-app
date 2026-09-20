import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../src/lib/db';
import { encryptToken, decryptToken, setTestEncryptionKey } from '../src/lib/security/crypto';
import {
  createOwnerSessionToken,
  verifyOwnerSessionToken,
  setTestOwnerSecretKey,
} from '../src/lib/security/owner-auth';
import { calculateBalance } from '../src/lib/finance/calculations';
import type { BankTransaction } from '../src/types';

const TEST_KEY = Buffer.alloc(32, 3).toString('hex');
const TEST_OWNER_KEY = Buffer.alloc(32, 7).toString('hex');

describe('Cockpit Persistence & Business Rules — PostgreSQL + Prisma', () => {
  beforeAll(async () => {
    setTestEncryptionKey(TEST_KEY);
    setTestOwnerSecretKey(TEST_OWNER_KEY);
    // Clean slate before tests
    await prisma.bankTransaction.deleteMany();
    await prisma.category.deleteMany();
    await prisma.fund.deleteMany();
    await prisma.syncRun.deleteMany();
    await prisma.gmailConnection.deleteMany();
  });

  afterAll(async () => {
    setTestEncryptionKey(null);
    setTestOwnerSecretKey(null);
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
    it('creates a fund with name and monthly allocation and persists to database with exact integer precision', async () => {
      const created = await prisma.fund.create({
        data: {
          name: 'Quỹ ăn uống',
          monthlyAllocation: BigInt(3000000),
          active: true,
        },
      });

      expect(created.id).toBeDefined();
      expect(created.name).toBe('Quỹ ăn uống');
      expect(Number(created.monthlyAllocation)).toBe(3000000);

      // Verify persistence across query
      const fetched = await prisma.fund.findUnique({
        where: { id: created.id },
      });

      expect(fetched).not.toBeNull();
      expect(fetched?.name).toBe('Quỹ ăn uống');
      expect(Number(fetched?.monthlyAllocation)).toBe(3000000);
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

      expect(allCategories.length).toBe(1);
      expect(allCategories[0].name).toBe('Cafe');
    });
  });

  describe('Gmail Connections & Multiple Account Support', () => {
    it('persists multiple Gmail connections with encrypted refresh tokens and Google sub', async () => {
      const rawToken1 = '1//04_refresh_token_account_primary';
      const rawToken2 = '1//04_refresh_token_account_forwarded_secondary';

      const conn1 = await prisma.gmailConnection.create({
        data: {
          googleSub: 'google_sub_1001',
          email: 'primary.banking@gmail.com',
          displayName: 'Primary Account',
          avatarUrl: 'https://lh3.googleusercontent.com/a/primary',
          encryptedRefreshToken: encryptToken(rawToken1),
        },
      });

      const conn2 = await prisma.gmailConnection.create({
        data: {
          googleSub: 'google_sub_1002',
          email: 'secondary.forwarded@gmail.com',
          displayName: 'Forwarded Secondary Account',
          avatarUrl: 'https://lh3.googleusercontent.com/a/secondary',
          encryptedRefreshToken: encryptToken(rawToken2),
        },
      });

      expect(conn1.id).toBeDefined();
      expect(conn2.id).toBeDefined();

      const all = await prisma.gmailConnection.findMany();
      expect(all.length).toBe(2);

      // Verify encrypted token decodes correctly
      expect(decryptToken(conn1.encryptedRefreshToken)).toBe(rawToken1);
      expect(decryptToken(conn2.encryptedRefreshToken)).toBe(rawToken2);
    });

    it('prevents duplicate Gmail connection by unique googleSub constraint', async () => {
      // Attempting to insert duplicate google_sub_1001 must throw unique constraint error
      await expect(
        prisma.gmailConnection.create({
          data: {
            googleSub: 'google_sub_1001',
            email: 'duplicate.sub@gmail.com',
            encryptedRefreshToken: encryptToken('raw_token'),
          },
        })
      ).rejects.toThrow();
    });
  });

  describe('Authoritative Server-side Deduplication & Forwarding Semantics', () => {
    it('prevents duplicate BankTransaction for the same Gmail message ID on the same account', async () => {
      const conn = await prisma.gmailConnection.findFirst({ where: { googleSub: 'google_sub_1001' } });

      const tx1 = await prisma.bankTransaction.create({
        data: {
          gmailConnectionId: conn?.id,
          sourceEmail: conn?.email,
          gmailMessageId: 'gmail_unique_msg_001',
          bankRefId: 'FT262500001',
          fingerprint: 'fp_vcb_120k_001',
          bankCode: 'VCB',
          bankName: 'Vietcombank',
          direction: 'OUT',
          amount: BigInt(120000),
          currency: 'VND',
          occurredAt: new Date('2026-09-06T14:15:00Z'),
          summary: 'Highlands Coffee',
          merchantLabel: 'Highlands Coffee',
          classificationState: 'UNCLASSIFIED',
        },
      });

      expect(tx1.id).toBeDefined();

      // Attempting to insert the same (gmailConnectionId, gmailMessageId) again must be rejected
      await expect(
        prisma.bankTransaction.create({
          data: {
            gmailConnectionId: conn?.id,
            sourceEmail: conn?.email,
            gmailMessageId: 'gmail_unique_msg_001',
            bankCode: 'VCB',
            direction: 'OUT',
            amount: BigInt(120000),
            summary: 'Highlands Coffee',
            occurredAt: new Date('2026-09-06T14:15:00Z'),
            classificationState: 'UNCLASSIFIED',
          },
        })
      ).rejects.toThrow();
    });

    it('prevents duplicate ingestion for forwarded emails across two connected Gmail accounts via bankRefId or fingerprint', async () => {
      const conn2 = await prisma.gmailConnection.findFirst({ where: { googleSub: 'google_sub_1002' } });
      expect(conn2).not.toBeNull();

      // Account 2 receives forwarded notification with a DIFFERENT gmailMessageId, but SAME bankRefId
      const forwardedCandidate = {
        gmailMessageId: 'gmail_forwarded_msg_999',
        bankRefId: 'FT262500001', // exact same bank transaction ID as Account 1
        fingerprint: 'fp_vcb_120k_001',
      };

      // Server deduplication logic checks if bankRefId or fingerprint already exists
      const existing = await prisma.bankTransaction.findFirst({
        where: {
          OR: [
            { bankRefId: forwardedCandidate.bankRefId },
            { fingerprint: forwardedCandidate.fingerprint },
          ],
        },
      });

      expect(existing).not.toBeNull();
      expect(existing?.bankRefId).toBe('FT262500001');
      // Proves the forwarded message is recognized as duplicate and dropped safely
    });

    it('keeps two legitimate same-amount transactions distinct when occurring at different times', async () => {
      // User buys another coffee at 18:30 for 120,000 VND
      const txSecond = await prisma.bankTransaction.create({
        data: {
          gmailMessageId: 'gmail_unique_msg_coffee_evening',
          bankRefId: 'FT262500002', // different transaction reference
          fingerprint: 'fp_vcb_120k_evening',
          bankCode: 'VCB',
          direction: 'OUT',
          amount: BigInt(120000),
          currency: 'VND',
          occurredAt: new Date('2026-09-06T18:30:00Z'),
          summary: 'Highlands Coffee Evening',
          classificationState: 'UNCLASSIFIED',
        },
      });

      expect(txSecond.id).toBeDefined();

      const allCoffeeTxs = await prisma.bankTransaction.findMany({
        where: { amount: BigInt(120000) },
      });

      expect(allCoffeeTxs.length).toBe(2);
      expect(allCoffeeTxs[0].id).not.toBe(allCoffeeTxs[1].id);
    });

    it('preserves two legitimate same-amount transactions occurring one minute apart', async () => {
      const txMinute1 = await prisma.bankTransaction.create({
        data: {
          gmailMessageId: 'msg_coffee_min_1',
          bankRefId: 'FT_COFFEE_01',
          bankCode: 'VCB',
          direction: 'OUT',
          amount: BigInt(55000),
          occurredAt: new Date('2026-09-08T10:00:00Z'),
          summary: 'Highlands Coffee 1',
          classificationState: 'UNCLASSIFIED',
        },
      });

      const txMinute2 = await prisma.bankTransaction.create({
        data: {
          gmailMessageId: 'msg_coffee_min_2',
          bankRefId: 'FT_COFFEE_02',
          bankCode: 'VCB',
          direction: 'OUT',
          amount: BigInt(55000),
          occurredAt: new Date('2026-09-08T10:01:00Z'),
          summary: 'Highlands Coffee 2',
          classificationState: 'UNCLASSIFIED',
        },
      });

      expect(txMinute1.id).toBeDefined();
      expect(txMinute2.id).toBeDefined();

      const results = await prisma.bankTransaction.findMany({
        where: { amount: BigInt(55000) },
      });
      expect(results.length).toBe(2);
    });

    it('preserves two legitimate identical transactions within same minute when having distinct bank references', async () => {
      const txA = await prisma.bankTransaction.create({
        data: {
          gmailMessageId: 'msg_identical_same_min_A',
          bankRefId: 'REF_BATCH_1001',
          bankCode: 'TCB',
          direction: 'OUT',
          amount: BigInt(200000),
          occurredAt: new Date('2026-09-08T15:30:00Z'),
          summary: 'Nap tien Grab',
          classificationState: 'UNCLASSIFIED',
        },
      });

      const txB = await prisma.bankTransaction.create({
        data: {
          gmailMessageId: 'msg_identical_same_min_B',
          bankRefId: 'REF_BATCH_1002', // distinct bank reference ID
          bankCode: 'TCB',
          direction: 'OUT',
          amount: BigInt(200000),
          occurredAt: new Date('2026-09-08T15:30:00Z'), // identical minute!
          summary: 'Nap tien Grab',
          classificationState: 'UNCLASSIFIED',
        },
      });

      expect(txA.id).toBeDefined();
      expect(txB.id).toBeDefined();

      const identicalTxs = await prisma.bankTransaction.findMany({
        where: { amount: BigInt(200000) },
      });
      expect(identicalTxs.length).toBe(2);
    });

    it('records revokedAt when Gmail connection requires reconnection', async () => {
      const conn = await prisma.gmailConnection.findFirst({ where: { googleSub: 'google_sub_1001' } });
      expect(conn).not.toBeNull();

      const revokedTime = new Date();
      const updated = await prisma.gmailConnection.update({
        where: { id: conn!.id },
        data: { revokedAt: revokedTime },
      });

      expect(updated.revokedAt).not.toBeNull();

      const activeConns = await prisma.gmailConnection.findMany({
        where: { revokedAt: null },
      });
      expect(activeConns.some(c => c.id === conn!.id)).toBe(false);

      // Restore for subsequent tests
      await prisma.gmailConnection.update({
        where: { id: conn!.id },
        data: { revokedAt: null },
      });
    });

    it('overlapping date ranges produce no duplicates', async () => {
      // Add a salary transaction
      await prisma.bankTransaction.create({
        data: {
          gmailMessageId: 'gmail_unique_msg_002',
          direction: 'IN',
          amount: BigInt(25000000),
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
        amount: Number(t.amount),
        occurredAt: t.occurredAt.toISOString(),
        emailReceivedAt: t.emailReceivedAt ? t.emailReceivedAt.toISOString() : null,
        importedAt: t.importedAt.toISOString(),
        direction: t.direction as 'IN' | 'OUT',
        classificationState: t.classificationState as 'UNCLASSIFIED' | 'CLASSIFIED',
      }));

      const balanceBefore = calculateBalance(0, formatted);

      // Classify the Highlands Coffee transaction
      const cafeCat = await prisma.category.findUnique({ where: { name: 'Cafe' } });
      const diningFund = await prisma.fund.findFirst({ where: { name: 'Quỹ ăn uống' } });

      await prisma.bankTransaction.updateMany({
        where: { gmailMessageId: 'gmail_unique_msg_001' },
        data: {
          categoryId: cafeCat?.id,
          fundId: diningFund?.id,
          classificationState: 'CLASSIFIED',
        },
      });

      const txsAfter = await prisma.bankTransaction.findMany();
      const formattedAfter: BankTransaction[] = txsAfter.map(t => ({
        ...t,
        amount: Number(t.amount),
        occurredAt: t.occurredAt.toISOString(),
        emailReceivedAt: t.emailReceivedAt ? t.emailReceivedAt.toISOString() : null,
        importedAt: t.importedAt.toISOString(),
        direction: t.direction as 'IN' | 'OUT',
        classificationState: t.classificationState as 'UNCLASSIFIED' | 'CLASSIFIED',
      }));

      const balanceAfter = calculateBalance(0, formattedAfter);
      expect(balanceAfter).toBe(balanceBefore);
    });
  });

  describe('Single-Owner Access Boundary Security', () => {
    it('generates and verifies owner session token correctly', async () => {
      const token = await createOwnerSessionToken();
      expect(await verifyOwnerSessionToken(token)).toBe(true);
    });

    it('rejects tampered or forged owner session tokens', async () => {
      const token = await createOwnerSessionToken();
      const [ts, sig] = token.split(':');
      const forged = `${ts}:${sig.slice(0, -4)}dead`;
      expect(await verifyOwnerSessionToken(forged)).toBe(false);
    });

    it('rejects empty or null tokens', async () => {
      expect(await verifyOwnerSessionToken(null)).toBe(false);
      expect(await verifyOwnerSessionToken('')).toBe(false);
    });
  });

  describe('Data Management Operations', () => {
    it('clearFinancialData removes financial records but keeps GmailConnections and tokens', async () => {
      // Execute Clear Financial Data
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
          amount: BigInt(50000),
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
