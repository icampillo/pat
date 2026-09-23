import 'dotenv/config';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { db } from '../../src/server/db';
import { createUser } from '../../src/server/provision';
import { command, getState, runSnapshot } from '../../src/server/portfolio';
import { exportData } from '../../src/server/exports';
import { parse } from 'csv-parse/sync';

const testUrl = process.env.DATABASE_URL_TEST;
if (!testUrl || !new URL(testUrl).pathname.endsWith('_test'))
  throw new Error('Base de test requise');
process.env.DATABASE_URL = testUrl;
beforeAll(() => {
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: process.env,
    stdio: 'pipe',
    windowsHide: true,
  });
});
afterAll(async () => {
  await db().$disconnect();
});

async function inventory() {
  const owner = await createUser(
    'Inventaire test',
    `inventory-${randomUUID()}@example.test`,
    randomUUID(),
  );
  const category = await db().assetCategory.findFirstOrThrow({
    where: { portfolioId: owner.portfolioId, key: 'METALS' },
  });
  const run = (method: string, path: string, data: unknown) =>
    command(owner.userId, method, path.split('/'), data, randomUUID(), null);
  const asset = (await run('POST', 'assets', {
    name: 'Pièce inventoriée',
    symbol: 'INV',
    categoryId: category.id,
    currency: 'EUR',
    platform: 'Non précisé',
    metadata: { costBasis: 'UNKNOWN', metalType: 'GOLD', weightGrams: '6.4516', purity: '0.9', pricingMode: 'MANUAL' },
  })) as { id: string };
  await run('POST', 'transactions', {
    assetId: asset.id,
    type: 'ADJUSTMENT',
    quantity: '3',
    unitPrice: '0',
    currency: 'EUR',
    platform: 'Non précisé',
    occurredAt: '2026-07-21T00:00:00Z',
    comment: 'Inventaire sans coût fourni',
  });
  await run('POST', `assets/${asset.id}/prices`, {
    price: '600',
    observedAt: '2026-07-21T00:00:00Z',
  });
  return { ...owner, asset, run };
}

it('valorise un inventaire sans transformer un coût absent en zéro ou en gain', async () => {
  const owner = await inventory();
  const state = await getState(owner.userId);
  expect(state.rows.find((a: { id: string }) => a.id === owner.asset.id)).toMatchObject({
    quantity: '3',
    valueEur: '1800',
    costEur: null,
    costUsd: null,
    averagePrice: null,
    gainEur: null,
    gainUsd: null,
  });
  expect(state.totals).toMatchObject({
    valueEur: '1800',
    costEur: null,
    realizedEur: null,
    unrealizedEur: null,
    incompleteCostBasis: true,
    purchasesEur: '0',
  });
  const snapshot = await runSnapshot(owner.portfolioId);
  expect(snapshot!.investedEur).toBeNull();
  const csv = await (await exportData(owner.userId, 'assets.csv')).text();
  const exported = parse(csv, { bom: true, columns: true });
  expect(exported[0]).toMatchObject({
    quantity: '3',
    average_price: '',
    current_price: '600',
    current_value_eur: '1800',
  });
});

it('permet de renseigner ensuite le coût total dans la fiche sans toucher à la quantité', async () => {
  const owner = await inventory();
  const before = await db().asset.findUniqueOrThrow({ where: { id: owner.asset.id } });
  await command(owner.userId, 'PATCH', ['assets', before.id], {
    name: before.name,
    symbol: before.symbol,
    categoryId: before.categoryId,
    currency: before.currency,
    platform: before.platform,
    notes: before.notes,
    subcategory: before.subcategory || '',
    externalId: before.externalId || '',
    metadata: before.metadata,
    status: before.status,
    acquisitionCost: '900',
  }, randomUUID(), String(before.version));
  const state = await getState(owner.userId);
  expect(state.rows.find((a: { id: string }) => a.id === before.id)).toMatchObject({
    quantity: '3', costEur: '900', valueEur: '1800', gainEur: '900',
  });
  expect(await db().transaction.count({ where: { assetId: before.id, voided: false } })).toBe(1);
  expect(await db().transactionRevision.count({ where: { transaction: { assetId: before.id } } })).toBe(2);
});

it('crée une pièce avec quantité et coût total en une seule opération atomique', async () => {
  const owner = await createUser('Nouvelle pièce', `piece-${randomUUID()}@example.test`, randomUUID());
  const category = await db().assetCategory.findFirstOrThrow({
    where: { portfolioId: owner.portfolioId, key: 'METALS' },
  });
  const asset = await command(owner.userId, 'POST', ['assets'], {
    name: '20 francs', symbol: '20 francs', categoryId: category.id,
    currency: 'EUR', platform: 'Personnel',
    metadata: { metalType: 'GOLD', weightGrams: '6.45', purity: '0.9' },
    quantity: '2', acquisitionCost: '1000',
  }, randomUUID(), null) as { id: string };
  const state = await getState(owner.userId);
  expect(state.rows.find((a: { id: string }) => a.id === asset.id)).toMatchObject({
    quantity: '2', costEur: '1000', averagePrice: '500',
    metadata: { pricingMode: 'METAL_MARKET', costBasis: 'KNOWN' },
  });
  expect(await db().transaction.count({ where: { assetId: asset.id } })).toBe(1);
});

it('conserve le résultat réalisé inconnu après la vente d’un inventaire sans coût', async () => {
  const owner = await inventory();
  await owner.run('POST', 'transactions', {
    assetId: owner.asset.id,
    type: 'SELL',
    quantity: '3',
    unitPrice: '650',
    currency: 'EUR',
    platform: 'Non précisé',
    occurredAt: '2026-07-22T00:00:00Z',
    settlement: 'EXTERNAL',
  });
  const state = await getState(owner.userId);
  expect(state.rows[0]).toMatchObject({ quantity: '0', realizedEur: null, averagePrice: null });
  expect(state.totals).toMatchObject({
    costEur: '0',
    realizedEur: null,
    incompleteCostBasis: true,
  });
});
