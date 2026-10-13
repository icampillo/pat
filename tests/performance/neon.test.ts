import 'dotenv/config';
import pg from 'pg';
import { afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { configureTestDatabase } from '../database-env';
import { db } from '@/server/db';
import { createUser } from '@/server/provision';
import { getState, valuation } from '@/server/portfolio-query';
import { getPageState } from '@/server/page-state';
import { backfillSnapshotSummaries } from '@/server/snapshot-history';
import { json } from '@/server/portfolio-store';
import { filterCategoryHistory, buildCategoryDetails } from '@/domain/categories';
import { valueChange } from '@/domain/dashboard';
import type { AppState } from '@/shared/types';
configureTestDatabase();
afterAll(async () => {
  await db().$disconnect();
});

// Baseline copies are provided only in the isolated validation project, never shipped.
it.skipIf(!process.env.PATRIMOINE_BASELINE_QUERY)(
  'measures identical synthetic workloads before, transitional and summarized reads',
  async () => {
    const baseline = await import(/* @vite-ignore */ process.env.PATRIMOINE_BASELINE_QUERY!);
    const user = await createUser('Benchmark', `bench-${randomUUID()}@example.test`, randomUUID());
    const categories = await db().assetCategory.findMany({
      where: { portfolioId: user.portfolioId },
    });
    const crypto = categories.find((c) => c.key === 'CRYPTO')!;
    const now = Date.now();
    const ago = (days: number) => new Date(now - days * 86400000);
    await db().fxRate.create({
      data: {
        portfolioId: user.portfolioId,
        eurUsd: '1.25',
        observedAt: ago(1000),
        source: 'test',
      },
    });
    for (let n = 0; n < 12; n++) {
      const asset = await db().asset.create({
        data: {
          portfolioId: user.portfolioId,
          categoryId: crypto.id,
          name: `Asset ${n}`,
          symbol: `A${n}`,
          currency: 'USD',
          metadata: { description: 'synthetic '.repeat(60) },
        },
      });
      await db().priceHistory.createMany({
        data: Array.from({ length: 420 }, (_, i) => ({
          portfolioId: user.portfolioId,
          assetId: asset.id,
          price: String(100 + i + n),
          currency: 'USD',
          observedAt: ago(420 - i),
          source: 'test',
        })),
      });
      await db().transaction.create({
        data: {
          portfolioId: user.portfolioId,
          assetId: asset.id,
          type: 'BUY',
          quantity: '10',
          unitPrice: '100',
          fees: '0',
          amount: '1000',
          currency: 'USD',
          fxToEur: '0.8',
          fxToUsd: '1',
          platform: 'Test',
          occurredAt: ago(700),
          comment: 'synthetic '.repeat(200),
        },
      });
    }
    for (let n = 0; n < 3; n++) {
      const wallet = await db().walletConnection.create({
        data: {
          portfolioId: user.portfolioId,
          address: `0x${String(n + 1).padStart(40, '0')}`,
          label: `Wallet ${n}`,
          createdAt: ago(200),
          status: 'OK',
        },
      });
      const data = {
        source: 'ZERION',
        totalUsd: '400',
        liquidUsd: '400',
        defiUsd: '0',
        debtUsd: '0',
        rewardsUsd: '0',
        reconciliationUsd: '0',
        positions: [],
        chains: [],
        tokens: Array.from({ length: 20 }, (_, i) => ({
          id: `token-${i}`,
          chain: 'ethereum',
          name: 'synthetic token '.repeat(6),
          symbol: `T${i}`,
          amount: '2',
          priceUsd: '10',
          valueUsd: '20',
        })),
      };
      await db().walletObservation.createMany({
        data: Array.from({ length: 120 }, (_, i) => ({
          walletId: wallet.id,
          fetchedAt: ago(120 - i),
          totalUsd: '400',
          data,
        })),
      });
    }
    const state = await db().$transaction((tx) => valuation(tx, user.portfolioId));
    const saved = json({ ...state, transactions: undefined });
    await db().portfolioSnapshot.createMany({
      data: Array.from({ length: 600 }, (_, i) => ({
        portfolioId: user.portfolioId,
        referenceOwnerId: user.userId,
        referenceDay: ago(600 - i)
          .toISOString()
          .slice(0, 10),
        capturedAt: ago(600 - i),
        kind: 'DAILY',
        ledgerVersion: 1,
        totalEur: state.totals.valueEur,
        totalUsd: state.totals.valueUsd,
        investedEur: state.totals.costEur,
        netFlowsEur: state.totals.netFlowsEur,
        data: saved,
      })),
    });

    // Fresh synthetic loads need statistics before comparing execution plans.
    await db().$executeRawUnsafe(
      'ANALYZE "Asset", "PriceHistory", "WalletConnection", "WalletObservation", "PortfolioSnapshot"',
    );

    // pg receives text DataRow fields before Prisma parsing. Count DataRow frame bytes only:
    // excludes RowDescription, TLS, TCP, auth, and any Neon billing semantics.
    const Query = (
      pg as unknown as {
        Query: {
          prototype: { handleDataRow: (message: { fields: (string | Buffer | null)[] }) => void };
        };
      }
    ).Query;
    const originalRow = Query.prototype.handleDataRow;
    const originalQuery = pg.Client.prototype.query;
    let active = false,
      bytes = 0,
      count = 0,
      rows = 0;
    const plans = new Map<string, { text: string; values: unknown[] }>();
    Query.prototype.handleDataRow = function (this: unknown, message) {
      if (active) {
        bytes +=
          7 +
          message.fields.reduce(
            (sum, field) => sum + 4 + (field === null ? 0 : Buffer.byteLength(field)),
            0,
          );
        rows++;
      }
      return originalRow.call(this, message);
    };
    pg.Client.prototype.query = function (
      this: pg.Client,
      ...args: Parameters<typeof originalQuery>
    ) {
      if (active) {
        count++;
        const config = args[0] as unknown as { text?: string; values?: unknown[] };
        if (config.text?.includes('LATERAL'))
          plans.set(config.text, { text: config.text, values: config.values ?? [] });
      }
      return originalQuery.apply(this, args);
    } as typeof originalQuery;
    const metrics: Record<string, unknown> = {};
    async function measure(name: string, read: () => Promise<AppState>) {
      let result!: AppState;
      const samples = [];
      await read(); // warm connection/module caches for every scenario
      for (let i = 0; i < 5; i++) {
        bytes = count = rows = 0;
        active = true;
        const start = performance.now();
        try {
          result = await read();
        } finally {
          active = false;
        }
        samples.push({
          sqlStatements: count,
          dataRows: rows,
          dataRowBytes: bytes,
          httpBytes: Buffer.byteLength(
            JSON.stringify({ data: { ...result, userName: 'Benchmark' } }),
          ),
          ms: performance.now() - start,
        });
      }
      const times = samples.map((s) => s.ms).sort((a, b) => a - b);
      metrics[name] = { ...samples[0], medianMs: times[2], minMs: times[0], maxMs: times[4] };
      return result;
    }
    try {
      const before = await measure('before', () => baseline.getState(user.userId));
      const transitional = await measure('projection', () => getState(user.userId));
      expect(transitional.snapshots).toEqual(before.snapshots);
      while (await backfillSnapshotSummaries(db(), 100)) {
        /* bounded/resumable */
      }
      const after = await measure('summary', () => getState(user.userId));
      await measure('settings', () => getPageState(user.userId, 'settings'));
      await measure('wallets', () => getPageState(user.userId, 'wallets'));
      expect(after.totals).toEqual(before.totals);
      expect(after.rows).toEqual(before.rows);
      expect(after.onchain).toEqual(before.onchain);
      expect(after.snapshots).toEqual(before.snapshots);
      for (const currency of ['EUR', 'USD'] as const) {
        const history = (s: AppState) =>
          s.snapshots.map((p) => ({
            date: p.capturedAt,
            value: Number(currency === 'EUR' ? p.totalEur : p.totalUsd),
          }));
        for (const period of ['7d', '30d', '90d', '1y', 'all']) {
          expect(filterCategoryHistory(history(after), period, before.asOf)).toEqual(
            filterCategoryHistory(history(before), period, before.asOf),
          );
        }
        for (const category of categories) {
          expect(buildCategoryDetails({ ...after, asOf: before.asOf }, category, currency)).toEqual(
            buildCategoryDetails(before, category, currency),
          );
        }
        for (const days of [7, 30] as const)
          expect(
            valueChange(Number(after.totals.valueEur), history(after), before.asOf, days),
          ).toEqual(
            valueChange(Number(before.totals.valueEur), history(before), before.asOf, days),
          );
      }
      const client = new pg.Client({ connectionString: process.env.DATABASE_URL_TEST });
      await client.connect();
      try {
        for (const plan of plans.values()) {
          const result = await client.query(
            `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${plan.text}`,
            plan.values,
          );
          console.info('QUERY_PLAN', JSON.stringify(result.rows));
        }
      } finally {
        await client.end();
      }
      console.info(
        'NEON_BENCHMARK',
        JSON.stringify({
          fixture: {
            assets: 12,
            prices: 5040,
            wallets: 3,
            observations: 360,
            snapshots: 600,
            snapshotJsonBytes: Buffer.byteLength(JSON.stringify(saved)),
          },
          metrics,
        }),
      );
    } finally {
      Query.prototype.handleDataRow = originalRow;
      pg.Client.prototype.query = originalQuery;
    }
  },
  120_000,
);
