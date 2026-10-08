import { snapshotDay } from '@/domain/snapshot-day';
import { db } from './db';
import type { Transaction } from '@/generated/prisma/client';
import { replay } from '@/domain/ledger';
import { decimal as d, precise } from '@/domain/money';
import { AppError } from './errors';
import { walletState } from './wallet-state';
import { realEstateAt } from '@/domain/real-estate';
import { snapshotCategoryValues, performance30d, numeric } from '@/domain/categories';
import { metadataSchema } from '@/shared/schemas';
import { json, owned, toLedger, type TxDb } from './portfolio-store';

export async function valuation(tx: TxDb, portfolioId: string, at = new Date()) {
  const [assets, transactions, rate] = await Promise.all([
    tx.asset.findMany({
      where: { portfolioId },
      include: {
        category: true,
        image: { select: { updatedAt: true } },
        prices: {
          where: { observedAt: { lte: at } },
          orderBy: [{ observedAt: 'desc' }, { createdAt: 'desc' }],
          take: 1,
        },
      },
      orderBy: { name: 'asc' },
    }),
    tx.transaction.findMany({ where: { portfolioId, voided: false, occurredAt: { lte: at } } }),
    tx.fxRate.findFirst({
      where: { portfolioId, observedAt: { lte: at } },
      orderBy: { observedAt: 'desc' },
    }),
  ]);
  const ledger = replay(transactions.map(toLedger));
  const assetNames = new Map(assets.map((asset) => [asset.id, asset.name]));
  const fx = rate ? d(String(rate.eurUsd)) : null;
  let subtotalEur = d(0),
    subtotalUsd = d(0),
    costEur = d(0),
    costUsd = d(0),
    realized = d(0),
    missingEur = 0,
    missingUsd = 0,
    unknownCostEur = false,
    incompleteCostBasis = false,
    unknownCostUsd = false;
  const rows = assets.map((asset) => {
    if (asset.category.key === 'REAL_ESTATE') {
      const property = metadataSchema.parse(asset.metadata).realEstate;
      if (!property) throw new AppError('REAL_ESTATE_METADATA', 'Fiche immobilière invalide.');
      const held =
        !asset.deletedAt &&
        asset.status === 'ACTIVE' &&
        property.purchaseDate <= at.toISOString().slice(0, 10);
      const price = asset.prices[0];
      // A missing current estimate remains unknown; historical quotes are dated.
      const nativePrice =
        property.currentValue === null ? null : price ? String(price.price) : null;
      const result = realEstateAt(property, at, nativePrice);
      const convert = (amount: string | null, target: string) =>
        amount === null
          ? null
          : asset.currency === target || d(amount).isZero()
            ? precise(amount)
            : fx
              ? precise(target === 'EUR' ? d(amount).div(fx) : d(amount).mul(fx))
              : null;
      const eur = held ? convert(result.equity, 'EUR') : '0';
      const usd = held ? convert(result.equity, 'USD') : '0';
      if (eur === null) missingEur++;
      else subtotalEur = subtotalEur.add(eur);
      if (usd === null) missingUsd++;
      else subtotalUsd = subtotalUsd.add(usd);
      // Generic invested capital and P&L rely on ledger cash flows, unavailable here.
      if (held) {
        unknownCostEur = true;
        unknownCostUsd = true;
      }
      return {
        ...json(asset),
        realEstate: result,
        quantity: held ? '1' : '0',
        costEur: held ? null : '0',
        costUsd: held ? null : '0',
        averageEur: null,
        realizedEur: null,
        realizedUsd: null,
        incomeEur: '0',
        places: {},
        price: nativePrice,
        priceDate: price?.observedAt.toISOString() ?? null,
        stale: false,
        valueEur: eur,
        valueUsd: usd,
        gainEur: null,
        gainUsd: null,
        averagePrice: null,
      };
    }
    const unknownBasis =
      (asset.metadata as Record<string, unknown>).costBasis === 'UNKNOWN' &&
      !!ledger.assets[asset.id];
    if (unknownBasis) incompleteCostBasis = true;
    const balance = ledger.assets[asset.id] || {
      quantity: '0',
      costEur: '0',
      costUsd: '0',
      averageEur: '0',
      realizedEur: '0',
      realizedUsd: '0',
      incomeEur: '0',
      places: {},
    };
    const price = asset.prices[0],
      quantity = d(balance.quantity);
    const native = quantity.isZero() ? d(0) : price ? quantity.mul(String(price.price)) : null;
    const eur = quantity.isZero()
      ? d(0)
      : native === null
        ? null
        : asset.currency === 'EUR'
          ? native
          : fx
            ? native.div(fx)
            : null;
    const usd = quantity.isZero()
      ? d(0)
      : native === null
        ? null
        : asset.currency === 'USD'
          ? native
          : fx
            ? native.mul(fx)
            : null;
    if (eur !== null) subtotalEur = subtotalEur.add(eur);
    else missingEur++;
    if (usd !== null) subtotalUsd = subtotalUsd.add(usd);
    else missingUsd++;
    if (unknownBasis && !quantity.isZero()) unknownCostEur = true;
    else costEur = costEur.add(balance.costEur);
    realized = realized.add(balance.realizedEur);
    if (balance.costUsd === null || (unknownBasis && !quantity.isZero())) unknownCostUsd = true;
    else costUsd = costUsd.add(balance.costUsd);
    return {
      ...json(asset),
      ...balance,
      costEur: unknownBasis && !quantity.isZero() ? null : balance.costEur,
      costUsd: unknownBasis && !quantity.isZero() ? null : balance.costUsd,
      averageEur: unknownBasis ? null : balance.averageEur,
      realizedEur: unknownBasis ? null : balance.realizedEur,
      realizedUsd: unknownBasis ? null : balance.realizedUsd,
      price: price ? String(price.price) : null,
      priceDate: price?.observedAt.toISOString() || null,
      stale: price ? at.getTime() - price.observedAt.getTime() > 86400000 : true,
      valueEur: eur === null ? null : precise(eur),
      valueUsd: usd === null ? null : precise(usd),
      gainEur: eur === null || unknownBasis ? null : precise(eur.sub(balance.costEur)),
      gainUsd:
        usd === null || balance.costUsd === null || unknownBasis
          ? null
          : precise(usd.sub(balance.costUsd)),
      averagePrice: unknownBasis
        ? null
        : quantity.isZero()
          ? '0'
          : asset.currency === 'EUR'
            ? balance.averageEur
            : balance.costUsd === null
              ? null
              : precise(d(balance.costUsd).div(quantity)),
    };
  });
  const cash = ledger.cash.map((c) => {
    const eur =
      c.currency === 'EUR'
        ? d(c.balance)
        : fx
          ? d(c.balance).div(fx)
          : d(c.balance).isZero()
            ? d(0)
            : null;
    const usd =
      c.currency === 'USD'
        ? d(c.balance)
        : fx
          ? d(c.balance).mul(fx)
          : d(c.balance).isZero()
            ? d(0)
            : null;
    if (eur !== null) subtotalEur = subtotalEur.add(eur);
    else missingEur++;
    if (usd !== null) subtotalUsd = subtotalUsd.add(usd);
    else missingUsd++;
    return {
      ...c,
      valueEur: eur === null ? null : precise(eur),
      valueUsd: usd === null ? null : precise(usd),
    };
  });
  const assetValue = rows.reduce((sum, a) => sum.add(a.valueEur || 0), d(0));
  const onchain = await walletState(tx, portfolioId, at, rate ? String(rate.eurUsd) : null);
  for (const wallet of onchain.wallets.filter((w) => w.included)) {
    if (!wallet.data) {
      missingEur++;
      missingUsd++;
      continue;
    }
    const usd = d(wallet.data.totalUsd);
    subtotalUsd = subtotalUsd.add(usd);
    if (fx) subtotalEur = subtotalEur.add(usd.div(fx));
    else if (!usd.isZero()) missingEur++;
  }
  return {
    onchain,
    rows,
    cash,
    transactions: transactions
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
      .map((t) => ({
        ...json(t),
        assetName: assetNames.get(t.assetId ?? '') || 'Liquidités',
      })),
    totals: {
      valueEur: missingEur ? null : precise(subtotalEur),
      valueUsd: missingUsd ? null : precise(subtotalUsd),
      subtotalEur: precise(subtotalEur),
      costEur: unknownCostEur ? null : precise(costEur),
      costUsd: unknownCostUsd ? null : precise(costUsd),
      realizedEur: incompleteCostBasis ? null : precise(realized),
      incompleteCostBasis,
      unrealizedEur:
        unknownCostEur || onchain.includedCount > 0 || rows.some((a) => a.valueEur === null)
          ? null
          : precise(assetValue.sub(costEur)),
      purchasesEur: ledger.purchasesEur,
      netFlowsEur: ledger.netFlowsEur,
      incomeEur: ledger.incomeEur,
      expensesEur: ledger.expensesEur,
      missingEur,
      missingUsd,
    },
    fxRate: rate
      ? {
          eurUsd: String(rate.eurUsd),
          observedAt: rate.observedAt.toISOString(),
          source: rate.source,
        }
      : null,
    flows: ledger.flows,
  };
}
// Only the daily job and isolated demo seeder create captures.
export async function capture(
  tx: TxDb,
  portfolioId: string,
  version: number,
  kind: 'DAILY' | 'SEED',
  at: Date,
) {
  const portfolio = await tx.portfolio.findUniqueOrThrow({ where: { id: portfolioId } });
  const referenceDay = snapshotDay(at);
  const referenceOwnerId = portfolio.ownerId;
  const existing = await tx.portfolioSnapshot.findUnique({
    where: { referenceOwnerId_referenceDay: { referenceOwnerId, referenceDay } },
  });
  if (existing) return existing;
  if (kind === 'SEED' && !portfolio.isDemo)
    throw new AppError('DEMO_ONLY', 'Capture de démonstration interdite.');
  const state = await valuation(tx, portfolioId, at);
  // Missing valuations stay null, never an invented zero. References are never updated.
  return tx.portfolioSnapshot.create({
    data: {
      portfolioId,
      capturedAt: at,
      kind,
      referenceOwnerId,
      referenceDay,
      ledgerVersion: version,
      totalEur: state.totals.valueEur,
      totalUsd: state.totals.valueUsd,
      investedEur: state.totals.costEur,
      netFlowsEur: state.totals.netFlowsEur,
      data: json({ ...state, transactions: undefined }),
    },
  });
}
export async function runSnapshot(portfolioId: string, at = new Date()) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db().$transaction(
        async (tx) => {
          const portfolio = await tx.portfolio.findUniqueOrThrow({ where: { id: portfolioId } });
          return capture(tx, portfolio.id, portfolio.version, 'DAILY', at);
        },
        { isolationLevel: 'RepeatableRead', timeout: 30_000 },
      );
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      if (
        attempt < 2 &&
        typeof code === 'string' &&
        ['P2002', 'P2034', 'P1001', 'P1002', 'P1008', 'P1017', 'P2024'].includes(code)
      ) {
        console.warn(
          JSON.stringify({
            job: 'snapshot',
            event: 'retry',
            portfolioId,
            day: snapshotDay(at),
            attempt: attempt + 1,
            code,
          }),
        );
        continue;
      }
      throw error;
    }
  }
  throw new Error('Snapshot retry exhausted');
}
export async function getState(userId: string) {
  return db().$transaction(
    async (tx) => {
      const portfolio = await owned(userId, tx);
      const asOf = new Date();
      const [state, categories, snapshots, walletHistory] = await Promise.all([
        valuation(tx, portfolio.id, asOf),
        tx.assetCategory.findMany({
          where: { portfolioId: portfolio.id },
          orderBy: { key: 'asc' },
        }),
        tx.portfolioSnapshot.findMany({
          where: { referenceOwnerId: userId, referenceDay: { not: null } },
          orderBy: { capturedAt: 'desc' },
          take: 600,
          select: {
            id: true,
            capturedAt: true,
            referenceDay: true,
            kind: true,
            totalEur: true,
            totalUsd: true,
            investedEur: true,
            ledgerVersion: true,
            data: true,
          },
        }),
        tx.walletConnection.count({ where: { portfolioId: portfolio.id } }),
      ]);
      const target = new Date(asOf.getTime() - 30 * 86400000);
      const quoted = state.rows.filter((row) => row.priceDate && d(row.quantity).gt(0));
      const priceCandidates = quoted.length
        ? (
            await Promise.all(
              ['before', 'after'].map((side) =>
                tx.priceHistory.findMany({
                  where: {
                    portfolioId: portfolio.id,
                    observedAt: side === 'before' ? { lte: target } : { gt: target, lte: asOf },
                    OR: quoted.map((row) => ({
                      assetId: row.id,
                      observedAt: { lt: new Date(row.priceDate!) },
                    })),
                  },
                  distinct: ['assetId'],
                  orderBy: [
                    { assetId: 'asc' },
                    { observedAt: side === 'before' ? 'desc' : 'asc' },
                    { createdAt: 'desc' },
                  ],
                  select: { assetId: true, price: true, observedAt: true },
                }),
              ),
            )
          ).flat()
        : [];
      const revisions = await tx.transactionRevision.count({
        where: { transaction: { portfolioId: portfolio.id }, version: { gt: 1 } },
      });
      const retrospective = snapshots.some(
        (s) =>
          s.kind !== 'SEED' &&
          state.transactions.some(
            (t: Transaction) =>
              new Date(t.createdAt).getTime() > s.capturedAt.getTime() &&
              new Date(t.occurredAt).getTime() <= s.capturedAt.getTime(),
          ),
      );
      return json({
        portfolio,
        ...state,
        rows: state.rows.map((row) => ({
          ...row,
          change30dPercent: performance30d(
            numeric(row.price),
            priceCandidates
              .filter((price) => price.assetId === row.id)
              .map((price) => ({
                date: price.observedAt.toISOString(),
                value: Number(price.price),
              })),
            asOf.toISOString(),
          ).percent,
        })),
        categories,
        snapshots: snapshots.reverse().map(({ data, ...snapshot }) => ({
          ...snapshot,
          categoryValues: snapshotCategoryValues(data, categories),
        })),
        asOf: asOf.toISOString(),
        historyRevised: revisions > 0 || retrospective || walletHistory > 0,
      });
    },
    { isolationLevel: 'RepeatableRead', timeout: 20_000 },
  );
}
