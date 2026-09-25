import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from './db';
import { capture, getState, insertTransaction, json, mutate, validateLedger } from './portfolio';
import { fetchEcbRate } from './market';
import { saveSecurityQuote } from './securities-market';
import { parseSecuritiesCsv, securityCsvRowSchema } from '@/domain/securities-csv';
import { resolveSecurity, securityQuoteSchema } from '@/modules/prices/securities';
import { decimal as d, precise } from '@/domain/money';
import { AppError } from './errors';

const rowSchema = securityCsvRowSchema.extend({
  quote: securityQuoteSchema,
  existingAssetId: z.string().nullable(),
});
const payloadSchema = z.object({
  kind: z.literal('SECURITIES_POSITIONS'),
  rows: z.array(rowSchema),
  rate: z.object({ eurUsd: z.string(), observedAt: z.string() }).nullable(),
});
type ImportRow = z.infer<typeof rowSchema>;
export type SecuritiesPreview = {
  id: string;
  rows: ImportRow[];
  errors: { line: number; message: string }[];
  expiresAt: string;
};

export async function previewSecurities(
  userId: string,
  input: unknown,
  key: string | null,
): Promise<SecuritiesPreview> {
  const { csv, platform, boursoCurrency } = z
    .object({
      csv: z.string().max(200_000),
      platform: z.string().trim().min(1).max(120).default('BoursoBank'),
      boursoCurrency: z.enum(['EUR', 'USD']).default('EUR'),
    })
    .strict()
    .parse(input);
  let parsed: ReturnType<typeof parseSecuritiesCsv>;
  try {
    parsed = parseSecuritiesCsv(csv, platform, boursoCurrency);
  } catch (error) {
    throw new AppError('CSV_INVALID', (error as Error).message, 422);
  }
  const initial = await getState(userId);
  const hash = createHash('sha256')
    .update(
      `securities-positions:${platform}:${boursoCurrency}:${csv
        .replace(/^\uFEFF/, '')
        .replaceAll('\r\n', '\n')
        .trim()}`,
    )
    .digest('hex');
  if (
    await db().importBatch.findFirst({
      where: { portfolioId: initial.portfolio.id, hash, status: 'COMMITTED' },
    })
  )
    throw new AppError(
      'IMPORT_DUPLICATE',
      'Ce relevé a déjà été importé. Aucune position n’a été ajoutée.',
      409,
    );
  const rows: ImportRow[] = [],
    errors = [...parsed.errors];
  const cache = new Map<string, ReturnType<typeof resolveSecurity>>();
  for (let offset = 0; offset < parsed.rows.length; offset += 4) {
    await Promise.all(
      parsed.rows.slice(offset, offset + 4).map(async (row) => {
        try {
          const identity = `${row.ticker || ''}:${row.isin || ''}`;
          if (!cache.has(identity)) cache.set(identity, resolveSecurity(row));
          const quote = await cache.get(identity)!;
          if (row.quoteCurrency && quote.currency !== row.quoteCurrency)
            throw new Error(
              `La cotation est en ${quote.currency}, mais le relevé est déclaré en ${row.quoteCurrency}. Vérifiez la devise et la place de cotation.`,
            );
          const matches = initial.rows.filter(
            (asset: {
              deletedAt: string | null;
              category: { key: string };
              platform: string;
              symbol: string;
              metadata: Record<string, string>;
            }) =>
              !asset.deletedAt &&
              asset.category.key === 'SECURITIES' &&
              asset.platform === row.platform &&
              (asset.metadata.ticker?.toUpperCase() === quote.symbol ||
                asset.symbol.toUpperCase() === quote.symbol ||
                (row.isin && asset.metadata.isin === row.isin)),
          );
          if (matches.length > 1)
            throw new Error(
              'Plusieurs positions existantes correspondent à ce produit et ce compte.',
            );
          const existing = matches[0];
          if (existing) {
            if (existing.status === 'ARCHIVED')
              throw new AppError(
                'ASSET_ARCHIVED',
                'Ce produit est archivé sur ce compte. Réactivez sa fiche avant de l’importer.',
                409,
              );
            if (
              existing.currency !== quote.currency ||
              (existing.metadata.ticker && existing.metadata.ticker !== quote.symbol)
            )
              throw new Error(
                'Une autre cotation de ce produit est déjà suivie sur ce compte. Vérifiez le ticker et la devise.',
              );
            const cost = row.costCurrency === 'USD' ? existing.costUsd : existing.costEur;
            const existingUnknown = existing.metadata.costBasis === 'UNKNOWN';
            if (
              !d(existing.quantity).eq(row.quantity) ||
              (row.acquisitionCost === null
                ? !existingUnknown
                : cost === null || d(cost).sub(row.acquisitionCost).abs().gt('0.01'))
            )
              throw new Error(
                'Une position différente existe déjà pour ce produit et ce compte. Utilisez les transactions pour la mettre à jour ; cet import ne double ni ne remplace vos positions.',
              );
          }
          rows.push({ ...row, quote, existingAssetId: existing?.id ?? null });
        } catch (error) {
          errors.push({
            line: row.line,
            message:
              error instanceof z.ZodError
                ? 'Réponse de cotation invalide.'
                : (error as Error).message,
          });
        }
      }),
    );
  }
  rows.sort((a, b) => a.line - b.line);
  const identities = new Set<string>();
  for (const row of rows) {
    const identity = `${row.platform}:${row.quote.symbol}`;
    if (identities.has(identity))
      errors.push({
        line: row.line,
        message:
          'Produit présent plusieurs fois pour le même compte. Regroupez les quantités et les coûts.',
      });
    identities.add(identity);
  }
  let rate: z.infer<typeof payloadSchema>['rate'] = null;
  if (
    rows.some(
      (row) => !row.existingAssetId && (row.quote.currency === 'USD' || row.costCurrency === 'USD'),
    )
  ) {
    try {
      const result = await fetchEcbRate();
      rate = { eurUsd: result.eurUsd, observedAt: result.observedAt.toISOString() };
    } catch {
      errors.push({
        line: 0,
        message:
          'Taux EUR/USD indisponible. Réessayez pour importer ces positions sans conversion approximative.',
      });
    }
  }
  return (await mutate(
    userId,
    key,
    'POST/securities/imports/preview',
    input,
    async (tx, portfolio) => {
      if (portfolio.version !== initial.portfolio.version)
        throw new AppError(
          'PREVIEW_STALE',
          'Le portefeuille a changé pendant la lecture du fichier. Relancez l’aperçu.',
          409,
        );
      const expiresAt = new Date(Date.now() + 30 * 60_000);
      const batch = await tx.importBatch.create({
        data: {
          portfolioId: portfolio.id,
          hash,
          ledgerVersion: portfolio.version + 1,
          expiresAt,
          payload: json({ kind: 'SECURITIES_POSITIONS', rows, rate }),
          errors: json(errors),
        },
      });
      return { id: batch.id, rows, errors, expiresAt: expiresAt.toISOString() };
    },
  )) as SecuritiesPreview;
}

export async function confirmSecurities(
  userId: string,
  batchId: string,
  input: unknown,
  key: string | null,
) {
  z.object({ confirmed: z.literal(true) })
    .strict()
    .parse(input);
  return mutate(
    userId,
    key,
    `POST/securities/imports/${batchId}/confirm`,
    input,
    async (tx, portfolio) => {
      const batch = await tx.importBatch.findFirst({
        where: { id: batchId, portfolioId: portfolio.id },
      });
      if (!batch) throw new AppError('NOT_FOUND', 'Aperçu introuvable.', 404);
      const parsed = payloadSchema.safeParse(batch.payload);
      if (!parsed.success)
        throw new AppError(
          'IMPORT_KIND',
          'Cet aperçu ne concerne pas un import de positions boursières.',
          422,
        );
      const payload = parsed.data;
      const result = {
        id: batch.id,
        created: payload.rows.filter((row) => !row.existingAssetId).length,
        skipped: payload.rows.filter((row) => row.existingAssetId).length,
      };
      if (batch.status === 'COMMITTED') return result;
      if (batch.expiresAt < new Date() || batch.ledgerVersion !== portfolio.version)
        throw new AppError(
          'PREVIEW_STALE',
          'Le portefeuille a changé ou l’aperçu a expiré. Relancez l’aperçu.',
          409,
        );
      if ((batch.errors as unknown[]).length)
        throw new AppError('IMPORT_INVALID', 'Corrigez les erreurs avant d’importer.', 422);
      const category = await tx.assetCategory.findUniqueOrThrow({
        where: { portfolioId_key: { portfolioId: portfolio.id, key: 'SECURITIES' } },
      });
      if (
        payload.rate &&
        !(await tx.fxRate.findFirst({
          where: {
            portfolioId: portfolio.id,
            source: 'ecb',
            observedAt: new Date(payload.rate.observedAt),
          },
        }))
      )
        await tx.fxRate.create({
          data: {
            portfolioId: portfolio.id,
            source: 'ecb',
            eurUsd: payload.rate.eurUsd,
            observedAt: new Date(payload.rate.observedAt),
          },
        });
      const occurredAt = new Date().toISOString();
      for (const row of payload.rows) {
        if (row.existingAssetId) continue;
        const quote = row.quote;
        const asset = await tx.asset.create({
          data: {
            portfolioId: portfolio.id,
            categoryId: category.id,
            name: row.name || quote.name,
            symbol: quote.symbol,
            currency: quote.currency,
            platform: row.platform,
            externalId: row.isin || quote.symbol,
            metadata: {
              ticker: quote.symbol,
              exchange: quote.exchange,
              ...(row.isin ? { isin: row.isin } : {}),
              instrumentType: quote.instrumentType,
              pricingMode: 'SECURITIES_MARKET',
              costBasis: row.acquisitionCost === null ? 'UNKNOWN' : 'KNOWN',
            },
          },
        });
        await insertTransaction(tx, portfolio.id, userId, {
          assetId: asset.id,
          type: 'ADJUSTMENT',
          quantity: row.quantity,
          unitPrice:
            row.acquisitionCost === null ? '0' : precise(d(row.acquisitionCost).div(row.quantity)),
          currency: row.costCurrency || quote.currency,
          platform: row.platform,
          occurredAt,
          settlement: 'EXTERNAL',
          externalReference: `securities:${batch.id}:${row.line}:${randomUUID()}`,
          comment:
            'Inventaire de positions importé par CSV. Date d’achat inconnue ; conversion du coût au taux disponible à la date d’import.',
        });
        await saveSecurityQuote(tx, asset, quote);
      }
      await validateLedger(tx, portfolio.id);
      if (result.created) await capture(tx, portfolio.id, portfolio.version + 1);
      await tx.importBatch.update({ where: { id: batch.id }, data: { status: 'COMMITTED' } });
      return result;
    },
  );
}
