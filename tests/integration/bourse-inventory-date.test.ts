import 'dotenv/config';
import { configureTestDatabase } from '../database-env';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { db } from '@/server/db';
import { createUser } from '@/server/provision';
import { command } from '@/server/portfolio';
import { getState, runSnapshot } from '@/server/portfolio-query';
import { importCommand, type ImportPreview } from '@/server/imports';
import {
  previewSecurities,
  confirmSecurities,
  correctInventoryDate,
} from '@/server/securities-import';
import { json } from '@/server/portfolio-store';
import { decimal as d } from '@/domain/money';

configureTestDatabase();
beforeAll(() => {
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: process.env,
    stdio: 'pipe',
  });
});
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-09T12:00:00Z'));
  await db().marketQuoteCache.deleteMany({});
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const emerging = url.includes('FR0013412020') || url.includes('PAEEM');
      const symbol = emerging ? 'PAEEM.PA' : 'WPEA.PA';
      return url.includes('/search?')
        ? Response.json({ quotes: [{ symbol, quoteType: 'ETF' }] })
        : Response.json({
            chart: {
              error: null,
              result: [
                {
                  meta: {
                    symbol,
                    currency: 'EUR',
                    instrumentType: 'ETF',
                    longName: 'ETF synthétique',
                    fullExchangeName: 'Paris',
                    regularMarketPrice: emerging ? 37.35 : 7.5,
                    regularMarketTime: Date.now() / 1000 - 60,
                  },
                },
              ],
            },
          });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
afterAll(async () => {
  await db().$disconnect();
});
const owner = () => createUser('Inventaire test', `${randomUUID()}@example.test`, randomUUID());
const asOf = '2026-09-23T15:50:30.000Z',
  platform = 'BoursoBank PEA';
const csv =
  'name;isin;quantity;buyingPrice;lastPrice;intradayVariation;amount;amountVariation;variation\nETF synthétique;IE0002XZSHO1;263;7;7.5;0;1972.5;131.5;0';
async function inventory(userId: string, date = asOf) {
  const preview = await previewSecurities(userId, { csv, platform, asOf: date }, randomUUID());
  expect(preview.errors).toEqual([]);
  await confirmSecurities(userId, preview.id, { confirmed: true }, randomUUID());
  return db().transaction.findFirstOrThrow({
    where: { portfolio: { ownerId: userId }, type: 'ADJUSTMENT' },
  });
}
async function pdf(userId: string, variant = 'world', account = {}) {
  return (await importCommand(
    userId,
    ['imports', 'preview'],
    {
      pdfBase64: readFileSync(`tests/fixtures/bourso-${variant}-anonymous.pdf`).toString('base64'),
      platform,
      ...account,
    },
    randomUUID(),
  )) as ImportPreview;
}
const confirm = (userId: string, id: string, decisions: { line: number; action: string }[] = []) =>
  importCommand(userId, ['imports', id, 'confirm'], { confirmed: true, decisions }, randomUUID());

it('CSV du 23/09 importé le 09/10 puis deux PDF du 07/10 : 293 World, 6 émergents, PRU frais compris et réimport sans écriture', async () => {
  const user = await owner();
  const initial = await inventory(user.userId);
  expect(initial.occurredAt.toISOString()).toBe(asOf);
  expect(initial.createdAt > initial.occurredAt).toBe(true);
  expect(initial.type).toBe('ADJUSTMENT');
  const batch = await db().importBatch.findFirstOrThrow({
    where: { portfolioId: user.portfolioId },
  });
  expect(batch.payload).toMatchObject({ asOf });
  const world = await pdf(user.userId);
  expect(world.errors).toEqual([]);
  expect(world.rows[0]).toMatchObject({
    status: 'NEW',
    positionEffect: 'EXISTING_POSITION',
    candidates: [],
  });
  await confirm(user.userId, world.id);
  const emerging = await pdf(user.userId, 'emerging');
  expect(emerging.errors).toEqual([]);
  expect(emerging.rows[0]).toMatchObject({ status: 'NEW', positionEffect: 'NEW_POSITION' });
  await confirm(user.userId, emerging.id);
  const state = await getState(user.userId);
  const w = state.rows.find(
    (row: { metadata: { isin?: string } }) => row.metadata.isin === 'IE0002XZSHO1',
  );
  expect(w).toMatchObject({ id: initial.assetId, quantity: '293', costEur: '2057.87' });
  expect(d(w.averagePrice).sub(d('2057.87').div(293)).abs().lt('0.000000001')).toBe(true);
  expect(
    state.rows.find((row: { metadata: { isin?: string } }) => row.metadata.isin === 'FR0013412020'),
  ).toMatchObject({
    quantity: '6',
    costEur: '224.1',
    averagePrice: '37.35',
    metadata: { ticker: 'PAEEM.PA', pricingMode: 'SECURITIES_MARKET' },
  });
  expect(await db().transaction.findUnique({ where: { id: initial.id } })).toEqual(initial);
  expect(state.snapshots).toEqual([]);
  const counts = async () =>
    Promise.all([
      db().transaction.count({ where: { portfolioId: user.portfolioId } }),
      db().transactionRevision.count({ where: { transaction: { portfolioId: user.portfolioId } } }),
      db().auditLog.count({ where: { portfolioId: user.portfolioId } }),
      db().importBatch.count({ where: { portfolioId: user.portfolioId } }),
      db().idempotencyRecord.count({ where: { portfolioId: user.portfolioId } }),
    ]);
  const before = await counts();
  for (const variant of ['world', 'emerging']) {
    expect(await pdf(user.userId, variant)).toMatchObject({
      id: 'unchanged',
      summary: { EXISTING: 1, NEW: 0 },
    });
  }
  expect(await counts()).toEqual(before);
  expect((await getState(user.userId)).portfolio.version).toBe(state.portfolio.version);
  await runSnapshot(user.portfolioId);
  const after = await getState(user.userId);
  expect(after.rows).toEqual(state.rows);
  expect(after.snapshots).toHaveLength(1);
});

it('refuse toute date absente ou future, y compris un ancien aperçu non confirmé', async () => {
  const user = await owner();
  await expect(previewSecurities(user.userId, { csv, platform }, randomUUID())).rejects.toThrow();
  await expect(
    previewSecurities(user.userId, { csv, platform, asOf: '2026-10-10T00:00:00Z' }, randomUUID()),
  ).rejects.toThrow();
  const preview = await previewSecurities(user.userId, { csv, platform, asOf }, randomUUID());
  const batch = await db().importBatch.findUniqueOrThrow({ where: { id: preview.id } });
  const old = { ...(batch.payload as Record<string, unknown>) };
  delete old.asOf;
  await db().importBatch.update({ where: { id: batch.id }, data: { payload: json(old) } });
  await expect(
    confirmSecurities(user.userId, batch.id, { confirmed: true }, randomUUID()),
  ).rejects.toThrow();
  expect(await db().transaction.count({ where: { portfolioId: user.portfolioId } })).toBe(0);
});

it.each(['2026-10-08T00:00:00.000Z', '2026-10-07T15:10:02.000Z'])(
  'opération incluse ou exactement à la borne %s : aucun doublon et aucune comparaison ADJUSTMENT → BUY',
  async (date) => {
    const user = await owner();
    const inv = await inventory(user.userId, date);
    const preview = await pdf(user.userId);
    expect(preview.rows[0]).toMatchObject({
      status: 'INVENTORY_REVIEW',
      candidates: [],
      canCreate: false,
      inventories: [{ id: inv.id, asOf: date }],
    });
    await expect(
      confirm(user.userId, preview.id, [{ line: 1, action: 'CREATE' }]),
    ).rejects.toMatchObject({ code: 'IMPORT_DECISION' });
    expect(await confirm(user.userId, preview.id)).toMatchObject({ count: 0, skipped: 1 });
    expect((await getState(user.userId)).rows[0].quantity).toBe('263');
  },
);

it('même référence courtier et même ISIN sur deux comptes : deux positions et idempotence séparée', async () => {
  const user = await owner();
  await inventory(user.userId);
  const pea = await pdf(user.userId);
  await confirm(user.userId, pea.id);
  const cto = await pdf(user.userId, 'world', { platform: 'BoursoBank CTO' });
  expect(cto.rows[0]).toMatchObject({ status: 'NEW', positionEffect: 'NEW_POSITION' });
  await confirm(user.userId, cto.id);
  const state = await getState(user.userId);
  expect(state.rows.map((row: { quantity: string }) => row.quantity).sort()).toEqual(['293', '30']);
  expect((await pdf(user.userId)).summary.EXISTING).toBe(1);
  expect((await pdf(user.userId, 'world', { platform: 'BoursoBank CTO' })).summary.EXISTING).toBe(
    1,
  );
});

it('correction historique contrôlée : aperçu sans écriture, mêmes coûts/FX, révision, snapshots conservés, avis ensuite importable', async () => {
  const user = await owner();
  const inv = await inventory(user.userId, '2026-10-09T00:00:00.000Z');
  await runSnapshot(user.portfolioId);
  const before = await getState(user.userId);
  const input = { asOf, reason: 'Date vérifiée sur le relevé synthétique du 23 septembre' };
  const check = (await correctInventoryDate(user.userId, inv.id, input, randomUUID())) as {
    version: number;
  };
  expect((await getState(user.userId)).portfolio.version).toBe(before.portfolio.version);
  expect(await db().transaction.findUnique({ where: { id: inv.id } })).toEqual(inv);
  const key = randomUUID();
  const confirmInput = { ...input, confirmed: true, version: check.version };
  const result = await correctInventoryDate(user.userId, inv.id, confirmInput, key);
  expect(await correctInventoryDate(user.userId, inv.id, confirmInput, key)).toEqual(result);
  const updated = await db().transaction.findUniqueOrThrow({ where: { id: inv.id } });
  expect(updated).toEqual({ ...inv, occurredAt: new Date(asOf), version: 2 });
  const revisions = await db().transactionRevision.findMany({
    where: { transactionId: inv.id },
    orderBy: { version: 'asc' },
  });
  expect(revisions).toHaveLength(2);
  expect(revisions[0].payload).toMatchObject({ occurredAt: inv.occurredAt.toISOString() });
  expect(revisions[1].payload).toMatchObject({
    occurredAt: asOf,
    createdAt: inv.createdAt.toISOString(),
  });
  const after = await getState(user.userId);
  expect(after.snapshots).toEqual(before.snapshots);
  expect(after.rows).toEqual(before.rows);
  expect(after.historyRevised).toBe(true);
  const notice = await pdf(user.userId);
  expect(notice.rows[0].status).toBe('NEW');
  await confirm(user.userId, notice.id);
  expect((await getState(user.userId)).rows[0].quantity).toBe('293');
  expect((await getState(user.userId)).snapshots).toEqual(before.snapshots);
});

it('correction refusée pour un autre propriétaire, un achat réel, un aperçu périmé ou un franchissement d’opération', async () => {
  const user = await owner(),
    other = await owner();
  const inv = await inventory(user.userId);
  const input = { asOf: '2026-09-22T00:00:00.000Z', reason: 'Vérification synthétique' };
  await expect(
    correctInventoryDate(other.userId, inv.id, input, randomUUID()),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  const check = (await correctInventoryDate(user.userId, inv.id, input, randomUUID())) as {
    version: number;
  };
  const preview = await pdf(user.userId);
  await expect(
    correctInventoryDate(
      user.userId,
      inv.id,
      { ...input, confirmed: true, version: check.version },
      randomUUID(),
    ),
  ).rejects.toMatchObject({ code: 'PREVIEW_STALE' });
  await confirm(user.userId, preview.id);
  await expect(
    correctInventoryDate(
      user.userId,
      inv.id,
      { ...input, asOf: '2026-10-08T00:00:00Z' },
      randomUUID(),
    ),
  ).rejects.toMatchObject({ code: 'INVENTORY_OVERLAP' });
  const buy = await db().transaction.findFirstOrThrow({
    where: { portfolioId: user.portfolioId, type: 'BUY' },
  });
  await expect(
    correctInventoryDate(user.userId, buy.id, input, randomUUID()),
  ).rejects.toMatchObject({ code: 'IMPORT_KIND' });
  const before = await getState(user.userId);
  await expect(
    command(user.userId, 'PATCH', ['transactions', inv.id], {}, randomUUID(), '1'),
  ).rejects.toMatchObject({ code: 'INVENTORY_CORRECTION' });
  expect((await getState(user.userId)).transactions).toEqual(before.transactions);
});

it.each(['0', '1.08'])(
  'vente postérieure avec frais %s : PRU conservé, réalisé exact, snapshot intact',
  async (fees) => {
    const user = await owner();
    const inv = await inventory(user.userId);
    await runSnapshot(user.portfolioId);
    const before = await getState(user.userId);
    const preview = (await importCommand(
      user.userId,
      ['imports', 'preview'],
      {
        csv:
          'asset_id;type;quantity;unit_price;amount;fees;currency;occurred_at;platform;external_reference\n' +
          [
            inv.assetId,
            'SELL',
            '30',
            '7.193',
            '215.79',
            fees,
            'EUR',
            '2026-10-07T15:10:02Z',
            platform,
            'sale-' + fees,
          ].join(';'),
      },
      randomUUID(),
    )) as ImportPreview;
    expect(preview.errors).toEqual([]);
    expect(preview.rows[0].status).toBe('NEW');
    await confirm(user.userId, preview.id);
    const after = await getState(user.userId);
    expect(after.rows[0]).toMatchObject({
      quantity: '233',
      costEur: '1631',
      averagePrice: '7',
      realizedEur: d('5.79').sub(fees).toString(),
    });
    expect(after.snapshots).toEqual(before.snapshots);
  },
);

it('un ancien lot CSV déjà confirmé reste idempotent même sans asOf dans son payload', async () => {
  const user = await owner();
  await inventory(user.userId);
  const batch = await db().importBatch.findFirstOrThrow({
    where: { portfolioId: user.portfolioId },
  });
  const old = { ...(batch.payload as Record<string, unknown>) };
  delete old.asOf;
  await db().importBatch.update({ where: { id: batch.id }, data: { payload: json(old) } });
  const before = await getState(user.userId);
  expect(
    await confirmSecurities(user.userId, batch.id, { confirmed: true }, randomUUID()),
  ).toMatchObject({ created: 1 });
  expect((await getState(user.userId)).portfolio.version).toBe(before.portfolio.version);
  expect((await getState(user.userId)).transactions).toEqual(before.transactions);
});
