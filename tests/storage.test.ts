import { describe, it, expect } from 'vitest';
import { MemoryStorageAdapter } from '../src/lib/storage/local-storage-adapter';
import { loadSnapshot, saveSnapshot, STORAGE_KEY, type LegacyAppDataSnapshot } from '../src/lib/storage/persistence';

describe('Storage Persistence & Migration', () => {
  it('returns empty snapshot for fresh storage', () => {
    const adapter = new MemoryStorageAdapter();
    const result = loadSnapshot(adapter);

    expect(result.status).toBe('EMPTY');
    if (result.status === 'ERROR') throw new Error(result.error);
    expect(result.data.schemaVersion).toBe(3);
    expect(result.data.transactions).toEqual([]);
    expect(result.data.funds).toEqual([]);
  });

  it('saves and loads v3 snapshot correctly', () => {
    const adapter = new MemoryStorageAdapter();
    const initialData: LegacyAppDataSnapshot = {
      schemaVersion: 3,
      exportedAt: new Date().toISOString(),
      transactions: [
        {
          id: 'tx-1',
          amount: 15000000,
        },
      ],
      funds: [
        {
          id: 'fund-1',
          name: 'Quỹ ăn uống',
        },
      ],
      monthlySnapshots: [],
      paperTrades: [],
    };

    const saveRes = saveSnapshot(adapter, initialData);
    expect(saveRes.ok).toBe(true);

    const loadRes = loadSnapshot(adapter);
    expect(loadRes.status).toBe('OK');
    if (loadRes.status !== 'OK') throw new Error('Expected OK');
    expect(loadRes.data.transactions.length).toBe(1);
    expect(loadRes.data.funds.length).toBe(1);
  });

  it('gracefully handles and migrates old v2/wallet schema without crashing', () => {
    const adapter = new MemoryStorageAdapter();
    adapter.setItem(
      STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 2,
        wallets: [{ id: 'wal-1', balance: 200000000 }],
        budgets: [{ id: 'b-1', amount: 5000000 }],
        transactions: [],
      })
    );

    const loadRes = loadSnapshot(adapter);
    expect(loadRes.status).toBe('MIGRATION');
    if (loadRes.status !== 'MIGRATION') throw new Error('Expected MIGRATION');
    expect(loadRes.data.schemaVersion).toBe(3);
    expect(loadRes.data.funds).toEqual([]);
    expect(loadRes.data.transactions).toEqual([]);
  });
});
