import 'dotenv/config';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { db } from '../../src/server/db';
import { createUser } from '../../src/server/provision';
import { command, getState, runSnapshot, valuation } from '../../src/server/portfolio';
import { buildCategoryDetails } from '../../src/domain/categories';
import { realEstateAt } from '../../src/domain/real-estate';
import { property, loan } from '../fixtures/real-estate';

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
async function setup() {
  const owner = await createUser(
    'Immobilier test',
    `estate-${randomUUID()}@example.test`,
    randomUUID(),
  );
  const category = await db().assetCategory.findFirstOrThrow({
    where: { portfolioId: owner.portfolioId, key: 'REAL_ESTATE' },
  });
  const input = {
    name: 'Appartement test',
    symbol: 'APPART',
    categoryId: category.id,
    currency: 'EUR',
    platform: 'Personnel',
    metadata: { realEstate: { ...property, mortgage: loan } },
  };
  const key = randomUUID();
  const asset = (await command(owner.userId, 'POST', ['assets'], input, key, null)) as {
    id: string;
    version: number;
  };
  return { ...owner, category, input, asset, key };
}
it('captures dated equity immutably, without generating ledger transactions or market gains', async () => {
  const owner = await setup();
  expect(await db().transaction.count({ where: { portfolioId: owner.portfolioId } })).toBe(0);
  const firstDate = new Date('2020-01-31'),
    secondDate = new Date('2021-01-31');
  const first = await runSnapshot(owner.portfolioId, false, firstDate);
  const before = JSON.stringify(first);
  const second = await runSnapshot(owner.portfolioId, false, secondDate);
  expect(String(first!.totalEur)).toBe('100000');
  expect(String(second!.totalEur)).toBe(
    realEstateAt(owner.input.metadata.realEstate, secondDate).equity,
  );
  expect(String(second!.totalEur)).not.toBe(String(first!.totalEur));
  const state = await getState(owner.userId);
  expect(state.snapshots[0].categoryValues[owner.category.id].valueEur).toBe('100000');
  expect(state.snapshots[1].categoryValues[owner.category.id].valueEur).toBe(
    String(second!.totalEur),
  );
  expect(state.totals.unrealizedEur).toBeNull();
  expect(state.rows[0].gainEur).toBeNull();
  expect(buildCategoryDetails(state, owner.category, 'EUR').category.realEstate?.grossValue).toBe(
    300000,
  );
  await command(
    owner.userId,
    'PATCH',
    ['assets', owner.asset.id],
    {
      ...owner.input,
      metadata: {
        realEstate: {
          ...owner.input.metadata.realEstate,
          currentValue: '350000',
          valuationDate: '2022-01-01',
        },
      },
    },
    randomUUID(),
    '1',
  );
  expect(
    JSON.stringify(await db().portfolioSnapshot.findUnique({ where: { id: first!.id } })),
  ).toBe(before);
  const historical = await valuation(db(), owner.portfolioId, firstDate);
  expect(historical.rows[0].valueEur).toBe('100000');
  expect((await valuation(db(), owner.portfolioId, new Date('2019-12-31'))).totals.valueEur).toBe(
    '0',
  );
});
it('preserves idempotence, version checks, ownership and separation from the generic ledger', async () => {
  const owner = await setup();
  const other = await setup();
  expect(await command(owner.userId, 'POST', ['assets'], owner.input, owner.key, null)).toEqual(
    owner.asset,
  );
  expect(await db().asset.count({ where: { portfolioId: owner.portfolioId } })).toBe(1);
  await expect(
    command(other.userId, 'PATCH', ['assets', owner.asset.id], owner.input, randomUUID(), '1'),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(
    command(owner.userId, 'PATCH', ['assets', owner.asset.id], owner.input, randomUUID(), '99'),
  ).rejects.toMatchObject({ code: 'STALE_VERSION' });
  await expect(
    command(
      owner.userId,
      'POST',
      ['transactions'],
      {
        assetId: owner.asset.id,
        type: 'BUY',
        quantity: '1',
        unitPrice: '300000',
        currency: 'EUR',
        platform: 'Personnel',
        occurredAt: new Date().toISOString(),
      },
      randomUUID(),
      null,
    ),
  ).rejects.toMatchObject({ code: 'REAL_ESTATE_LEDGER' });
  await expect(
    command(
      owner.userId,
      'POST',
      ['assets'],
      { ...owner.input, quantity: '1' },
      randomUUID(),
      null,
    ),
  ).rejects.toMatchObject({ code: 'REAL_ESTATE_LEDGER' });
  await expect(
    command(owner.userId, 'POST', ['assets'], { ...owner.input, metadata: {} }, randomUUID(), null),
  ).rejects.toMatchObject({ code: 'REAL_ESTATE_METADATA' });
  const category = await db().assetCategory.findFirstOrThrow({
    where: { portfolioId: owner.portfolioId, key: 'CRYPTO' },
  });
  await expect(
    command(
      owner.userId,
      'PATCH',
      ['assets', owner.asset.id],
      { ...owner.input, categoryId: category.id, metadata: {} },
      randomUUID(),
      '1',
    ),
  ).rejects.toMatchObject({ code: 'CATEGORY_LOCKED' });
});
it('preserves unknown prices, handles FX and zero values, and archives without deleting history', async () => {
  const owner = await setup();
  await command(
    owner.userId,
    'PATCH',
    ['assets', owner.asset.id],
    {
      ...owner.input,
      metadata: { realEstate: { ...property, currentValue: null, valuationDate: null } },
    },
    randomUUID(),
    '1',
  );
  let state = await getState(owner.userId);
  expect(state.rows[0].valueEur).toBeNull();
  expect(state.totals.valueEur).toBeNull();
  expect(buildCategoryDetails(state, owner.category, 'EUR').category.totalValue).toBeNull();
  await command(
    owner.userId,
    'PATCH',
    ['assets', owner.asset.id],
    {
      ...owner.input,
      metadata: { realEstate: { ...property, currentValue: '0', ownershipPercent: '50' } },
    },
    randomUUID(),
    '2',
  );
  state = await getState(owner.userId);
  expect(state.rows[0].valueEur).toBe('0');
  expect(state.rows[0].valueUsd).toBe('0');
  await command(
    owner.userId,
    'PATCH',
    ['assets', owner.asset.id],
    {
      ...owner.input,
      metadata: {
        realEstate: {
          ...property,
          currentValue: '400000',
          ownershipPercent: '50',
          mortgage: { ...loan, borrowedAmount: '120000' },
        },
      },
    },
    randomUUID(),
    '3',
  );
  const past = await valuation(db(), owner.portfolioId, new Date('2020-01-31'));
  expect(past.rows[0].valueEur).toBe('80000');
  expect(past.rows[0].valueUsd).toBeNull();
  await command(
    owner.userId,
    'POST',
    ['fx-rates'],
    { eurUsd: '1.25', observedAt: '2020-01-01T00:00:00Z' },
    randomUUID(),
    null,
  );
  expect((await valuation(db(), owner.portfolioId, new Date('2020-01-31'))).rows[0].valueUsd).toBe(
    '100000',
  );
  const snapshot = await runSnapshot(owner.portfolioId);
  await command(
    owner.userId,
    'DELETE',
    ['assets', owner.asset.id],
    { confirmed: true },
    randomUUID(),
    '4',
  );
  expect((await getState(owner.userId)).totals.valueEur).toBe('0');
  expect(await db().portfolioSnapshot.findUnique({ where: { id: snapshot!.id } })).not.toBeNull();
});
it('backfills existing portfolios idempotently without altering other categories', async () => {
  const owner = await createUser(
    'Migration test',
    `migration-${randomUUID()}@example.test`,
    randomUUID(),
  );
  await db().assetCategory.deleteMany({
    where: { portfolioId: owner.portfolioId, key: 'REAL_ESTATE' },
  });
  const before = await db().assetCategory.findMany({
    where: { portfolioId: owner.portfolioId },
    orderBy: { id: 'asc' },
  });
  const sql = readFileSync('prisma/migrations/20260926090000_real_estate/migration.sql', 'utf8');
  await db().$executeRawUnsafe(sql);
  await db().$executeRawUnsafe(sql);
  expect(
    await db().assetCategory.count({
      where: { portfolioId: owner.portfolioId, key: 'REAL_ESTATE' },
    }),
  ).toBe(1);
  expect(
    await db().assetCategory.findMany({
      where: { portfolioId: owner.portfolioId, key: { not: 'REAL_ESTATE' } },
      orderBy: { id: 'asc' },
    }),
  ).toEqual(before);
});
