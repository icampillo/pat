import { db } from './db';
import type { Prisma, Transaction } from '@/generated/prisma/client';
import { replay, type LedgerTransaction } from '@/domain/ledger';
import { decimal as d, precise, metalValue } from '@/domain/money';
import {
  ManualPriceProvider,
  UnconfiguredProvider,
  withFallback,
} from '@/modules/prices/providers';
import { AppError } from './errors';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { walletState } from './wallet-state';
import { snapshotCategoryValues, performance30d, numeric } from '@/domain/categories';
import {
  assetCreationSchema,
  assetUpdateSchema,
  metadataSchema,
  transactionSchema,
  transactionEditSchema,
  priceSchema,
  fxSchema,
  settingsSchema,
} from '@/shared/schemas';
export type TxDb = Prisma.TransactionClient;
export const json = <T>(value: T) => JSON.parse(JSON.stringify(value));
export function toLedger(t: Transaction): LedgerTransaction {
  return {
    ...t,
    quantity: String(t.quantity),
    unitPrice: String(t.unitPrice),
    amount: String(t.amount),
    fees: String(t.fees),
    fxToEur: String(t.fxToEur),
    fxToUsd: t.fxToUsd === null ? null : String(t.fxToUsd),
    occurredAt: t.occurredAt.toISOString(),
  };
}
export async function owned(userId: string, client: TxDb = db()) {
  const p = await client.portfolio.findFirst({
    where: { ownerId: userId },
    orderBy: { createdAt: 'asc' },
  });
  if (!p)
    throw new AppError(
      'PORTFOLIO_NOT_FOUND',
      'Aucun portefeuille. Créez votre utilisateur avec la commande user:create.',
      404,
    );
  return p;
}
export async function mutate(
  userId: string,
  key: string | null,
  scope: string,
  input: unknown,
  action: (tx: TxDb, portfolio: Awaited<ReturnType<typeof owned>>) => Promise<unknown>,
) {
  if (!key || key.length < 8 || key.length > 150)
    throw new AppError('IDEMPOTENCY_REQUIRED', 'Clé de requête manquante.', 400);
  const hash = createHash('sha256')
    .update(scope + JSON.stringify(input))
    .digest('hex');
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db().$transaction(
        async (tx) => {
          const p = await owned(userId, tx);
          const previous = await tx.idempotencyRecord.findUnique({
            where: { portfolioId_key: { portfolioId: p.id, key } },
          });
          if (previous) {
            if (previous.hash !== hash)
              throw new AppError(
                'IDEMPOTENCY_CONFLICT',
                'Cette clé correspond à une autre requête.',
                409,
              );
            return previous.result;
          }
          // L'écriture du portefeuille sérialise les commandes et empêche les doubles ventes.
          await tx.portfolio.update({ where: { id: p.id }, data: { version: { increment: 1 } } });
          const result = json(await action(tx, p));
          await tx.idempotencyRecord.create({ data: { portfolioId: p.id, key, hash, result } });
          await tx.auditLog.create({ data: { portfolioId: p.id, actorId: userId, action: scope } });
          return result;
        },
        { isolationLevel: 'Serializable', timeout: 20_000 },
      );
    } catch (error) {
      if ((error as { code?: string }).code === 'P2034' && attempt < 2) continue;
      if ((error as { code?: string }).code === 'P2002')
        throw new AppError('DUPLICATE', 'Cette référence existe déjà.', 409);
      throw error;
    }
  }
}
export function checkVersion(version: number, expected: string | null) {
  if (!expected) throw new AppError('VERSION_REQUIRED', 'Version de la ressource manquante.', 428);
  if (String(version) !== expected.replaceAll('"', ''))
    throw new AppError('STALE_VERSION', 'La ressource a changé. Rechargez la page.', 412);
}
async function requireActiveAsset(tx: TxDb, portfolioId: string, assetId: string) {
  const asset = await tx.asset.findFirst({
    where: { id: assetId, portfolioId, deletedAt: null },
  });
  if (!asset) throw new AppError('NOT_FOUND', 'Actif introuvable.', 404);
  if (asset.status !== 'ACTIVE')
    throw new AppError(
      'ASSET_ARCHIVED',
      'Cet actif est archivé. Réactivez-le avant d’ajouter, corriger ou annuler une opération.',
      409,
    );
}

async function assertArchivable(tx: TxDb, portfolioId: string, assetId: string) {
  const rows = await tx.transaction.findMany({ where: { portfolioId, voided: false } });
  const now = new Date();
  // Même borne temporelle que la valorisation, sans utiliser une projection mutable.
  const ledger = replay(rows.filter((row) => row.occurredAt <= now).map(toLedger));
  if (!d(ledger.assets[assetId]?.quantity || '0').isZero())
    throw new AppError(
      'ASSET_POSITION_OPEN',
      'Soldez ou corrigez d’abord la position avant d’archiver cet actif.',
      409,
    );
  // La validation des dates tolère un léger décalage d’horloge : ne pas ignorer ces écritures.
  if (rows.some((row) => row.assetId === assetId && row.occurredAt > now))
    throw new AppError(
      'ASSET_PENDING_TRANSACTION',
      'Une opération de cet actif est datée dans le futur. Attendez sa date ou corrigez-la avant l’archivage.',
      409,
    );
}

async function auditAssetStatus(
  tx: TxDb,
  portfolioId: string,
  actorId: string,
  entityId: string,
  status: string,
) {
  await tx.auditLog.create({
    data: {
      portfolioId,
      actorId,
      entityId,
      action: status === 'ARCHIVED' ? 'ASSET_ARCHIVED' : 'ASSET_REACTIVATED',
    },
  });
}
export async function prepareTransaction(
  tx: TxDb,
  portfolioId: string,
  input: unknown,
  previous?: Transaction,
) {
  const data = transactionSchema.parse(input);
  if (data.assetId) await requireActiveAsset(tx, portfolioId, data.assetId);
  const rate = await tx.fxRate.findFirst({
    where: { portfolioId, observedAt: { lte: new Date(data.occurredAt) } },
    orderBy: { observedAt: 'desc' },
  });
  if (data.currency === 'USD' && !rate)
    throw new AppError('FX_REQUIRED', 'Saisissez un taux EUR/USD à la date de cette transaction.');
  const fxToEur = data.currency === 'EUR' ? '1' : precise(d(1).div(String(rate!.eurUsd)));
  const fxToUsd = data.currency === 'USD' ? '1' : rate ? String(rate.eurUsd) : null;
  const preserveFx =
    previous &&
    previous.currency === data.currency &&
    previous.occurredAt.getTime() === Date.parse(data.occurredAt);
  return {
    ...data,
    portfolioId,
    occurredAt: new Date(data.occurredAt),
    fxToEur: preserveFx ? previous.fxToEur : fxToEur,
    fxToUsd: preserveFx ? previous.fxToUsd : fxToUsd,
    amount: ['BUY', 'SELL'].includes(data.type)
      ? precise(d(data.quantity).mul(data.unitPrice))
      : data.amount,
  };
}
export async function insertTransaction(
  tx: TxDb,
  portfolioId: string,
  userId: string,
  input: unknown,
) {
  const row = await tx.transaction.create({
    data: await prepareTransaction(tx, portfolioId, input),
  });
  await tx.transactionRevision.create({
    data: {
      transactionId: row.id,
      version: 1,
      actorId: userId,
      reason: 'Création',
      payload: json(row),
    },
  });
  return row;
}
export async function validateLedger(tx: TxDb, portfolioId: string) {
  const rows = await tx.transaction.findMany({ where: { portfolioId, voided: false } });
  return replay(rows.map(toLedger));
}
export async function command(
  userId: string,
  method: string,
  segments: string[],
  input: unknown,
  key: string | null,
  version: string | null,
) {
  const [resource, id, child] = segments;
  return mutate(
    userId,
    key,
    `${method}/${segments.join('/')}`,
    { input, version },
    async (tx, p) => {
      if (resource === 'assets') {
        if (method === 'POST' && !id) {
          const data = assetCreationSchema.parse(input);
          const category = await tx.assetCategory.findFirst({
            where: { id: data.categoryId, portfolioId: p.id },
          });
          if (!category) throw new AppError('NOT_FOUND', 'Catégorie introuvable.', 404);
          const { quantity, acquisitionCost, ...assetData } = data;
          if (
            category.key === 'METALS' &&
            (!data.metadata.metalType || !data.metadata.weightGrams || !data.metadata.purity)
          )
            throw new AppError(
              'METAL_DETAILS_REQUIRED',
              'Renseignez le métal, le poids et la pureté.',
            );
          const asset = await tx.asset.create({
            data: {
              ...assetData,
              portfolioId: p.id,
              metadata: {
                ...data.metadata,
                ...(quantity ? { costBasis: acquisitionCost ? 'KNOWN' : 'UNKNOWN' } : {}),
                ...(category.key === 'METALS'
                  ? { pricingMode: data.metadata.pricingMode || 'METAL_MARKET' }
                  : {}),
              },
            },
          });
          if (quantity) {
            await insertTransaction(tx, p.id, userId, {
              assetId: asset.id,
              type: 'ADJUSTMENT',
              quantity,
              unitPrice: acquisitionCost ? precise(d(acquisitionCost).div(quantity)) : '0',
              currency: asset.currency,
              platform: asset.platform,
              occurredAt: new Date().toISOString(),
              settlement: 'EXTERNAL',
              comment: acquisitionCost
                ? 'Inventaire initial saisi dans la fiche ; coût d’acquisition total fourni par l’utilisateur, date d’achat non précisée.'
                : 'Inventaire initial saisi dans la fiche ; coût et date d’achat non précisés.',
            });
            await validateLedger(tx, p.id);
          }
          return asset;
        }
        const asset = await tx.asset.findFirst({
          where: { id, portfolioId: p.id, deletedAt: null },
          include: { category: true },
        });
        if (!asset) throw new AppError('NOT_FOUND', 'Actif introuvable.', 404);
        if (method === 'POST' && child === 'prices') {
          if (
            (asset.category.key === 'METALS' &&
              (asset.metadata as Record<string, unknown>).pricingMode === 'METAL_MARKET') ||
            (asset.category.key === 'SECURITIES' &&
              (asset.metadata as Record<string, unknown>).pricingMode === 'SECURITIES_MARKET')
          )
            throw new AppError(
              'PRICE_AUTOMATIC',
              'Le prix de cet actif est récupéré automatiquement.',
              409,
            );
          const data = priceSchema.parse(input);
          let price: string,
            source = 'manual';
          if ('gramPrice' in data) {
            const meta = metadataSchema.parse(asset.metadata);
            if (asset.category.key !== 'METALS' || !meta.weightGrams || !meta.purity)
              throw new AppError(
                'METAL_DETAILS_REQUIRED',
                'Renseignez le poids et la pureté sur une fiche de métal.',
              );
            price = metalValue(meta.weightGrams, meta.purity, data.gramPrice, data.premium);
            source = 'manual-metal-gram';
          } else price = data.price;
          return tx.priceHistory.create({
            data: {
              price,
              source,
              assetId: asset.id,
              portfolioId: p.id,
              currency: asset.currency,
              observedAt: new Date(data.observedAt),
            },
          });
        }
        if (method === 'POST' && child === 'refresh') {
          const last = await tx.priceHistory.findFirst({
            where: { assetId: id, observedAt: { lte: new Date() } },
            orderBy: [{ observedAt: 'desc' }, { createdAt: 'desc' }],
          });
          const quote = last
            ? {
                price: String(last.price),
                currency: last.currency,
                source: last.source,
                observedAt: last.observedAt,
                fetchedAt: new Date(),
              }
            : null;
          const providerKey = (
            {
              CRYPTO: 'crypto',
              SECURITIES: 'securities',
              METALS: 'metals',
              POKEMON: 'cards',
              ONE_PIECE: 'cards',
            } as const
          )[asset.category.key as 'CRYPTO'];
          const provider = providerKey
            ? new UnconfiguredProvider(providerKey)
            : new ManualPriceProvider(async () => quote);
          const result = await withFallback(
            provider,
            {
              id: asset.id,
              symbol: asset.symbol,
              currency: asset.currency,
              category: asset.category.key,
            },
            quote,
            (code) => console.warn(JSON.stringify({ code, provider: provider.id })),
          );
          // Un fallback ne crée pas une observation faussement récente.
          return { id: asset.id, ...result };
        }
        checkVersion(asset.version, version);
        if (method === 'PATCH') {
          const data = assetUpdateSchema.parse(input);
          if (data.status === 'ARCHIVED') await assertArchivable(tx, p.id, asset.id);
          if (data.acquisitionCost) await requireActiveAsset(tx, p.id, asset.id);
          const category = await tx.assetCategory.findFirst({
            where: { id: data.categoryId, portfolioId: p.id },
          });
          if (!category) throw new AppError('NOT_FOUND', 'Catégorie introuvable.', 404);
          if (
            data.currency !== asset.currency &&
            ((await tx.transaction.count({ where: { assetId: id } })) ||
              (await tx.priceHistory.count({ where: { assetId: id } })))
          )
            throw new AppError(
              'CURRENCY_LOCKED',
              'La devise ne peut plus changer après une transaction ou une cotation.',
              409,
            );
          const { acquisitionCost, ...assetData } = data;
          if (
            category.key === 'METALS' &&
            (!data.metadata.metalType || !data.metadata.weightGrams || !data.metadata.purity)
          )
            throw new AppError(
              'METAL_DETAILS_REQUIRED',
              'Renseignez le métal, le poids et la pureté.',
            );
          if (acquisitionCost) {
            const entries = await tx.transaction.findMany({
              where: { assetId: id, voided: false },
            });
            if (
              entries.length !== 1 ||
              !['ADJUSTMENT', 'BUY'].includes(entries[0].type) ||
              !d(entries[0].quantity).gt(0)
            )
              throw new AppError(
                'COST_COMPLEX_HISTORY',
                'Le coût de cette fiche ne peut pas être corrigé directement car elle contient plusieurs opérations.',
                409,
              );
            const entry = entries[0];
            const updated = await tx.transaction.update({
              where: { id: entry.id },
              data: {
                unitPrice: precise(d(acquisitionCost).div(String(entry.quantity))),
                amount: acquisitionCost,
                comment:
                  'Coût d’acquisition total renseigné depuis la fiche ; date d’achat non précisée.',
                version: { increment: 1 },
              },
            });
            await tx.transactionRevision.create({
              data: {
                transactionId: entry.id,
                version: updated.version,
                actorId: userId,
                reason: 'Coût d’acquisition corrigé depuis la fiche',
                payload: json(updated),
              },
            });
            await validateLedger(tx, p.id);
          }
          const updated = await tx.asset.update({
            where: { id },
            data: {
              ...assetData,
              metadata: {
                ...data.metadata,
                ...(acquisitionCost ? { costBasis: 'KNOWN' } : {}),
                ...(category.key === 'METALS' ? { pricingMode: 'METAL_MARKET' } : {}),
              },
              version: { increment: 1 },
            },
          });
          if (asset.status !== updated.status)
            await auditAssetStatus(tx, p.id, userId, asset.id, updated.status);
          return updated;
        }
        if (method === 'DELETE') {
          z.object({ confirmed: z.literal(true) })
            .strict()
            .parse(input);
          await assertArchivable(tx, p.id, asset.id);
          const updated =
            asset.status === 'ARCHIVED'
              ? asset
              : await tx.asset.update({
                  where: { id: asset.id },
                  data: { status: 'ARCHIVED', version: { increment: 1 } },
                });
          if (asset.status !== updated.status)
            await auditAssetStatus(tx, p.id, userId, asset.id, updated.status);
          // Compatibilité de route uniquement : DELETE ne détruit plus aucune donnée.
          return {
            id: asset.id,
            status: updated.status,
            version: updated.version,
            archived: true,
            deleted: false,
            snapshotsDeleted: 0,
          };
        }
      }
      if (resource === 'transactions') {
        if (method === 'POST' && !id) {
          const row = await insertTransaction(tx, p.id, userId, input);
          await validateLedger(tx, p.id);
          return row;
        }
        const row = await tx.transaction.findFirst({
          where: { id, portfolioId: p.id, voided: false },
        });
        if (!row) throw new AppError('NOT_FOUND', 'Transaction introuvable.', 404);
        checkVersion(row.version, version);
        if (row.assetId) await requireActiveAsset(tx, p.id, row.assetId);
        if (method === 'PATCH') {
          const { transaction, reason } = transactionEditSchema.parse(input);
          const data = await prepareTransaction(tx, p.id, transaction, row);
          const updated = await tx.transaction.update({
            where: { id },
            data: { ...data, version: { increment: 1 } },
          });
          await tx.transactionRevision.create({
            data: {
              transactionId: id,
              version: updated.version,
              actorId: userId,
              reason,
              payload: json(updated),
            },
          });
          await validateLedger(tx, p.id);
          return updated;
        }
        if (method === 'DELETE') {
          const body = input as { confirmed?: boolean; reason?: string };
          if (!body.confirmed || !body.reason?.trim() || body.reason.length > 500)
            throw new AppError('CONFIRMATION_REQUIRED', 'Confirmation et motif requis.');
          const updated = await tx.transaction.update({
            where: { id },
            data: { voided: true, version: { increment: 1 } },
          });
          await tx.transactionRevision.create({
            data: {
              transactionId: id,
              version: updated.version,
              actorId: userId,
              reason: body.reason,
              payload: json(updated),
            },
          });
          await validateLedger(tx, p.id);
          return updated;
        }
      }
      if (resource === 'fx-rates' && method === 'POST') {
        const data = fxSchema.parse(input);
        return tx.fxRate.create({
          data: { portfolioId: p.id, eurUsd: data.eurUsd, observedAt: new Date(data.observedAt) },
        });
      }
      if (resource === 'settings' && method === 'PATCH') {
        return tx.portfolio.update({ where: { id: p.id }, data: settingsSchema.parse(input) });
      }
      if (resource === 'snapshots' && method === 'POST') return capture(tx, p.id, p.version + 1);
      throw new AppError('NOT_FOUND', 'Action introuvable.', 404);
    },
  );
}

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
        assetName: assets.find((a) => a.id === t.assetId)?.name || 'Liquidités',
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
export async function capture(
  tx: TxDb,
  portfolioId: string,
  version: number,
  kind = 'MANUAL',
  at = new Date(),
  dailyKey?: string,
) {
  if (dailyKey) {
    const existing = await tx.portfolioSnapshot.findUnique({
      where: { portfolioId_dailyKey: { portfolioId, dailyKey } },
    });
    if (existing) return existing;
  }
  const state = await valuation(tx, portfolioId, at);
  return tx.portfolioSnapshot.create({
    data: {
      portfolioId,
      capturedAt: at,
      kind,
      dailyKey,
      ledgerVersion: version,
      totalEur: state.totals.valueEur,
      totalUsd: state.totals.valueUsd,
      investedEur: state.totals.costEur,
      netFlowsEur: state.totals.netFlowsEur,
      data: json({ ...state, transactions: undefined }),
    },
  });
}
export async function runSnapshot(portfolioId: string, daily = false, at = new Date()) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db().$transaction(
        async (tx) => {
          const portfolio = await tx.portfolio.findUniqueOrThrow({ where: { id: portfolioId } });
          const dailyKey = daily
            ? new Intl.DateTimeFormat('sv-SE', { timeZone: portfolio.timezone }).format(at)
            : undefined;
          return capture(
            tx,
            portfolio.id,
            portfolio.version,
            daily ? 'DAILY' : 'MANUAL',
            at,
            dailyKey,
          );
        },
        { isolationLevel: 'RepeatableRead', timeout: 30_000 },
      );
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (daily && attempt < 2 && (code === 'P2002' || code === 'P2034')) continue;
      throw error;
    }
  }
}
export async function getState(userId: string) {
  return db().$transaction(
    async (tx) => {
      const portfolio = await owned(userId, tx);
      const asOf = new Date();
      const [state, categories, snapshots] = await Promise.all([
        valuation(tx, portfolio.id, asOf),
        tx.assetCategory.findMany({
          where: { portfolioId: portfolio.id },
          orderBy: { key: 'asc' },
        }),
        tx.portfolioSnapshot.findMany({
          where: { portfolioId: portfolio.id },
          orderBy: { capturedAt: 'desc' },
          take: 600,
          select: {
            id: true,
            capturedAt: true,
            kind: true,
            totalEur: true,
            totalUsd: true,
            investedEur: true,
            ledgerVersion: true,
            data: true,
          },
        }),
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
        historyRevised: revisions > 0 || retrospective,
      });
    },
    { isolationLevel: 'RepeatableRead', timeout: 20_000 },
  );
}
