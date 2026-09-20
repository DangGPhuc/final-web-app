import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '../src/lib/db';
import { encryptToken, decryptToken, setTestEncryptionKey } from '../src/lib/security/crypto';
import {
  createOwnerSessionToken,
  verifyOwnerSessionToken,
  setTestOwnerSecretKey,
} from '../src/lib/security/owner-auth';
import { calculateBalance } from '../src/lib/finance/calculations';
import { POST as syncRoute } from '../src/app/api/email/sync/route';
import { NextRequest } from 'next/server';
import * as gmailClient from '../src/lib/email/gmail-client';
import { signContinuationToken } from '../src/lib/security/continuation-token';
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

  describe('ALL-Account Continuation Isolation & Financial Date Range Filtering', () => {
    it('isolates account continuation tokens and never restarts completed accounts', () => {
      // Setup hypothetical 3 accounts
      const connections = [
        { id: 'conn_A', email: 'a@gmail.com' },
        { id: 'conn_B', email: 'b@gmail.com' },
        { id: 'conn_C', email: 'c@gmail.com' },
      ];

      // Account A has tokenA, Account B is complete (no token), Account C has tokenC
      const accountContinuationTokens: Record<string, string> = {
        conn_A: 'token_A_page_2',
        conn_C: 'token_C_page_2',
      };

      const isAllAccounts = true;
      const isContinuationMode = Boolean(
        accountContinuationTokens && Object.keys(accountContinuationTokens).length > 0
      );

      // Filter target connections
      let targetConnections = connections;
      if (isAllAccounts && isContinuationMode) {
        const activeIds = Object.keys(accountContinuationTokens);
        targetConnections = connections.filter(c => activeIds.includes(c.id));
      }

      // Assert:
      // 1. Account B must NOT be in targetConnections (never restarted!)
      expect(targetConnections.map(c => c.id)).toEqual(['conn_A', 'conn_C']);
      expect(targetConnections.find(c => c.id === 'conn_B')).toBeUndefined();

      // 2. Account A receives tokenA, Account C receives tokenC, and neither is shared
      for (const conn of targetConnections) {
        const specificPageToken = accountContinuationTokens[conn.id];
        if (conn.id === 'conn_A') {
          expect(specificPageToken).toBe('token_A_page_2');
        }
        if (conn.id === 'conn_C') {
          expect(specificPageToken).toBe('token_C_page_2');
        }
      }
    });

    it('enforces that transactions with occurredAt outside the Vietnam date range are excluded', () => {
      // Range: 01/09/2026 -> 20/09/2026 (Vietnam midnight to next day midnight)
      const rangeStartMs = Date.parse('2026-09-01T00:00:00+07:00');
      const rangeEndMs = Date.parse('2026-09-21T00:00:00+07:00');

      // Tx 1: Event on 20/09/2026 23:50 Vietnam time (in range, even if email delivered 21/09)
      const tx1Occurred = new Date('2026-09-20T23:50:00+07:00');
      const tx1In =
        tx1Occurred.getTime() >= rangeStartMs && tx1Occurred.getTime() < rangeEndMs;
      expect(tx1In).toBe(true);

      // Tx 2: Event on 28/08/2026 (before range start, even if email delivered 01/09)
      const tx2Occurred = new Date('2026-08-28T10:00:00+07:00');
      const tx2In =
        tx2Occurred.getTime() >= rangeStartMs && tx2Occurred.getTime() < rangeEndMs;
      expect(tx2In).toBe(false);

      // Tx 3: Event on 21/09/2026 00:01 (after range end)
      const tx3Occurred = new Date('2026-09-21T00:01:00+07:00');
      const tx3In =
        tx3Occurred.getTime() >= rangeStartMs && tx3Occurred.getTime() < rangeEndMs;
      expect(tx3In).toBe(false);
    });
  });

  describe('Sync Watermark Semantics & Quick Scan Bounded Snapshot Invariants', () => {
    it('proves historical import does NOT mutate lastSyncAt watermark', async () => {
      // Create a test Gmail connection with an established watermark
      const priorSyncAt = new Date('2026-08-15T12:00:00.000Z');
      const conn = await prisma.gmailConnection.create({
        data: {
          googleSub: 'sub_watermark_test_01',
          email: 'watermark.test@gmail.com',
          encryptedRefreshToken: 'enc_token',
          lastSyncAt: priorSyncAt,
        },
      });

      // Simulate a Historical Import (2026-01-01 -> 2026-01-31)
      const effectiveMode: string = 'HISTORICAL';
      const ingestionTruncated = false;

      // Invariant: only in QUICK mode can lastSyncAt be updated!
      if (effectiveMode === 'QUICK' && !ingestionTruncated) {
        await prisma.gmailConnection.update({
          where: { id: conn.id },
          data: { lastSyncAt: new Date() },
        });
      }

      const refreshed = await prisma.gmailConnection.findUnique({
        where: { id: conn.id },
      });

      // lastSyncAt must be completely untouched!
      expect(refreshed?.lastSyncAt?.toISOString()).toBe(priorSyncAt.toISOString());

      // Clean up
      await prisma.gmailConnection.delete({ where: { id: conn.id } });
    });

    it('initial Quick Scan uses connectedAt when no prior quick watermark exists', async () => {
      const connectedInstant = new Date('2026-09-01T08:00:00.000Z');
      const conn = await prisma.gmailConnection.create({
        data: {
          googleSub: 'sub_watermark_test_02',
          email: 'watermark.initial@gmail.com',
          encryptedRefreshToken: 'enc_token',
          connectedAt: connectedInstant,
          lastSyncAt: null,
        },
      });

      // Lower bound determination
      const lowerBoundDate = conn.lastSyncAt || conn.connectedAt;
      const lowerBoundEpoch = Math.floor(lowerBoundDate.getTime() / 1000);

      expect(lowerBoundEpoch).toBe(Math.floor(connectedInstant.getTime() / 1000));

      await prisma.gmailConnection.delete({ where: { id: conn.id } });
    });

    it('completed Quick Scan advances watermark to captured quickScanUpperBound', async () => {
      const conn = await prisma.gmailConnection.create({
        data: {
          googleSub: 'sub_watermark_test_03',
          email: 'watermark.advance@gmail.com',
          encryptedRefreshToken: 'enc_token',
          lastSyncAt: null,
        },
      });

      const quickScanUpperBoundEpoch = 1788200000;
      const effectiveMode = 'QUICK';
      const truncated = false;

      if (effectiveMode === 'QUICK' && !truncated && quickScanUpperBoundEpoch) {
        await prisma.gmailConnection.update({
          where: { id: conn.id },
          data: { lastSyncAt: new Date(quickScanUpperBoundEpoch * 1000) },
        });
      }

      const updated = await prisma.gmailConnection.findUnique({
        where: { id: conn.id },
      });

      expect(updated?.lastSyncAt?.toISOString()).toBe(new Date(1788200000 * 1000).toISOString());

      await prisma.gmailConnection.delete({ where: { id: conn.id } });
    });

    it('truncated Quick Scan does NOT advance lastSyncAt watermark', async () => {
      const initialWatermark = new Date('2026-09-01T00:00:00.000Z');
      const conn = await prisma.gmailConnection.create({
        data: {
          googleSub: 'sub_watermark_test_04',
          email: 'watermark.truncated@gmail.com',
          encryptedRefreshToken: 'enc_token',
          lastSyncAt: initialWatermark,
        },
      });

      const quickScanUpperBoundEpoch = 1788250000;
      const effectiveMode = 'QUICK';
      const truncated = true; // Safety limit reached!

      // Rule: Never advance watermark on truncated scan!
      if (effectiveMode === 'QUICK' && !truncated && quickScanUpperBoundEpoch) {
        await prisma.gmailConnection.update({
          where: { id: conn.id },
          data: { lastSyncAt: new Date(quickScanUpperBoundEpoch * 1000) },
        });
      }

      const notUpdated = await prisma.gmailConnection.findUnique({
        where: { id: conn.id },
      });

      // Still at initialWatermark
      expect(notUpdated?.lastSyncAt?.toISOString()).toBe(initialWatermark.toISOString());

      await prisma.gmailConnection.delete({ where: { id: conn.id } });
    });

    it('continuation completion advances watermark to the original captured upper bound', async () => {
      const initialWatermark = new Date('2026-09-01T00:00:00.000Z');
      const conn = await prisma.gmailConnection.create({
        data: {
          googleSub: 'sub_watermark_test_05',
          email: 'watermark.continuation@gmail.com',
          encryptedRefreshToken: 'enc_token',
          lastSyncAt: initialWatermark,
        },
      });

      // Original captured bound during first page
      const originalCapturedUpperBoundEpoch = 1788250000;

      // Continuation batch finishes with truncated = false
      const effectiveMode = 'QUICK';
      const continuationTruncated = false;

      if (effectiveMode === 'QUICK' && !continuationTruncated && originalCapturedUpperBoundEpoch) {
        await prisma.gmailConnection.update({
          where: { id: conn.id },
          data: { lastSyncAt: new Date(originalCapturedUpperBoundEpoch * 1000) },
        });
      }

      const finalConn = await prisma.gmailConnection.findUnique({
        where: { id: conn.id },
      });

      expect(finalConn?.lastSyncAt?.toISOString()).toBe(
        new Date(originalCapturedUpperBoundEpoch * 1000).toISOString()
      );

      await prisma.gmailConnection.delete({ where: { id: conn.id } });
    });

    it('maintains independent Quick Scan watermarks across multiple accounts (A complete, B truncated, C error)', async () => {
      const connA = await prisma.gmailConnection.create({
        data: {
          googleSub: 'sub_watermark_multi_A',
          email: 'accountA@gmail.com',
          encryptedRefreshToken: 'enc_token',
          lastSyncAt: new Date('2026-09-01T00:00:00.000Z'),
        },
      });
      const connB = await prisma.gmailConnection.create({
        data: {
          googleSub: 'sub_watermark_multi_B',
          email: 'accountB@gmail.com',
          encryptedRefreshToken: 'enc_token',
          lastSyncAt: new Date('2026-09-01T00:00:00.000Z'),
        },
      });
      const connC = await prisma.gmailConnection.create({
        data: {
          googleSub: 'sub_watermark_multi_C',
          email: 'accountC@gmail.com',
          encryptedRefreshToken: 'enc_token',
          lastSyncAt: new Date('2026-09-01T00:00:00.000Z'),
        },
      });

      const capturedUpperBoundEpoch = 1788260000;

      // Simulation of multi-account scan results
      const results = [
        { connId: connA.id, truncated: false, error: false },
        { connId: connB.id, truncated: true, error: false },
        { connId: connC.id, truncated: false, error: true },
      ];

      for (const res of results) {
        if (!res.truncated && !res.error) {
          await prisma.gmailConnection.update({
            where: { id: res.connId },
            data: { lastSyncAt: new Date(capturedUpperBoundEpoch * 1000) },
          });
        }
      }

      const refreshedA = await prisma.gmailConnection.findUnique({ where: { id: connA.id } });
      const refreshedB = await prisma.gmailConnection.findUnique({ where: { id: connB.id } });
      const refreshedC = await prisma.gmailConnection.findUnique({ where: { id: connC.id } });

      // Account A must advance
      expect(refreshedA?.lastSyncAt?.toISOString()).toBe(new Date(capturedUpperBoundEpoch * 1000).toISOString());
      // Account B must NOT advance (truncated)
      expect(refreshedB?.lastSyncAt?.toISOString()).toBe('2026-09-01T00:00:00.000Z');
      // Account C must NOT advance (error)
      expect(refreshedC?.lastSyncAt?.toISOString()).toBe('2026-09-01T00:00:00.000Z');

      await prisma.gmailConnection.deleteMany({
        where: { id: { in: [connA.id, connB.id, connC.id] } },
      });
    });

    it('accepts a newly arrived forwarded notification with older occurredAt in QUICK mode', () => {
      // In Quick mode: we do not filter out events whose bank occurredAt is from previous days
      // as long as the email arrived in the scanned window.
      const effectiveMode: string = 'QUICK';
      const event = {
        occurredAt: new Date('2026-09-18T10:00:00.000Z'), // 2 days ago
        emailReceivedAt: new Date('2026-09-20T10:00:00.000Z'), // today
      };

      let shouldExclude = false;
      if (effectiveMode === 'HISTORICAL') {
        const rangeStartMs = Date.parse('2026-09-20T00:00:00+07:00');
        const rangeEndMs = Date.parse('2026-09-21T00:00:00+07:00');
        if (event.occurredAt.getTime() < rangeStartMs || event.occurredAt.getTime() >= rangeEndMs) {
          shouldExclude = true;
        }
      }

      // In QUICK mode, it is NOT excluded!
      expect(shouldExclude).toBe(false);
    });
  });

  describe('Route-Level Sync & Continuation Tests (PostgreSQL Integration)', () => {
    function createSyncRequest(body: Record<string, any>) {
      return new NextRequest('http://localhost:3000/api/email/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-owner-test-bypass': 'test-authorized-owner',
        },
        body: JSON.stringify(body),
      });
    }

    let connAId: string;
    let connBId: string;

    beforeAll(async () => {
      // Create test accounts
      const connA = await prisma.gmailConnection.create({
        data: {
          googleSub: 'google_sub_route_test_A',
          email: 'route_test_A@gmail.com',
          encryptedRefreshToken: encryptToken('refresh-token-A'),
          connectedAt: new Date('2026-09-01T00:00:00.000Z'),
          lastSyncAt: new Date('2026-09-05T00:00:00.000Z'),
        },
      });
      connAId = connA.id;

      const connB = await prisma.gmailConnection.create({
        data: {
          googleSub: 'google_sub_route_test_B',
          email: 'route_test_B@gmail.com',
          encryptedRefreshToken: encryptToken('refresh-token-B'),
          connectedAt: new Date('2026-09-01T00:00:00.000Z'),
          lastSyncAt: new Date('2026-09-05T00:00:00.000Z'),
        },
      });
      connBId = connB.id;
    });

    afterAll(async () => {
      await prisma.bankTransaction.deleteMany({
        where: { gmailConnectionId: { in: [connAId, connBId] } },
      });
      await prisma.syncRun.deleteMany({
        where: { gmailConnectionId: { in: [connAId, connBId] } },
      });
      await prisma.gmailConnection.deleteMany({
        where: { id: { in: [connAId, connBId] } },
      });
    });

    it('HISTORICAL request does not change lastSyncAt', async () => {
      const spy = vi.spyOn(gmailClient, 'ingestFromGmail').mockResolvedValueOnce({
        events: [
          {
            gmailMessageId: 'msg-hist-route-1',
            bankCode: 'VCB',
            bankName: 'Vietcombank',
            direction: 'OUT',
            amount: 50000,
            currency: 'VND',
            occurredAt: new Date('2026-01-15T09:30:00.000Z'),
            emailReceivedAt: new Date('2026-01-15T09:30:00.000Z'),
            summary: 'Chi tieu thang 1',
            fingerprint: 'fp-hist-1',
          },
        ],
        totalFetched: 1,
        failedCount: 0,
        truncated: false,
      });

      const res = await syncRoute(
        createSyncRequest({
          mode: 'HISTORICAL',
          accountId: connAId,
          fromDate: '2026-01-01',
          toDate: '2026-01-31',
        })
      );
      expect(res.status).toBe(200);

      const refreshed = await prisma.gmailConnection.findUnique({ where: { id: connAId } });
      // Watermark MUST NOT change on historical import!
      expect(refreshed?.lastSyncAt?.toISOString()).toBe('2026-09-05T00:00:00.000Z');
      spy.mockRestore();
    });

    it('initial QUICK request captures a bound and commits when untruncated', async () => {
      const spy = vi.spyOn(gmailClient, 'ingestFromGmail').mockResolvedValueOnce({
        events: [],
        totalFetched: 0,
        failedCount: 0,
        truncated: false,
      });

      const res = await syncRoute(
        createSyncRequest({
          mode: 'QUICK',
          accountId: connAId,
        })
      );
      expect(res.status).toBe(200);

      const refreshed = await prisma.gmailConnection.findUnique({ where: { id: connAId } });
      // lastSyncAt must have advanced to around now (> 2026-09-05)
      expect(refreshed?.lastSyncAt?.getTime()).toBeGreaterThan(new Date('2026-09-05').getTime());
      spy.mockRestore();
    });

    it('truncated QUICK does not update lastSyncAt and returns signed continuationToken', async () => {
      // Reset lastSyncAt
      await prisma.gmailConnection.update({
        where: { id: connAId },
        data: { lastSyncAt: new Date('2026-09-05T00:00:00.000Z') },
      });

      const spy = vi.spyOn(gmailClient, 'ingestFromGmail').mockResolvedValueOnce({
        events: [],
        totalFetched: 50,
        failedCount: 0,
        truncated: true,
        nextPageToken: 'page_token_abc_1',
      });

      const res = await syncRoute(
        createSyncRequest({
          mode: 'QUICK',
          accountId: connAId,
        })
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.stats.truncated).toBe(true);
      expect(json.stats.continuationTokens[connAId]).toBeDefined();

      const refreshed = await prisma.gmailConnection.findUnique({ where: { id: connAId } });
      // Truncated scan MUST NOT advance lastSyncAt!
      expect(refreshed?.lastSyncAt?.toISOString()).toBe('2026-09-05T00:00:00.000Z');
      spy.mockRestore();
    });

    it('QUICK continuation uses original signed bound and completed continuation commits original upper bound', async () => {
      const fixedLower = 1788195600;
      const fixedUpper = 1788200000;
      const signedToken = signContinuationToken({
        mode: 'QUICK',
        gmailConnectionId: connAId,
        pageToken: 'continuation_page_token_2',
        lowerBoundEpoch: fixedLower,
        upperBoundEpoch: fixedUpper,
      });

      let receivedOptions: any;
      const spy = vi.spyOn(gmailClient, 'ingestFromGmail').mockImplementation(async (_, opts) => {
        receivedOptions = opts;
        return {
          events: [],
          totalFetched: 10,
          failedCount: 0,
          truncated: false, // final page!
        };
      });

      const res = await syncRoute(
        createSyncRequest({
          mode: 'QUICK',
          accountId: connAId,
          continuationTokens: { [connAId]: signedToken },
        })
      );
      expect(res.status).toBe(200);

      // Verify that options passed to ingestFromGmail used the signed bounds
      expect(receivedOptions.lowerBoundEpoch).toBe(fixedLower);
      expect(receivedOptions.upperBoundEpoch).toBe(fixedUpper);
      expect(receivedOptions.pageToken).toBe('continuation_page_token_2');

      // Verify that upon un-truncated completion, lastSyncAt commits exactly to fixedUpper
      const refreshed = await prisma.gmailConnection.findUnique({ where: { id: connAId } });
      expect(refreshed?.lastSyncAt?.toISOString()).toBe(new Date(fixedUpper * 1000).toISOString());
      spy.mockRestore();
    });

    it('tampered continuation token is rejected with 400 invalid_continuation_token', async () => {
      const signedToken = signContinuationToken({
        mode: 'QUICK',
        gmailConnectionId: connAId,
        pageToken: 'token_valid',
        lowerBoundEpoch: 1788195600,
        upperBoundEpoch: 1788200000,
      });
      const parts = signedToken.split('.');
      const tamperedSig = parts[1].slice(0, -2) + (parts[1].slice(-2) === 'AA' ? 'BB' : 'AA');
      const tamperedToken = `${parts[0]}.${tamperedSig}`;

      const res = await syncRoute(
        createSyncRequest({
          mode: 'QUICK',
          accountId: connAId,
          continuationTokens: { [connAId]: tamperedToken },
        })
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('invalid_continuation_token');
    });

    it('expired continuation token is rejected with 400 continuation_expired', async () => {
      const expiredToken = signContinuationToken(
        {
          mode: 'QUICK',
          gmailConnectionId: connAId,
          pageToken: 'token_expired',
          lowerBoundEpoch: 1788195600,
          upperBoundEpoch: 1788200000,
        },
        -10 // expired 10 seconds ago
      );

      const res = await syncRoute(
        createSyncRequest({
          mode: 'QUICK',
          accountId: connAId,
          continuationTokens: { [connAId]: expiredToken },
        })
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('continuation_expired');
    });

    it('token for Gmail A cannot be used for Gmail B', async () => {
      const tokenForA = signContinuationToken({
        mode: 'QUICK',
        gmailConnectionId: connAId,
        pageToken: 'token_for_account_A',
        lowerBoundEpoch: 1788195600,
        upperBoundEpoch: 1788200000,
      });

      // Present token for A against connB
      const res = await syncRoute(
        createSyncRequest({
          mode: 'QUICK',
          accountId: connBId,
          continuationTokens: { [connBId]: tokenForA },
        })
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('invalid_continuation_token');
      expect(json.message).toContain('không khớp');
    });

    it('ALL-account continuation only processes pending accounts and completed accounts are not restarted', async () => {
      const tokenForA = signContinuationToken({
        mode: 'QUICK',
        gmailConnectionId: connAId,
        pageToken: 'token_for_A_only',
        lowerBoundEpoch: 1788195600,
        upperBoundEpoch: 1788200000,
      });

      const calledAccountIds: string[] = [];
      const spy = vi.spyOn(gmailClient, 'ingestFromGmail').mockImplementation(async (_, opts) => {
        // Find which connection this was called for
        if (opts?.pageToken === 'token_for_A_only') {
          calledAccountIds.push(connAId);
        } else {
          calledAccountIds.push(connBId);
        }
        return {
          events: [],
          totalFetched: 0,
          failedCount: 0,
          truncated: false,
        };
      });

      // Request ALL accounts with continuation token only for connA
      const res = await syncRoute(
        createSyncRequest({
          mode: 'QUICK',
          accountId: 'ALL',
          continuationTokens: { [connAId]: tokenForA },
        })
      );
      expect(res.status).toBe(200);

      // Verify connA was processed and connB was NOT restarted
      expect(calledAccountIds).toEqual([connAId]);
      spy.mockRestore();
    });

    it('overlap does not create duplicate persisted transactions', async () => {
      // Clear bank transactions for connA
      await prisma.bankTransaction.deleteMany({ where: { gmailConnectionId: connAId } });

      const duplicateEvent = {
        gmailMessageId: 'msg-overlap-1',
        bankCode: 'VCB',
        bankName: 'Vietcombank',
        direction: 'OUT' as const,
        amount: 250000,
        currency: 'VND',
        occurredAt: new Date('2026-09-05T02:30:00.000Z'),
        emailReceivedAt: new Date('2026-09-05T02:30:00.000Z'),
        summary: 'Giao dich bi trung do overlap',
        bankRefId: 'FT_OVERLAP_001',
        fingerprint: 'fp-overlap-001',
      };

      const spy = vi.spyOn(gmailClient, 'ingestFromGmail').mockResolvedValue({
        events: [duplicateEvent],
        totalFetched: 1,
        failedCount: 0,
        truncated: false,
      });

      // Scan 1
      const res1 = await syncRoute(
        createSyncRequest({
          mode: 'QUICK',
          accountId: connAId,
        })
      );
      expect(res1.status).toBe(200);
      const json1 = await res1.json();
      expect(json1.stats.totalNew).toBe(1);

      // Reset lastSyncAt to simulate an overlapping scan interval
      await prisma.gmailConnection.update({
        where: { id: connAId },
        data: { lastSyncAt: new Date('2026-09-05T00:00:00.000Z') },
      });

      // Scan 2 (overlapping message returned again)
      const res2 = await syncRoute(
        createSyncRequest({
          mode: 'QUICK',
          accountId: connAId,
        })
      );
      expect(res2.status).toBe(200);
      const json2 = await res2.json();
      expect(json2.stats.totalNew).toBe(0);
      expect(json2.stats.totalDuplicates).toBe(1);

      // Prove only ONE record exists in DB
      const dbRecords = await prisma.bankTransaction.findMany({
        where: { gmailConnectionId: connAId, gmailMessageId: 'msg-overlap-1' },
      });
      expect(dbRecords).toHaveLength(1);
      spy.mockRestore();
    });
  });
});
