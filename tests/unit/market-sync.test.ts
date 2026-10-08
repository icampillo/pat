import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  existingFx: vi.fn(),
  portfolios: vi.fn(),
  transaction: vi.fn(),
  securitySync: vi.fn(),
  provider: vi.fn(),
  lock: vi.fn(),
  rateFind: vi.fn(),
  rateCreate: vi.fn(),
  assetFind: vi.fn(),
  priceFind: vi.fn(),
  priceCreate: vi.fn(),
}));
vi.mock('@/server/db', () => ({
  db: () => ({
    portfolio: { findMany: mocks.portfolios },
    fxRate: { findFirst: mocks.existingFx },
    $transaction: mocks.transaction,
  }),
}));
vi.mock('@/server/securities-market', () => ({ syncSecuritiesPrices: mocks.securitySync }));
vi.mock('@/server/provider-fetch', () => ({ providerFetch: mocks.provider }));
import { ensurePortfolioFxRate, syncMarketData } from '@/server/market';
const metadata = {
  pricingMode: 'METAL_MARKET',
  metalType: 'GOLD',
  weightGrams: '6.45',
  purity: '0.9',
};
const asset = { id: 'gold', currency: 'EUR', metadata, prices: [] };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.portfolios.mockResolvedValue([{ id: 'owner', rates: [], assets: [asset] }]);
  mocks.securitySync.mockResolvedValue({ prices: 0, failures: [], hasMore: false });
  mocks.transaction.mockImplementation(async (run) =>
    run({
      $queryRaw: mocks.lock,
      fxRate: { findFirst: mocks.rateFind, create: mocks.rateCreate },
      asset: { findFirst: mocks.assetFind },
      priceHistory: { findFirst: mocks.priceFind, create: mocks.priceCreate },
    }),
  );
  mocks.assetFind.mockResolvedValue(asset);
  mocks.priceFind.mockResolvedValue(null);
  mocks.rateFind.mockResolvedValue(null);
  mocks.provider.mockImplementation(async (url) =>
    url.includes('ecb')
      ? new Response(
          `<Cube time='${new Date().toISOString().slice(0, 10)}'><Cube currency='USD' rate='1'/></Cube>`,
        )
      : Response.json({
          symbol: 'XAU',
          currency: 'USD',
          price: 3110.34768,
          updatedAt: new Date().toISOString(),
        }),
  );
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
it('locks short database writes, fetches only needed metals, and avoids duplicate observations', async () => {
  expect(await syncMarketData('owner')).toMatchObject({ rates: 1, prices: 1, failed: 0 });
  expect(mocks.provider).toHaveBeenCalledTimes(2);
  expect(mocks.lock).toHaveBeenCalledOnce();
  expect(mocks.priceCreate).toHaveBeenCalledWith({
    data: expect.objectContaining({ price: '580.5', portfolioId: 'owner' }),
  });
  mocks.priceFind.mockResolvedValue({ observedAt: new Date(Date.now() + 1000) });
  mocks.rateFind.mockResolvedValue({ id: 'rate' });
  expect(await syncMarketData('owner')).toMatchObject({ rates: 0, prices: 0 });
  expect(mocks.priceCreate).toHaveBeenCalledOnce();
});
it('preserves historical prices on provider failure while still writing the available FX rate', async () => {
  mocks.provider.mockImplementation(async (url) => {
    if (!url.includes('ecb')) throw new Error('private-token');
    return new Response(
      `<Cube time='${new Date().toISOString().slice(0, 10)}'><Cube currency='USD' rate='1'/></Cube>`,
    );
  });
  expect(await syncMarketData('owner')).toMatchObject({ rates: 1, prices: 0, failed: 1 });
  expect(mocks.priceCreate).not.toHaveBeenCalled();
  expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('private-token');
});
it('skips external reads for recent prices and today’s persisted ECB fixing', async () => {
  mocks.portfolios.mockResolvedValue([
    {
      id: 'owner',
      rates: [
        { source: 'ecb', eurUsd: '1', observedAt: new Date(new Date().toISOString().slice(0, 10)) },
      ],
      assets: [{ ...asset, prices: [{ source: 'gold-api:GOLD:ecb', createdAt: new Date() }] }],
    },
  ]);
  await syncMarketData('owner');
  expect(mocks.provider).not.toHaveBeenCalled();
  expect(mocks.priceCreate).not.toHaveBeenCalled();
});
it('isolates an unavailable metals provider from the securities service', async () => {
  mocks.provider.mockRejectedValue(new Error('private URL'));
  mocks.securitySync.mockResolvedValue({ prices: 2, failures: [], hasMore: false });
  expect(await syncMarketData('owner')).toMatchObject({
    prices: 0,
    securities: { prices: 2 },
    failed: 1,
  });
  expect(mocks.transaction).not.toHaveBeenCalled();
});

it('bootstraps the ECB rate for a fresh wallet-only portfolio without fetching asset prices', async () => {
  await ensurePortfolioFxRate('owner');
  expect(mocks.provider).toHaveBeenCalledTimes(1);
  expect(mocks.provider.mock.calls[0][0]).toContain('ecb.europa.eu');
  expect(mocks.lock).toHaveBeenCalledOnce();
  expect(mocks.rateCreate).toHaveBeenCalledWith({
    data: expect.objectContaining({ portfolioId: 'owner', eurUsd: '1', source: 'ecb' }),
  });
  expect(mocks.securitySync).not.toHaveBeenCalled();
});
it('preserves existing FX rates and rechecks under the portfolio lock to avoid duplicate inserts', async () => {
  mocks.existingFx.mockResolvedValueOnce({ eurUsd: '1.2', source: 'manual' });
  await ensurePortfolioFxRate('owner');
  expect(mocks.provider).not.toHaveBeenCalled();
  mocks.rateFind.mockResolvedValueOnce({ eurUsd: '1.2' });
  await ensurePortfolioFxRate('owner');
  expect(mocks.lock).toHaveBeenCalledOnce();
  expect(mocks.rateCreate).not.toHaveBeenCalled();
});
