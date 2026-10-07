import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DeBankError } from '@/server/debank';
import type { WalletData } from '@/shared/wallets';
const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findUnique: vi.fn(),
  claim: vi.fn(),
  config: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock('@/server/db', () => ({
  db: () => ({
    walletConnection: {
      findMany: mocks.findMany,
      findUnique: mocks.findUnique,
      updateMany: mocks.claim,
    },
    deBankConfig: { findUnique: mocks.config },
    $transaction: mocks.transaction,
  }),
}));
import { syncDueWallets, syncWallet } from '@/server/wallets';
const data = { totalUsd: '905' } as WalletData;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
  mocks.findUnique.mockImplementation(async ({ where }) => ({
    id: where.id,
    portfolioId: 'owner',
    address: where.id,
    failureCount: 0,
  }));
  mocks.config.mockResolvedValue({ enabled: true, mode: 'PUBLIC', intervalMinutes: 60 });
  mocks.claim.mockResolvedValue({ count: 1 });
  mocks.transaction.mockResolvedValue('succeeded');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it('bounds concurrency to one and continues after provider failure without writing an observation', async () => {
  let concurrent = 0,
    maximum = 0;
  const provider = vi.fn(async (address: string) => {
    maximum = Math.max(maximum, ++concurrent);
    await Promise.resolve();
    concurrent--;
    if (address === 'b') throw new DeBankError('RATE_LIMIT');
    return data;
  });
  expect(await syncDueWallets(provider)).toEqual({
    processed: 3,
    succeeded: 2,
    failed: 1,
    skipped: 0,
    hasMore: false,
  });
  expect(maximum).toBe(1);
  expect(mocks.transaction).toHaveBeenCalledTimes(2);
  expect(mocks.claim).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ status: 'ERROR', errorCode: 'RATE_LIMIT' }),
    }),
  );
  expect(mocks.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      take: 21,
      where: expect.objectContaining({
        deletedAt: null,
        enabled: true,
        portfolio: { debank: { is: { enabled: true } } },
      }),
    }),
  );
});
it('does not call a provider when the database lease/freshness check refuses the claim', async () => {
  mocks.claim.mockResolvedValue({ count: 0 });
  const provider = vi.fn();
  expect(await syncDueWallets(provider)).toMatchObject({ succeeded: 0, skipped: 3 });
  expect(provider).not.toHaveBeenCalled();
  expect(await syncWallet('a', provider)).toBe(false);
});
it('isolates database errors on individual wallets', async () => {
  mocks.findUnique.mockRejectedValueOnce(new Error('secret DB url'));
  expect(await syncDueWallets(async () => data)).toMatchObject({ succeeded: 2, failed: 1 });
});
it('reserves time for the last wallet and signals remaining work', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const provider = vi.fn(async () => {
    vi.setSystemTime(120_001);
    return data;
  });
  expect(await syncDueWallets(provider)).toMatchObject({
    processed: 1,
    succeeded: 1,
    hasMore: true,
  });
});
it('signals batches larger than the current invocation cap', async () => {
  mocks.findMany.mockResolvedValue(Array.from({ length: 21 }, (_, id) => ({ id: String(id) })));
  expect(await syncDueWallets(async () => data)).toMatchObject({
    processed: 20,
    succeeded: 20,
    hasMore: true,
  });
});
