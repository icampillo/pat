import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  owned: vi.fn(),
  tx: {
    $queryRaw: vi.fn(),
    asset: { findMany: vi.fn() },
    transaction: { findMany: vi.fn() },
    fxRate: { findFirst: vi.fn() },
    assetCategory: { findMany: vi.fn() },
    portfolioSnapshot: { findMany: vi.fn() },
    walletConnection: { findMany: vi.fn(), count: vi.fn() },
    walletSyncConfig: { findUnique: vi.fn() },
    transactionRevision: { count: vi.fn() },
    platform: { findMany: vi.fn() },
  },
}));
vi.mock('@/server/db', () => ({
  db: () => ({
    ...mocks.tx,
    $transaction: (read: (tx: typeof mocks.tx) => unknown) => read(mocks.tx),
  }),
}));
vi.mock('@/server/portfolio-store', async (original) => ({
  ...(await original<typeof import('@/server/portfolio-store')>()),
  owned: mocks.owned,
}));
import { getState } from '@/server/portfolio-query';
import { walletSyncStatus } from '@/server/wallet-state';
beforeEach(() => {
  vi.resetAllMocks();
  mocks.tx.$queryRaw.mockResolvedValue([]);
  mocks.owned.mockResolvedValue({ id: 'portfolio', ownerId: 'owner', version: 1 });
  for (const model of [
    mocks.tx.asset,
    mocks.tx.transaction,
    mocks.tx.assetCategory,
    mocks.tx.portfolioSnapshot,
    mocks.tx.walletConnection,
    mocks.tx.platform,
  ])
    model.findMany.mockResolvedValue([]);
  mocks.tx.walletConnection.count.mockResolvedValue(0);
  mocks.tx.transactionRevision.count.mockResolvedValue(0);
  mocks.tx.walletSyncConfig.findUnique.mockResolvedValue({ enabled: true });
  mocks.tx.fxRate.findFirst.mockResolvedValue(null);
});
it('selects only scalar status fields, scoped to nondeleted owned wallets', async () => {
  await walletSyncStatus('owner');
  expect(mocks.owned).toHaveBeenCalledWith('owner');
  expect(mocks.tx.walletConnection.findMany).toHaveBeenCalledWith({
    where: { portfolioId: 'portfolio', deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      enabled: true,
      status: true,
      errorCode: true,
      lastSuccessAt: true,
      nextSyncAt: true,
    },
  });
  expect(mocks.tx.portfolioSnapshot.findMany).not.toHaveBeenCalled();
  expect(mocks.tx.asset.findMany).not.toHaveBeenCalled();
  expect(mocks.tx.transaction.findMany).not.toHaveBeenCalled();
});
it('omits snapshot SQL entirely in live mode, retaining the exact valuation and full-read contract', async () => {
  const live = await getState('owner', false);
  expect(live).not.toHaveProperty('snapshots');
  expect(live).not.toHaveProperty('historyRevised');
  expect(mocks.tx.portfolioSnapshot.findMany).not.toHaveBeenCalled();
  const full = await getState('owner');
  const { snapshots, historyRevised, asOf, ...values } = full;
  expect(asOf).toBeTruthy();
  expect(snapshots).toEqual([]);
  expect(historyRevised).toBe(false);
  expect(mocks.tx.portfolioSnapshot.findMany).not.toHaveBeenCalled();
  expect(
    mocks.tx.$queryRaw.mock.calls.some(([sql]) =>
      sql.strings.join('').includes('FROM "PortfolioSnapshot"'),
    ),
  ).toBe(true);
  const { asOf: liveAsOf, ...liveValues } = live;
  expect(liveAsOf).toBeTruthy();
  expect(liveValues).toEqual(values);
});
