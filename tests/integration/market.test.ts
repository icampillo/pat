import 'dotenv/config';
import { configureTestDatabase } from '../database-env';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { db } from '../../src/server/db';
import { createUser } from '../../src/server/provision';
import { command } from '../../src/server/portfolio';
import { getState } from '../../src/server/portfolio-query';
import { syncMarketData } from '../../src/server/market';

configureTestDatabase();
beforeAll(() => {
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: process.env,
    stdio: 'pipe',
    windowsHide: true,
  });
});
beforeEach(async () => {
  await db().marketQuoteCache.deleteMany({});
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  await db().$disconnect();
});

it('enregistre le taux BCE et la valeur spot des pièces sans modifier leur quantité', async () => {
  const owner = await createUser(
    'Marché test',
    `market-${randomUUID()}@example.test`,
    randomUUID(),
  );
  const category = await db().assetCategory.findFirstOrThrow({
    where: { portfolioId: owner.portfolioId, key: 'METALS' },
  });
  const asset = (await command(
    owner.userId,
    'POST',
    ['assets'],
    {
      name: 'Pièce or',
      symbol: 'OR',
      categoryId: category.id,
      currency: 'EUR',
      platform: 'Personnel',
      metadata: {
        metalType: 'GOLD',
        weightGrams: '6.45',
        purity: '0.9',
        pricingMode: 'METAL_MARKET',
      },
    },
    randomUUID(),
    null,
  )) as { id: string };
  await command(
    owner.userId,
    'POST',
    ['transactions'],
    {
      assetId: asset.id,
      type: 'ADJUSTMENT',
      quantity: '2',
      currency: 'EUR',
      platform: 'Personnel',
      occurredAt: new Date().toISOString(),
      comment: 'Inventaire test',
    },
    randomUUID(),
    null,
  );

  const today = new Date().toISOString().slice(0, 10);
  const updatedAt = new Date().toISOString();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('ecb.europa.eu'))
        return new Response(`<Cube time='${today}'><Cube currency='USD' rate='1'/></Cube>`);
      const symbol = url.endsWith('XAU') ? 'XAU' : 'XAG';
      return Response.json({
        symbol,
        currency: 'USD',
        price: symbol === 'XAU' ? 3110.34768 : 31.1034768,
        updatedAt,
      });
    }),
  );
  expect(await syncMarketData(owner.portfolioId)).toMatchObject({ rates: 1, prices: 1 });
  expect(await syncMarketData(owner.portfolioId)).toMatchObject({ rates: 0, prices: 0 });
  const state = await getState(owner.userId);
  expect(state.fxRate).toMatchObject({ eurUsd: '1', source: 'ecb' });
  expect(state.rows.find((row: { id: string }) => row.id === asset.id)).toMatchObject({
    quantity: '2',
    price: '580.5',
    valueEur: '1161',
  });
});

it('shares quotes across opening, manual and cron syncs for different owners without snapshots', async () => {
  const owners = await Promise.all(
    [1, 2].map(() => createUser('Concurrent market', `${randomUUID()}@example.test`, randomUUID())),
  );
  for (const owner of owners) {
    for (const symbol of ['GOLD', 'SILVER', 'TEST.PA', 'STOCK']) {
      const metal = ['GOLD', 'SILVER'].includes(symbol);
      const category = await db().assetCategory.findFirstOrThrow({
        where: { portfolioId: owner.portfolioId, key: metal ? 'METALS' : 'SECURITIES' },
      });
      const asset = await db().asset.create({
        data: {
          portfolioId: owner.portfolioId,
          categoryId: category.id,
          name: symbol,
          symbol,
          currency: 'EUR',
          metadata: metal
            ? {
                pricingMode: 'METAL_MARKET',
                metalType: symbol,
                weightGrams: '31.1034768',
                purity: '1',
              }
            : { pricingMode: 'SECURITIES_MARKET', ticker: symbol },
        },
      });
      await command(
        owner.userId,
        'POST',
        ['transactions'],
        {
          assetId: asset.id,
          type: 'ADJUSTMENT',
          quantity: '1',
          currency: 'EUR',
          platform: 'Test',
          occurredAt: new Date().toISOString(),
          comment: 'Concurrent sync fixture',
        },
        randomUUID(),
        null,
      );
    }
  }
  const observedAt = new Date().toISOString();
  // The unscoped cron reuses today's ECB fixing from any portfolio. Earlier tests
  // seed different synthetic fixings; align those with this test's provider response.
  await db().fxRate.updateMany({
    where: { source: 'ecb', observedAt: new Date(observedAt.slice(0, 10)) },
    data: { eurUsd: '1' },
  });
  const fetcher = vi.fn(async (url: string) => {
    if (url.includes('ecb.europa.eu'))
      return new Response(
        `<Cube time='${observedAt.slice(0, 10)}'><Cube currency='USD' rate='1'/></Cube>`,
      );
    if (url.includes('gold-api'))
      return Response.json({
        symbol: url.endsWith('XAU') ? 'XAU' : 'XAG',
        currency: 'USD',
        price: 100,
        updatedAt: observedAt,
      });
    const symbol = url.includes('STOCK') ? 'STOCK' : 'TEST.PA';
    return Response.json({
      chart: {
        result: [
          {
            meta: {
              symbol,
              currency: 'EUR',
              instrumentType: symbol === 'STOCK' ? 'EQUITY' : 'ETF',
              regularMarketPrice: 100,
              regularMarketTime: Math.floor(Date.parse(observedAt) / 1000),
            },
          },
        ],
      },
    });
  });
  vi.stubGlobal('fetch', fetcher);
  // Unscoped invocation is the existing cron's exact service path.
  const results = await Promise.all([
    syncMarketData(owners[0].portfolioId),
    syncMarketData(owners[0].portfolioId),
    syncMarketData(owners[1].portfolioId),
    syncMarketData(),
  ]);
  // Other integration fixtures may have unsupported quotes in the unscoped cron.
  expect(results.slice(0, 3).map((result) => result.failed)).toEqual([0, 0, 0]);
  expect(fetcher.mock.calls.filter(([url]) => url.includes('ecb.europa.eu'))).toHaveLength(1);
  expect(fetcher.mock.calls.filter(([url]) => url.endsWith('XAU'))).toHaveLength(1);
  expect(fetcher.mock.calls.filter(([url]) => url.endsWith('XAG'))).toHaveLength(1);
  for (const ticker of ['TEST.PA', 'STOCK'])
    expect(fetcher.mock.calls.filter(([url]) => url.includes(`/chart/${ticker}?`))).toHaveLength(1);
  for (const owner of owners) {
    const state = await getState(owner.userId);
    for (const row of state.rows) expect(Number(row.price)).toBeCloseTo(100, 10);
    expect(Number(state.totals.valueEur)).toBeCloseTo(400, 10);
    expect(state.snapshots).toHaveLength(0);
    expect(await db().priceHistory.count({ where: { portfolioId: owner.portfolioId } })).toBe(4);
  }
  const before = await getState(owners[0].userId);
  await db().marketQuoteCache.updateMany({ data: { lastAttemptAt: new Date(0) } });
  const unavailable = vi.fn(async () => new Response('', { status: 400 }));
  vi.stubGlobal('fetch', unavailable);
  expect((await syncMarketData(owners[0].portfolioId)).failed).toBe(4);
  const attempts = unavailable.mock.calls.length;
  expect((await syncMarketData(owners[0].portfolioId)).failed).toBe(4);
  expect(unavailable).toHaveBeenCalledTimes(attempts);
  const after = await getState(owners[0].userId);
  expect(after.rows).toEqual(before.rows);
  expect(after.fxRate).toEqual(before.fxRate);
  expect(after.snapshots).toEqual(before.snapshots);
});
