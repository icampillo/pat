import 'dotenv/config';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { db } from '../../src/server/db';
import { createUser } from '../../src/server/provision';
import { getState, command } from '../../src/server/portfolio';
import { previewSecurities, confirmSecurities } from '../../src/server/securities-import';
import { syncSecuritiesPrices } from '../../src/server/securities-market';
import { syncMarketData } from '../../src/server/market';
import { importCommand } from '../../src/server/imports';

const url = process.env.DATABASE_URL_TEST;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('Base de test obligatoire');
process.env.DATABASE_URL = url;
beforeAll(() => {
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: process.env,
    stdio: 'pipe',
    windowsHide: true,
  });
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  await db().$disconnect();
});
const owner = () => createUser('Import Bourse test', `${randomUUID()}@example.test`, randomUUID());
const csv =
  'name;isin;quantity;buyingPrice;lastPrice;intradayVariation;amount;amountVariation;variation\nETF de test;FR0011871128;2;10;11;0;21,99;1,98;9,90';
function mockQuotes(price = 12, seconds = Math.floor(Date.now() / 1000) - 60, currency = 'EUR') {
  const fetcher = vi.fn(async (url: string) => {
    if (url.includes('ecb.europa.eu'))
      return new Response(
        `<Cube time='${new Date().toISOString().slice(0, 10)}'><Cube currency='USD' rate='1.25'/></Cube>`,
      );
    if (url.includes('/search?'))
      return Response.json({ quotes: [{ symbol: 'TEST.PA', quoteType: 'ETF' }] });
    return Response.json({
      chart: {
        error: null,
        result: [
          {
            meta: {
              symbol: 'TEST.PA',
              currency,
              instrumentType: 'ETF',
              longName: 'ETF identifié',
              fullExchangeName: 'Paris',
              regularMarketPrice: price,
              regularMarketTime: seconds,
            },
          },
        ],
      },
    });
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

it('imports Bourso atomically with precise cost, live quote, snapshot and no duplicate on retry', async () => {
  const user = await owner();
  mockQuotes();
  const preview = await previewSecurities(
    user.userId,
    { csv, platform: 'BoursoBank PEA' },
    randomUUID(),
  );
  expect(preview.errors).toEqual([]);
  expect((await getState(user.userId)).rows).toHaveLength(0);
  const key = randomUUID();
  const result = await confirmSecurities(user.userId, preview.id, { confirmed: true }, key);
  expect(result).toMatchObject({ created: 1 });
  expect(await confirmSecurities(user.userId, preview.id, { confirmed: true }, key)).toEqual(
    result,
  );
  const state = await getState(user.userId);
  expect(state.rows).toHaveLength(1);
  expect(state.rows[0]).toMatchObject({
    price: '12',
    quantity: '2',
    valueEur: '24',
    category: { label: 'Bourse' },
    metadata: { ticker: 'TEST.PA', pricingMode: 'SECURITIES_MARKET', costBasis: 'KNOWN' },
  });
  expect(Number(state.rows[0].costEur)).toBeCloseTo(20.01, 10);
  expect(state.snapshots).toHaveLength(1);
  await expect(
    previewSecurities(user.userId, { csv, platform: 'BoursoBank PEA' }, randomUUID()),
  ).rejects.toMatchObject({ code: 'IMPORT_DUPLICATE' });
  const again = await previewSecurities(
    user.userId,
    { csv: csv.replace('ETF de test', 'Autre libellé'), platform: 'BoursoBank PEA' },
    randomUUID(),
  );
  expect(again.errors).toEqual([]);
  expect(
    await confirmSecurities(user.userId, again.id, { confirmed: true }, randomUUID()),
  ).toMatchObject({ created: 0, skipped: 1 });
  expect((await getState(user.userId)).transactions).toHaveLength(1);
});
it('preserves unknown cost, fetches FX for USD and blocks manual replacement of automatic prices', async () => {
  const user = await owner();
  mockQuotes(12, undefined, 'USD');
  const preview = await previewSecurities(
    user.userId,
    { csv: 'ticker;quantity\nTEST.PA;2' },
    randomUUID(),
  );
  expect(preview.errors).toEqual([]);
  await confirmSecurities(user.userId, preview.id, { confirmed: true }, randomUUID());
  const state = await getState(user.userId);
  expect(state.rows[0]).toMatchObject({
    valueUsd: '24',
    valueEur: '19.2',
    costEur: null,
    gainEur: null,
  });
  expect(state.fxRate.eurUsd).toBe('1.25');
  await expect(
    command(
      user.userId,
      'POST',
      ['assets', state.rows[0].id, 'prices'],
      { price: '99', observedAt: new Date().toISOString() },
      randomUUID(),
      null,
    ),
  ).rejects.toMatchObject({ code: 'PRICE_AUTOMATIC' });
});
it('rejects wrong import kind, another owner, expired previews and duplicate products', async () => {
  const user = await owner(),
    other = await owner();
  mockQuotes();
  const preview = await previewSecurities(user.userId, { csv }, randomUUID());
  await expect(
    confirmSecurities(other.userId, preview.id, { confirmed: true }, randomUUID()),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(
    importCommand(
      user.userId,
      ['imports', preview.id, 'confirm'],
      { confirmed: true },
      randomUUID(),
    ),
  ).rejects.toMatchObject({ code: 'IMPORT_KIND' });
  await db().importBatch.update({ where: { id: preview.id }, data: { expiresAt: new Date(0) } });
  await expect(
    confirmSecurities(user.userId, preview.id, { confirmed: true }, randomUUID()),
  ).rejects.toMatchObject({ code: 'PREVIEW_STALE' });
  const duplicate = await previewSecurities(
    user.userId,
    { csv: `${csv}\n${csv.split('\n')[1]}` },
    randomUUID(),
  );
  expect(duplicate.errors.some((error) => error.message.includes('plusieurs fois'))).toBe(true);
  await expect(
    confirmSecurities(user.userId, duplicate.id, { confirmed: true }, randomUUID()),
  ).rejects.toMatchObject({ code: 'IMPORT_INVALID' });
  expect((await getState(user.userId)).rows).toHaveLength(0);
});
it('updates prices automatically, deduplicates observations and preserves the last quote on outage', async () => {
  const user = await owner();
  mockQuotes();
  const preview = await previewSecurities(user.userId, { csv }, randomUUID());
  await confirmSecurities(user.userId, preview.id, { confirmed: true }, randomUUID());
  mockQuotes(15, Math.floor(Date.now() / 1000));
  expect(await syncSecuritiesPrices(user.portfolioId)).toMatchObject({ prices: 1, failures: [] });
  expect(await syncSecuritiesPrices(user.portfolioId)).toMatchObject({ prices: 0, failures: [] });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('', { status: 503 })),
  );
  expect((await syncSecuritiesPrices(user.portfolioId)).failures).toHaveLength(1);
  expect((await getState(user.userId)).rows[0]).toMatchObject({
    quantity: '2',
    price: '15',
    valueEur: '30',
  });
});
it('does not block stocks when the metals provider is unavailable', async () => {
  const user = await owner();
  const fetcher = mockQuotes();
  const preview = await previewSecurities(user.userId, { csv }, randomUUID());
  await confirmSecurities(user.userId, preview.id, { confirmed: true }, randomUUID());
  const fn = fetcher.getMockImplementation()!;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.includes('gold-api') ? new Response('', { status: 503 }) : fn(url),
    ),
  );
  expect(await syncMarketData(user.portfolioId)).toMatchObject({
    securities: { failures: [] },
    warning: expect.any(String),
  });
});
