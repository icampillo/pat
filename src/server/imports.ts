import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { mutate, json, toLedger, UnchangedMutation, type TxDb } from './portfolio-store';
import { prepareTransaction, insertTransaction, validateLedger } from './portfolio';
import { replay, type LedgerTransaction } from '@/domain/ledger';
import { transactionSchema } from '@/shared/schemas';
import {
  parseTransactionCsv,
  normalizeCsvTransaction,
  type ImportTransaction,
} from '@/domain/transaction-csv';
import { matchTransactions, sourceReference, type Match } from './import-matching';
import { AppError } from './errors';
import { decimal as d, precise } from '@/domain/money';
import { readBoursoNotice } from './bourso-notice';

const previewSchema = z
  .object({
    csv: z.string().min(1).max(200_000).optional(),
    pdfBase64: z
      .string()
      .min(1)
      .max(200_000)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/)
      .optional(),
    platform: z.string().trim().min(1).max(120).optional(),
    currency: z.enum(['EUR', 'USD']).optional(),
    source: z.enum(['GENERIC', 'BOURSORAMA']).default('GENERIC'),
  })
  .strict()
  .refine((v) => !!v.csv !== !!v.pdfBase64, 'Choisissez un CSV ou un avis PDF.')
  .refine((v) => !v.pdfBase64 || !!v.platform, 'Choisissez le compte destinataire de l’avis.');
const assetPlanSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(120),
  symbol: z.string().min(1).max(100),
  platform: z.string(),
  currency: z.enum(['EUR', 'USD']),
  isin: z.string().optional(),
  ticker: z.string().optional(),
});
type AssetPlan = z.infer<typeof assetPlanSchema>;
const payloadSchema = z.object({
  kind: z.literal('TRANSACTION_SYNC_V1'),
  rows: z.array(z.object({ line: z.number().int(), data: transactionSchema })),
  assets: z.array(assetPlanSchema),
  result: z.object({ id: z.string(), count: z.number(), skipped: z.number() }).optional(),
});
export type ImportPreview = {
  id: string;
  rows: (Match & {
    asset: string;
    type: string;
    quantity: string;
    amount: string;
    currency: string;
    occurredAt: string;
  })[];
  summary: Record<'EXISTING' | 'NEW' | 'CHANGED' | 'AMBIGUOUS', number> & {
    reinforced: number;
    newPositions: number;
  };
  errors: { line: number; message: string }[];
  expiresAt: string;
};
const confirmSchema = z
  .object({
    confirmed: z.literal(true),
    decisions: z
      .array(
        z
          .object({ line: z.number().int().positive(), action: z.enum(['IGNORE', 'CREATE']) })
          .strict(),
      )
      .max(500)
      .default([]),
  })
  .strict();
async function history(tx: TxDb, portfolioId: string) {
  return (
    await tx.transaction.findMany({ where: { portfolioId }, orderBy: { sequence: 'asc' } })
  ).map((t) => ({
    ...toLedger(t),
    externalReference: t.externalReference,
    comment: t.comment,
    voided: t.voided,
    type: t.type as ImportTransaction['type'],
    currency: t.currency as ImportTransaction['currency'],
    settlement: t.settlement as ImportTransaction['settlement'],
  }));
}
function plannedAssetId(portfolioId: string, platform: string, identity: string) {
  const hash = createHash('sha256')
    .update(JSON.stringify([portfolioId, platform, identity]))
    .digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
export async function importCommand(
  userId: string,
  path: string[],
  input: unknown,
  key: string | null,
) {
  let notice: Record<string, string> | null = null;
  if (path.length === 2 && path[1] === 'preview') {
    const options = previewSchema.parse(input);
    if (options.pdfBase64) {
      try {
        notice = await readBoursoNotice(options.pdfBase64);
      } catch (error) {
        throw new AppError('PDF_INVALID', (error as Error).message, 422);
      }
    }
  }
  try {
    return await mutate(userId, key, `POST/${path.join('/')}`, input, async (tx, portfolio) => {
      if (path.length === 2 && path[1] === 'preview') {
        const options = previewSchema.parse(input);
        if (notice) options.source = 'BOURSORAMA';
        let parsed: ReturnType<typeof parseTransactionCsv>;
        try {
          parsed = notice ? [{ line: 1, fields: notice }] : parseTransactionCsv(options.csv!);
        } catch (error) {
          throw new AppError('CSV_INVALID', (error as Error).message, 422);
        }
        const assets = await tx.asset.findMany({
          where: { portfolioId: portfolio.id, deletedAt: null },
          include: { category: true },
        });
        const existing = await history(tx, portfolio.id);
        const plans: AssetPlan[] = [],
          normalized: { line: number; data: ImportTransaction }[] = [],
          errors: ImportPreview['errors'] = [];
        for (const { line, fields: row } of parsed) {
          try {
            const platform = row.platform || options.platform || '';
            const isin = row.isin?.toUpperCase();
            if (isin && !/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(isin)) throw new Error('ISIN invalide.');
            const matches = assets.filter((asset) => {
              const metadata = asset.metadata as Record<string, string>;
              return row.asset_id
                ? asset.id === row.asset_id
                : asset.platform === platform &&
                    (isin
                      ? metadata.isin === isin || asset.symbol === isin
                      : !!row.asset_symbol &&
                        asset.symbol.toUpperCase() === row.asset_symbol.toUpperCase());
            });
            if (matches.length > 1)
              throw new Error('Plusieurs actifs correspondent sur ce compte. Précisez asset_id.');
            let assetId = matches[0]?.id ?? null;
            if (!assetId && (row.asset_id || row.asset_symbol || isin)) {
              if (row.asset_id || !isin || !row.name)
                throw new Error(
                  'Actif introuvable. Créez sa fiche ou renseignez isin et name pour créer une fiche Bourse.',
                );
              assetId = plannedAssetId(portfolio.id, platform, isin);
              const plan = assetPlanSchema.parse({
                id: assetId,
                name: row.name,
                symbol: row.asset_symbol || isin,
                platform,
                currency: row.currency || options.currency,
                isin,
                ticker: row.asset_symbol,
              });
              const previous = plans.find((p) => p.id === assetId);
              if (
                previous &&
                (previous.currency !== plan.currency || previous.symbol !== plan.symbol)
              )
                throw new Error('Cotation ou devise incohérente pour le même produit.');
              if (!previous) plans.push(plan);
            }
            const data = normalizeCsvTransaction(row, assetId, options);
            // Les anciennes références non namespacées restent valides sur leur compte.
            const legacy = existing.find(
              (t) =>
                t.platform === data.platform &&
                t.externalReference &&
                t.externalReference === data.externalReference,
            );
            data.externalReference =
              legacy?.externalReference ??
              sourceReference(options.source, data.platform, data.externalReference);
            normalized.push({ line, data });
          } catch (error) {
            errors.push({
              line,
              message:
                error instanceof z.ZodError ? error.issues[0].message : (error as Error).message,
            });
          }
        }
        // Sans heure, convention stable : entrées avant sorties à date égale.
        // Fournir les heures réelles si l’ordre intrajournalier influence le PRU.
        const rank: Record<string, number> = {
          DEPOSIT: 0,
          BUY: 1,
          REWARD: 2,
          DIVIDEND: 3,
          SELL: 4,
          FEE: 5,
          WITHDRAWAL: 6,
        };
        normalized.sort(
          (a, b) =>
            a.data.occurredAt.localeCompare(b.data.occurredAt) ||
            (rank[a.data.type] ?? 7) - (rank[b.data.type] ?? 7) ||
            JSON.stringify(a.data).localeCompare(JSON.stringify(b.data)),
        );
        const matches = matchTransactions(normalized, existing);
        const prepared: LedgerTransaction[] = [];
        const lastSequence = existing.reduce((max, row) => Math.max(max, row.sequence), 0);
        for (const row of matches.filter((r) => r.status === 'NEW')) {
          try {
            // Les nouvelles fiches seront créées seulement à la confirmation. Vérifier ici
            // le taux historique, sans écrire une fiche provisoire ni inventer une cotation.
            const planned = plans.some((p) => p.id === row.data.assetId);
            const rate = planned
              ? await tx.fxRate.findFirst({
                  where: {
                    portfolioId: portfolio.id,
                    observedAt: { lte: new Date(row.data.occurredAt) },
                  },
                  orderBy: { observedAt: 'desc' },
                })
              : null;
            if (planned && row.data.currency === 'USD' && !rate)
              throw new Error('Saisissez un taux EUR/USD à la date de cette transaction.');
            const ready = planned
              ? {
                  ...row.data,
                  occurredAt: new Date(row.data.occurredAt),
                  fxToEur:
                    row.data.currency === 'EUR' ? '1' : precise(d(1).div(String(rate!.eurUsd))),
                  fxToUsd: row.data.currency === 'USD' ? '1' : rate ? String(rate.eurUsd) : null,
                }
              : await prepareTransaction(tx, portfolio.id, row.data);
            prepared.push({
              ...ready,
              id: randomUUID(),
              occurredAt: ready.occurredAt.toISOString(),
              fxToEur: String(ready.fxToEur),
              fxToUsd: ready.fxToUsd === null ? null : String(ready.fxToUsd),
              sequence: lastSequence + prepared.length + 1,
            });
          } catch (error) {
            errors.push({ line: row.line, message: (error as Error).message });
          }
        }
        if (!errors.length && !matches.some((r) => ['CHANGED', 'AMBIGUOUS'].includes(r.status))) {
          try {
            replay([...existing.filter((t) => !t.voided), ...prepared]);
          } catch (error) {
            errors.push({ line: 0, message: (error as Error).message });
          }
        }
        const newAssetIds = new Set(
          matches.filter((r) => r.status === 'NEW' && r.data.assetId).map((r) => r.data.assetId),
        );
        const knownAssetIds = new Set(existing.filter((t) => !t.voided).map((t) => t.assetId));
        const summary = {
          EXISTING: 0,
          NEW: 0,
          CHANGED: 0,
          AMBIGUOUS: 0,
          reinforced: [...newAssetIds].filter((id) => knownAssetIds.has(id)).length,
          newPositions: [...newAssetIds].filter((id) => !knownAssetIds.has(id)).length,
        };
        for (const row of matches) summary[row.status]++;
        const expiresAt = new Date(Date.now() + 30 * 60_000);
        const display = matches.map((r) => ({
          ...r,
          asset:
            assets.find((a) => a.id === r.data.assetId)?.name ??
            plans.find((a) => a.id === r.data.assetId)?.name ??
            'Liquidités',
          type: r.data.type,
          quantity: r.data.quantity,
          amount: r.data.amount,
          currency: r.data.currency,
          occurredAt: r.data.occurredAt,
        }));
        if (!errors.length && matches.every((r) => r.status === 'EXISTING'))
          throw new UnchangedMutation({
            id: 'unchanged',
            rows: display,
            summary,
            errors,
            expiresAt: expiresAt.toISOString(),
          });
        const batch = await tx.importBatch.create({
          data: {
            portfolioId: portfolio.id,
            hash: createHash('sha256').update(JSON.stringify(options)).digest('hex'),
            ledgerVersion: portfolio.version + 1,
            payload: json({ kind: 'TRANSACTION_SYNC_V1', rows: normalized, assets: plans }),
            errors: json(errors),
            expiresAt,
          },
        });
        return { id: batch.id, rows: display, summary, errors, expiresAt: expiresAt.toISOString() };
      }
      if (path.length === 3 && path[2] === 'confirm') {
        const { decisions } = confirmSchema.parse(input);
        const batch = await tx.importBatch.findFirst({
          where: { id: path[1], portfolioId: portfolio.id },
        });
        if (!batch) throw new AppError('NOT_FOUND', 'Aperçu introuvable.', 404);
        const parsed = payloadSchema.safeParse(batch.payload);
        if (!parsed.success)
          throw new AppError(
            'IMPORT_KIND',
            'Cet aperçu ne concerne pas la synchronisation de transactions ou date d’une ancienne version. Recréez l’aperçu.',
            422,
          );
        const payload = parsed.data;
        if (batch.status === 'COMMITTED') throw new UnchangedMutation(payload.result);
        if (batch.expiresAt < new Date())
          throw new AppError('PREVIEW_STALE', 'L’aperçu a expiré. Recréez l’aperçu.', 409);
        if (!Array.isArray(batch.errors) || batch.errors.length)
          throw new AppError('IMPORT_INVALID', 'Corrigez les erreurs avant d’importer.', 422);
        // Refaire le matching sous verrou : deux aperçus peuvent être confirmés simultanément.
        const matches = matchTransactions(payload.rows, await history(tx, portfolio.id));
        if (decisions.length && batch.ledgerVersion !== portfolio.version)
          throw new AppError(
            'PREVIEW_STALE',
            'Le journal a changé. Revérifiez les lignes à confirmer.',
            409,
          );
        if (
          new Set(decisions.map((r) => r.line)).size !== decisions.length ||
          decisions.some((decision) => !matches.some((r) => r.line === decision.line))
        )
          throw new AppError('IMPORT_DECISION', 'Décision de ligne invalide.', 422);
        for (const decision of decisions.filter((d) => d.action === 'CREATE')) {
          const row = matches.find((r) => r.line === decision.line)!;
          if (!row.canCreate)
            throw new AppError(
              'IMPORT_DECISION',
              'Cette ligne ne peut pas être ajoutée comme nouvelle transaction.',
              422,
            );
        }
        const selected = matches.filter(
          (r) =>
            r.status === 'NEW' || decisions.some((d) => d.line === r.line && d.action === 'CREATE'),
        );
        // Une édition concurrente n’est pas acceptée silencieusement. Les doublons résultant
        // d’un autre import peuvent en revanche être ignorés sans refaire l’aperçu.
        if (
          batch.ledgerVersion !== portfolio.version &&
          matches.some((r) => ['CHANGED', 'AMBIGUOUS'].includes(r.status))
        )
          throw new AppError('PREVIEW_STALE', 'Le journal a changé. Recréez l’aperçu.', 409);
        for (const plan of payload.assets.filter((p) =>
          selected.some((r) => r.data.assetId === p.id),
        )) {
          if (await tx.asset.findFirst({ where: { id: plan.id, portfolioId: portfolio.id } }))
            continue;
          const category = await tx.assetCategory.findUniqueOrThrow({
            where: { portfolioId_key: { portfolioId: portfolio.id, key: 'SECURITIES' } },
          });
          await tx.asset.create({
            data: {
              id: plan.id,
              portfolioId: portfolio.id,
              categoryId: category.id,
              name: plan.name,
              symbol: plan.symbol,
              currency: plan.currency,
              platform: plan.platform,
              metadata: {
                isin: plan.isin,
                ticker: plan.ticker,
                pricingMode: 'MANUAL',
                costBasis: 'KNOWN',
              },
            },
          });
          await tx.platform.upsert({
            where: { portfolioId_name: { portfolioId: portfolio.id, name: plan.platform } },
            create: { portfolioId: portfolio.id, name: plan.platform },
            update: {},
          });
        }
        for (const row of selected) await insertTransaction(tx, portfolio.id, userId, row.data);
        if (selected.length) await validateLedger(tx, portfolio.id);
        const result = {
          id: batch.id,
          count: selected.length,
          skipped: matches.length - selected.length,
        };
        await tx.importBatch.update({
          where: { id: batch.id },
          data: { status: 'COMMITTED', payload: json({ ...payload, result }) },
        });
        return result;
      }
      throw new AppError('NOT_FOUND', 'Action d’import introuvable.', 404);
    });
  } catch (error) {
    if (error instanceof UnchangedMutation) return error.result;
    throw error;
  }
}
