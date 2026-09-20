import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '../src/lib/db';
import { setTestEncryptionKey } from '../src/lib/security/crypto';
import {
  setTestOwnerSecretKey,
  createOwnerSessionToken,
  OWNER_COOKIE_NAME,
} from '../src/lib/security/owner-auth';
import { POST as factoryResetRoute } from '../src/app/api/data/factory-reset/route';
import {
  executeFactoryReset,
  type FactoryResetStateSetters,
} from '../src/lib/data/factory-reset-client';

const TEST_KEY = Buffer.alloc(32, 5).toString('hex');
const TEST_OWNER_KEY = Buffer.alloc(32, 8).toString('hex');

describe('Factory Reset — Server & Frontend Session Termination', () => {
  beforeAll(async () => {
    setTestEncryptionKey(TEST_KEY);
    setTestOwnerSecretKey(TEST_OWNER_KEY);
  });

  afterAll(async () => {
    setTestEncryptionKey(null);
    setTestOwnerSecretKey(null);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clear test tables
    await prisma.bankTransaction.deleteMany();
    await prisma.category.deleteMany();
    await prisma.fund.deleteMany();
    await prisma.monthlySnapshot.deleteMany();
    await prisma.syncRun.deleteMany();
    await prisma.gmailConnection.deleteMany();
  });

  describe('Backend Route (POST /api/data/factory-reset)', () => {
    it('rejects unauthenticated requests without deleting data or clearing cookie', async () => {
      // Seed some test data
      await prisma.fund.create({
        data: { name: 'Emergency Fund', monthlyAllocation: 5000000n },
      });

      const req = new NextRequest('http://localhost:3000/api/data/factory-reset', {
        method: 'POST',
      });

      const res = await factoryResetRoute(req);
      expect(res.status).toBe(401);

      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Owner session required');

      // Database remains untouched
      expect(await prisma.fund.count()).toBe(1);

      // No cookie deletion header sent
      const setCookie = res.headers.get('set-cookie');
      expect(setCookie).toBeNull();
    });

    it('successfully purges all data, revokes tokens, and deletes cockpit_owner_session cookie', async () => {
      // 1. Seed complete test state across multiple tables
      const conn = await prisma.gmailConnection.create({
        data: {
          googleSub: 'sub_factory_reset_test_01',
          email: 'factory.reset@gmail.com',
          encryptedRefreshToken: 'dummy_encrypted_token',
        },
      });

      const fund = await prisma.fund.create({
        data: { name: 'Living Expenses', monthlyAllocation: 10000000n },
      });

      const cat = await prisma.category.create({
        data: { name: 'Groceries' },
      });

      await prisma.bankTransaction.create({
        data: {
          gmailConnectionId: conn.id,
          gmailMessageId: 'msg_fr_001',
          bankCode: 'VCB',
          bankName: 'Vietcombank',
          direction: 'OUT',
          amount: 250000,
          currency: 'VND',
          occurredAt: new Date('2026-09-15T10:00:00.000Z'),
          emailReceivedAt: new Date('2026-09-15T10:00:00.000Z'),
          fingerprint: 'fp_fr_001',
          summary: 'Thanh toan tien com',
          categoryId: cat.id,
          fundId: fund.id,
        },
      });

      await prisma.monthlySnapshot.create({
        data: {
          month: '2026-08',
          totalIncome: 10000000n,
          totalExpense: 5000000n,
          netSavings: 5000000n,
          fundResultsJson: '[]',
        },
      });

      await prisma.syncRun.create({
        data: {
          accountEmail: 'factory.reset@gmail.com',
          fetchedCount: 1,
          importedCount: 1,
        },
      });

      expect(await prisma.gmailConnection.count()).toBe(1);
      expect(await prisma.bankTransaction.count()).toBe(1);
      expect(await prisma.fund.count()).toBe(1);
      expect(await prisma.category.count()).toBe(1);
      expect(await prisma.monthlySnapshot.count()).toBe(1);
      expect(await prisma.syncRun.count()).toBe(1);

      // 2. Prepare authenticated request with valid owner session cookie
      const validToken = await createOwnerSessionToken();
      const req = new NextRequest('http://localhost:3000/api/data/factory-reset', {
        method: 'POST',
        headers: {
          cookie: `${OWNER_COOKIE_NAME}=${validToken}`,
        },
      });

      // 3. Execute Factory Reset
      const res = await factoryResetRoute(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);

      // 4. Verify cookie deletion semantics on response
      const deletedCookie = res.cookies.get(OWNER_COOKIE_NAME);
      expect(deletedCookie).toBeDefined();
      expect(deletedCookie?.value).toBe('');
      // In Next.js, deleted cookies have expires set to Epoch 1970-01-01
      const expiresTime = deletedCookie?.expires instanceof Date ? deletedCookie.expires.getTime() : deletedCookie?.expires;
      expect(expiresTime).toBe(0);

      const setCookieHeader = res.headers.get('set-cookie');
      expect(setCookieHeader).toBeDefined();
      expect(setCookieHeader).toContain(`${OWNER_COOKIE_NAME}=`);
      expect(setCookieHeader).toContain('Expires=Thu, 01 Jan 1970');

      // 5. Verify database records are completely wiped
      expect(await prisma.gmailConnection.count()).toBe(0);
      expect(await prisma.bankTransaction.count()).toBe(0);
      expect(await prisma.fund.count()).toBe(0);
      expect(await prisma.category.count()).toBe(0);
      expect(await prisma.monthlySnapshot.count()).toBe(0);
      expect(await prisma.syncRun.count()).toBe(0);
    });

    it('fails closed and does not delete owner session cookie if database transaction fails', async () => {
      const validToken = await createOwnerSessionToken();
      const req = new NextRequest('http://localhost:3000/api/data/factory-reset', {
        method: 'POST',
        headers: {
          cookie: `${OWNER_COOKIE_NAME}=${validToken}`,
        },
      });

      // Mock prisma.$transaction to simulate failure
      const txSpy = vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('Simulated DB failure'));

      const res = await factoryResetRoute(req);
      expect(res.status).toBe(500);

      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Simulated DB failure');

      // Crucial: failed reset must NOT report success and must NOT clear owner cookie
      const deletedCookie = res.cookies.get(OWNER_COOKIE_NAME);
      expect(deletedCookie).toBeUndefined();

      txSpy.mockRestore();
    });
  });

  describe('Frontend State Transition (executeFactoryReset)', () => {
    it('immediately sets isOwnerAuthenticated to false, clears in-memory domain state, and does NOT call refreshData', async () => {
      const setters: FactoryResetStateSetters = {
        setTransactions: vi.fn(),
        setFunds: vi.fn(),
        setCategories: vi.fn(),
        setGmailAccounts: vi.fn(),
        setMonthlySnapshots: vi.fn(),
        setClassifyingTransaction: vi.fn(),
        setIsSyncing: vi.fn(),
        setIsOwnerAuthenticated: vi.fn(),
        showToast: vi.fn(),
      };

      const fetchCalls: Array<{ url: string; options?: RequestInit }> = [];
      const mockFetch = vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
        fetchCalls.push({ url, options });
        return {
          ok: true,
          json: async () => ({
            success: true,
            message: 'Đã khôi phục cài đặt gốc',
          }),
        } as Response;
      });

      const result = await executeFactoryReset(setters, mockFetch as unknown as typeof fetch);

      expect(result.success).toBe(true);

      // 1. Auth state must immediately transition to false (lock screen)
      expect(setters.setIsOwnerAuthenticated).toHaveBeenCalledWith(false);

      // 2. All domain state arrays cleared
      expect(setters.setTransactions).toHaveBeenCalledWith([]);
      expect(setters.setFunds).toHaveBeenCalledWith([]);
      expect(setters.setCategories).toHaveBeenCalledWith([]);
      expect(setters.setGmailAccounts).toHaveBeenCalledWith([]);
      expect(setters.setMonthlySnapshots).toHaveBeenCalledWith([]);

      // 3. Transient classification and sync states reset
      expect(setters.setClassifyingTransaction).toHaveBeenCalledWith(null);
      expect(setters.setIsSyncing).toHaveBeenCalledWith(false);

      // 4. Toast notification shown
      expect(setters.showToast).toHaveBeenCalledWith('Đã khôi phục cài đặt gốc', 'info');

      // 5. Invariant: fetch was called EXACTLY ONCE for /api/data/factory-reset.
      // NO authenticated data refresh calls issued after cookie deletion!
      expect(fetchCalls.length).toBe(1);
      expect(fetchCalls[0].url).toBe('/api/data/factory-reset');
      expect(fetchCalls[0].options?.method).toBe('POST');
    });

    it('handles failure gracefully without locking or clearing state prematurely', async () => {
      const setters: FactoryResetStateSetters = {
        setTransactions: vi.fn(),
        setFunds: vi.fn(),
        setCategories: vi.fn(),
        setGmailAccounts: vi.fn(),
        setMonthlySnapshots: vi.fn(),
        setClassifyingTransaction: vi.fn(),
        setIsSyncing: vi.fn(),
        setIsOwnerAuthenticated: vi.fn(),
        showToast: vi.fn(),
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          success: false,
          error: 'Network connection lost',
        }),
      } as Response);

      const result = await executeFactoryReset(setters, mockFetch as unknown as typeof fetch);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network connection lost');

      // State is preserved on failure
      expect(setters.setIsOwnerAuthenticated).not.toHaveBeenCalled();
      expect(setters.setTransactions).not.toHaveBeenCalled();
      expect(setters.setGmailAccounts).not.toHaveBeenCalled();
      expect(setters.showToast).toHaveBeenCalledWith('Network connection lost', 'error');
    });
  });
});
