import 'dotenv/config';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { db } from '../../src/server/db';
import { createUser } from '../../src/server/provision';
import { command, getState } from '../../src/server/portfolio';
import { syncMarketData } from '../../src/server/market';

const testUrl = process.env.DATABASE_URL_TEST;
if (!testUrl || !new URL(testUrl).pathname.endsWith('_test')) throw new Error('Base de test requise');
process.env.DATABASE_URL = testUrl;
beforeAll(() => {
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: process.env, stdio: 'pipe', windowsHide: true,
  });
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => { await db().$disconnect(); });

it('enregistre le taux BCE et la valeur spot des pièces sans modifier leur quantité', async () => {
  const owner = await createUser('Marché test', `market-${randomUUID()}@example.test`, randomUUID());
  const category = await db().assetCategory.findFirstOrThrow({
    where: { portfolioId: owner.portfolioId, key: 'METALS' },
  });
  const asset = await command(owner.userId, 'POST', ['assets'], {
    name: 'Pièce or', symbol: 'OR', categoryId: category.id, currency: 'EUR',
    platform: 'Personnel', metadata: { metalType: 'GOLD', weightGrams: '6.45', purity: '0.9', pricingMode: 'METAL_MARKET' },
  }, randomUUID(), null) as { id: string };
  await command(owner.userId, 'POST', ['transactions'], {
    assetId: asset.id, type: 'ADJUSTMENT', quantity: '2', currency: 'EUR',
    platform: 'Personnel', occurredAt: new Date().toISOString(), comment: 'Inventaire test',
  }, randomUUID(), null);

  const today = new Date().toISOString().slice(0, 10);
  const updatedAt = new Date().toISOString();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('ecb.europa.eu')) return new Response(`<Cube time='${today}'><Cube currency='USD' rate='1'/></Cube>`);
    const symbol = url.endsWith('XAU') ? 'XAU' : 'XAG';
    return Response.json({ symbol, currency: 'USD', price: symbol === 'XAU' ? 3110.34768 : 31.1034768, updatedAt });
  }));
  expect(await syncMarketData(owner.portfolioId)).toMatchObject({ rates: 1, prices: 1 });
  expect(await syncMarketData(owner.portfolioId)).toMatchObject({ rates: 0, prices: 0 });
  const state = await getState(owner.userId);
  expect(state.fxRate).toMatchObject({ eurUsd: '1', source: 'ecb' });
  expect(state.rows.find((row: { id: string }) => row.id === asset.id)).toMatchObject({
    quantity: '2', price: '580.5', valueEur: '1161',
  });
});
