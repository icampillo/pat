import 'dotenv/config';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { db } from '../../src/server/db';
import { createUser } from '../../src/server/provision';
import { command, getState, runSnapshot } from '../../src/server/portfolio';
import { buildCategoryDetails } from '../../src/domain/categories';

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

it('exposes historical category valuations and price performance from stored observations', async () => {
  const owner = await createUser(
    'Catégories test',
    `categories-${randomUUID()}@example.test`,
    randomUUID(),
  );
  const run = (path: string, data: unknown) =>
    command(owner.userId, 'POST', path.split('/'), data, randomUUID(), null);
  const now = Date.now();
  const ago = (days: number) => new Date(now - days * 86400000);
  const initial = await getState(owner.userId);
  const category = initial.categories.find((item: { key: string }) => item.key === 'CRYPTO');
  const asset = (await run('assets', {
    name: 'Actif historique',
    symbol: 'HIST',
    categoryId: category.id,
    currency: 'USD',
    platform: 'Personnel',
    metadata: {},
  })) as { id: string };
  await run('fx-rates', { eurUsd: '2', observedAt: ago(60).toISOString() });
  await run('transactions', {
    assetId: asset.id,
    type: 'BUY',
    quantity: '2',
    unitPrice: '50',
    currency: 'USD',
    platform: 'Personnel',
    occurredAt: ago(50).toISOString(),
    settlement: 'EXTERNAL',
  });
  await run(`assets/${asset.id}/prices`, { price: '100', observedAt: ago(31).toISOString() });
  await runSnapshot(owner.portfolioId, false, ago(31));
  await run('fx-rates', { eurUsd: '1.25', observedAt: ago(2).toISOString() });
  await run(`assets/${asset.id}/prices`, { price: '150', observedAt: ago(1).toISOString() });
  const state = await getState(owner.userId);
  expect(state.snapshots[0].categoryValues[category.id]).toEqual({
    valueEur: '100',
    valueUsd: '200',
  });
  expect(state.snapshots[0].data).toBeUndefined();
  expect(state.rows[0].change30dPercent).toBe(50);
  const details = buildCategoryDetails(state, category, 'EUR');
  expect(details.category).toMatchObject({
    totalValue: 240,
    change30dAbsolute: 140,
    change30dPercent: 140,
    assetCount: 1,
  });
  expect(details.investedCapital).toBe(50);
  expect(details.unrealizedPnL).toBe(190);
  expect(buildCategoryDetails(state, category, 'USD').category.change30dPercent).toBe(50);
});
