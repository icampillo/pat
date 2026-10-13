import 'dotenv/config';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { configureTestDatabase } from '../database-env';
import { db } from '@/server/db';
import { Prisma } from '@/generated/prisma/client';
import { createUser } from '@/server/provision';
import { getState, runSnapshot } from '@/server/portfolio-query';
import { getPageState } from '@/server/page-state';
import { backfillSnapshotSummaries } from '@/server/snapshot-history';
import { snapshotCategoryValues } from '@/domain/categories';
import { snapshotCashValues } from '@/domain/dashboard';
import { assetPrices, walletHistory } from '@/server/detail-history';
import { exportData } from '@/server/exports';
configureTestDatabase();
beforeAll(() =>
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: process.env,
    stdio: 'pipe',
  }),
);
afterAll(async () => {
  await db().$disconnect();
});
const owner = () =>
  createUser('History test', `history-${randomUUID()}@example.test`, randomUUID());

it('reads legacy projections, resumes an additive backfill and preserves originals/exports after category changes', async () => {
  const user = await owner();
  const outsider = await owner();
  const categories = await db().assetCategory.findMany({
    where: { portfolioId: user.portfolioId },
  });
  const crypto = categories.find((c) => c.key === 'CRYPTO')!;
  const saved = {
    rows: [
      {
        id: randomUUID(),
        categoryId: crypto.id,
        category: { key: 'CRYPTO' },
        quantity: '1',
        valueEur: '40',
        valueUsd: '50',
        metadata: { large: 'x'.repeat(10000) },
      },
      {
        categoryId: randomUUID(),
        category: { key: 'POKEMON' },
        quantity: '1',
        valueEur: null,
        valueUsd: '10',
      },
    ],
    cash: [{ valueEur: '8', valueUsd: '10' }],
    onchain: {
      includedCount: 1,
      valueEur: '16',
      valueUsd: '20',
      wallets: [{ data: { large: 'x'.repeat(20000) } }],
    },
  };
  const snapshot = await db().portfolioSnapshot.create({
    data: {
      portfolioId: user.portfolioId,
      referenceOwnerId: user.userId,
      referenceDay: '2020-01-01',
      capturedAt: new Date('2020-01-01T10:00:00Z'),
      kind: 'DAILY',
      ledgerVersion: 1,
      totalEur: null,
      totalUsd: '90',
      investedEur: '10',
      netFlowsEur: '10',
      data: saved,
    },
  });
  const before = await getState(user.userId);
  expect(before.snapshots[0].categoryValues).toEqual(snapshotCategoryValues(saved, categories));
  expect(before.snapshots[0].cashValues).toEqual(snapshotCashValues(saved));
  expect(before.snapshots[0]).not.toHaveProperty('data');
  expect((await getState(outsider.userId)).snapshots).toEqual([]);
  while (await backfillSnapshotSummaries(db(), 2)) {
    /* bounded batches on isolated test database */
  }
  expect(await backfillSnapshotSummaries(db(), 2)).toBe(0);
  const after = await getState(user.userId);
  expect(after.snapshots).toEqual(before.snapshots);
  const stored = await db().portfolioSnapshot.findUniqueOrThrow({ where: { id: snapshot.id } });
  expect(stored.data).toEqual(saved);
  expect(stored.summary).not.toBeNull();
  expect({ ...stored, summary: null }).toEqual(snapshot);
  await db().assetCategory.update({ where: { id: crypto.id }, data: { label: 'Renamed' } });
  await db().fxRate.create({
    data: { portfolioId: user.portfolioId, eurUsd: '99', observedAt: new Date(), source: 'test' },
  });
  expect((await getState(user.userId)).snapshots).toEqual(before.snapshots);
  const otherCategory = categories.find((c) => c.key === 'OTHER')!;
  const currentAsset = await db().asset.create({
    data: {
      portfolioId: user.portfolioId,
      categoryId: crypto.id,
      name: 'Changed composition',
      symbol: 'CHANGE',
      currency: 'EUR',
    },
  });
  await db().asset.update({
    where: { id: currentAsset.id },
    data: { categoryId: otherCategory.id },
  });
  expect((await getState(user.userId)).snapshots).toEqual(before.snapshots);
  const exported = JSON.parse(await (await exportData(user.userId, 'portfolio.json')).text());
  expect(exported.snapshots[0].data).toEqual(saved);
  expect(await (await exportData(user.userId, 'history.csv')).text()).toContain('detail_json');
});
it('writes the summary atomically with a daily capture and leaves duplicate captures unchanged', async () => {
  const user = await owner();
  const capture = await runSnapshot(user.portfolioId);
  expect(capture?.summary).toMatchObject({
    version: 1,
    groups: [],
    cashValues: { valueEur: '0', valueUsd: '0' },
  });
  expect(await runSnapshot(user.portfolioId)).toEqual(capture);
});
it('scoped pages omit unrelated data while sharing the same portfolio, FX and wallet state', async () => {
  const user = await owner();
  const full = await getState(user.userId);
  for (const scope of ['settings', 'wallets'] as const) {
    const page = await getPageState(user.userId, scope);
    expect(page.portfolio).toEqual(full.portfolio);
    expect(page.fxRate).toEqual(full.fxRate);
    expect(page.onchain.config).toEqual(full.onchain.config);
    for (const field of ['totals', 'transactions', 'snapshots', 'rows', 'flows'])
      expect(page).not.toHaveProperty(field);
  }
});
it('paginates exact asset prices without losing same-date observations or leaking other owners', async () => {
  const user = await owner();
  const other = await owner();
  const category = await db().assetCategory.findFirstOrThrow({
    where: { portfolioId: user.portfolioId },
  });
  const asset = await db().asset.create({
    data: {
      portfolioId: user.portfolioId,
      categoryId: category.id,
      name: 'History',
      symbol: 'HIST',
      currency: 'EUR',
    },
  });
  await db().priceHistory.createMany({
    data: Array.from({ length: 123 }, (_, i) => ({
      portfolioId: user.portfolioId,
      assetId: asset.id,
      price: String(i + 1),
      currency: 'EUR',
      observedAt: new Date('2020-01-01'),
      source: 'test',
    })),
  });
  let cursor: string | null = null;
  const ids: string[] = [];
  do {
    const page = await assetPrices(user.userId, asset.id, cursor);
    expect(page.items.length).toBeLessThanOrEqual(50);
    ids.push(...page.items.map((p: { id: string }) => p.id));
    cursor = page.nextCursor;
  } while (cursor);
  expect(ids).toHaveLength(123);
  expect(new Set(ids).size).toBe(123);
  await expect(assetPrices(other.userId, asset.id, null)).rejects.toMatchObject({ status: 404 });
  await expect(assetPrices(user.userId, asset.id, 'invalid')).rejects.toMatchObject({
    status: 400,
  });
});
it('returns actual daily wallet observations, excludes invalidated data and enforces ownership', async () => {
  const user = await owner();
  const other = await owner();
  const wallet = await db().walletConnection.create({
    data: {
      portfolioId: user.portfolioId,
      address: `0x${randomUUID().replaceAll('-', '').padEnd(40, '0')}`,
      label: 'Test',
    },
  });
  await db().walletObservation.createMany({
    data: [
      ['2020-01-01T10:00:00Z', '10', false],
      ['2020-01-01T12:00:00Z', '12', false],
      ['2020-01-01T23:30:00Z', '20', false],
      ['2020-01-02T12:00:00Z', '99', true],
    ].map(([date, amount, invalid]) => ({
      walletId: wallet.id,
      fetchedAt: new Date(String(date)),
      totalUsd: String(amount),
      data: {},
      invalidatedAt: invalid ? new Date() : null,
    })),
  });
  const result = await walletHistory(user.userId, wallet.id);
  expect(result.points.map((p: { value: string }) => Number(p.value))).toEqual([12, 20]);
  expect(result.points[1].date).toBe('2020-01-01T23:30:00.000Z');
  await expect(walletHistory(other.userId, wallet.id)).rejects.toMatchObject({ status: 404 });
  expect(await db().walletObservation.count({ where: { walletId: wallet.id } })).toBe(4);
  await db().portfolioSnapshot.updateMany({
    where: { portfolioId: user.portfolioId },
    data: { summary: Prisma.DbNull },
  });
});

it('retains every daily reference beyond the old 600-point cap, without rewriting captures', async () => {
  const user = await owner();
  await db().portfolioSnapshot.createMany({
    data: Array.from({ length: 605 }, (_, i) => {
      const capturedAt = new Date(Date.UTC(2020, 0, i + 1, 12));
      return {
        portfolioId: user.portfolioId,
        referenceOwnerId: user.userId,
        referenceDay: capturedAt.toISOString().slice(0, 10),
        capturedAt,
        kind: 'DAILY',
        ledgerVersion: 1,
        totalEur: String(i),
        totalUsd: String(i),
        investedEur: '0',
        netFlowsEur: '0',
        data: { rows: [], cash: [] },
      };
    }),
  });
  const state = await getState(user.userId);
  expect(state.snapshots).toHaveLength(605);
  expect(state.snapshots[0].totalEur).toBe('0');
  expect(state.snapshots.at(-1)?.totalEur).toBe('604');
  expect(
    await db().portfolioSnapshot.count({
      where: { portfolioId: user.portfolioId, summary: { equals: Prisma.DbNull } },
    }),
  ).toBe(605);
});
it('groups wallet observations by Paris day across daylight-saving changes', async () => {
  const user = await owner();
  const wallet = await db().walletConnection.create({
    data: {
      portfolioId: user.portfolioId,
      address: `0x${randomUUID().replaceAll('-', '').padEnd(40, '0')}`,
      label: 'DST',
    },
  });
  await db().walletObservation.createMany({
    data: [
      ['2026-03-28T23:30:00Z', '1'],
      ['2026-03-29T21:30:00Z', '2'],
      ['2026-03-29T22:30:00Z', '3'],
      ['2025-10-26T00:30:00Z', '4'],
      ['2025-10-26T01:30:00Z', '5'],
    ].map(([date, amount]) => ({
      walletId: wallet.id,
      fetchedAt: new Date(date),
      totalUsd: amount,
      data: {},
    })),
  });
  const result = await walletHistory(user.userId, wallet.id);
  expect(result.points.map((p: { value: string }) => Number(p.value))).toEqual([5, 2, 3]);
});
