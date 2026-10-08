import type { Transaction } from '@/generated/prisma/client';
import { replay } from '@/domain/ledger';
import { decimal as d, precise, metalValue } from '@/domain/money';
import {
  ManualPriceProvider,
  UnconfiguredProvider,
  withFallback,
} from '@/modules/prices/providers';
import { AppError } from './errors';
import { z } from 'zod';
import type { RealEstate } from '@/shared/real-estate';
import {
  assetCreationSchema,
  assetUpdateSchema,
  metadataSchema,
  transactionSchema,
  transactionEditSchema,
  transactionVoidSchema,
  priceSchema,
  fxSchema,
  settingsSchema,
} from '@/shared/schemas';
import { checkVersion, json, mutate, toLedger, type TxDb } from './portfolio-store';

async function requireActiveAsset(tx: TxDb, portfolioId: string, assetId: string) {
  const asset = await tx.asset.findFirst({
    where: { id: assetId, portfolioId, deletedAt: null },
    include: { category: true },
  });
  if (!asset) throw new AppError('NOT_FOUND', 'Actif introuvable.', 404);
  if (asset.category.key === 'REAL_ESTATE')
    throw new AppError(
      'REAL_ESTATE_LEDGER',
      'Gérez ce bien et son crédit depuis sa fiche, sans transaction générique.',
    );
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
    amount:
      ['BUY', 'SELL'].includes(data.type) && d(data.amount).isZero()
        ? previous &&
          previous.type === data.type &&
          previous.currency === data.currency &&
          d(String(previous.quantity)).eq(data.quantity) &&
          d(String(previous.unitPrice)).eq(data.unitPrice) &&
          d(String(previous.amount)).gt(0)
          ? String(previous.amount)
          : precise(d(data.quantity).mul(data.unitPrice))
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
function validateProperty(
  category: string,
  property: RealEstate | undefined,
  quantity?: string,
  cost?: string,
) {
  if ((category === 'REAL_ESTATE') !== !!property)
    throw new AppError(
      'REAL_ESTATE_METADATA',
      'Les informations immobilières sont obligatoires et réservées à la catégorie Immobilier.',
    );
  if (property && (quantity !== undefined || cost !== undefined))
    throw new AppError(
      'REAL_ESTATE_LEDGER',
      'Le bien est une fiche unique ; renseignez son prix d’acquisition dans la section Immobilier.',
    );
}
async function savePropertyEstimate(
  tx: TxDb,
  portfolioId: string,
  assetId: string,
  currency: string,
  property: RealEstate,
  previous?: RealEstate,
) {
  if (property.currentValue === null || !property.valuationDate) return;
  if (
    previous?.currentValue === property.currentValue &&
    previous.valuationDate === property.valuationDate
  )
    return;
  const latest = await tx.priceHistory.findFirst({
    where: { portfolioId, assetId },
    orderBy: { observedAt: 'desc' },
  });
  if (latest && latest.observedAt.toISOString().slice(0, 10) > property.valuationDate)
    throw new AppError(
      'ESTIMATE_DATE',
      'La nouvelle estimation doit être datée au moins du dernier relevé enregistré.',
    );
  await tx.priceHistory.create({
    data: {
      portfolioId,
      assetId,
      currency,
      price: property.currentValue,
      source: 'manual-real-estate',
      observedAt: new Date(`${property.valuationDate}T00:00:00Z`),
    },
  });
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
  if (resource === 'snapshots') throw new AppError('NOT_FOUND', 'Action introuvable.', 404);
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
          validateProperty(
            category.key,
            data.metadata.realEstate,
            data.quantity,
            data.acquisitionCost,
          );
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
          if (data.metadata.realEstate)
            await savePropertyEstimate(
              tx,
              p.id,
              asset.id,
              asset.currency,
              data.metadata.realEstate,
            );
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
          if (asset.category.key === 'REAL_ESTATE')
            throw new AppError(
              'REAL_ESTATE_ESTIMATE',
              'Modifiez la valeur et la date d’estimation depuis la fiche du bien.',
            );
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
          const providerKeys: Partial<Record<string, UnconfiguredProvider['id']>> = {
            CRYPTO: 'crypto',
            SECURITIES: 'securities',
            METALS: 'metals',
            POKEMON: 'cards',
            ONE_PIECE: 'cards',
          };
          const providerKey = providerKeys[asset.category.key];
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
          validateProperty(category.key, data.metadata.realEstate, undefined, data.acquisitionCost);
          if ((category.key === 'REAL_ESTATE') !== (asset.category.key === 'REAL_ESTATE'))
            throw new AppError(
              'CATEGORY_LOCKED',
              'Créez une nouvelle fiche pour passer entre immobilier et actifs du journal.',
              409,
            );
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
          if (data.metadata.realEstate)
            await savePropertyEstimate(
              tx,
              p.id,
              asset.id,
              data.currency,
              data.metadata.realEstate,
              metadataSchema.parse(asset.metadata).realEstate,
            );
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
          const confirmation = transactionVoidSchema.safeParse(input);
          if (!confirmation.success)
            throw new AppError('CONFIRMATION_REQUIRED', 'Confirmation et motif requis.');
          const { reason } = confirmation.data;
          const updated = await tx.transaction.update({
            where: { id },
            data: { voided: true, version: { increment: 1 } },
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
      throw new AppError('NOT_FOUND', 'Action introuvable.', 404);
    },
  );
}
