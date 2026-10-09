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
import { db } from './db';
import { owned } from './portfolio-store';
import { isinSchema, securityIsin } from '@/domain/security-identity';
import {
  resolveSecurity,
  securityQuoteSchema,
  marketSymbolSchema,
  SecurityListingChoice,
  type SecurityQuote,
} from '@/modules/prices/securities';
import { saveSecurityQuote } from './securities-market';
import {
  importAccounts,
  selectImportAccount,
  matchesImportAsset,
  persistImportAccount,
} from './import-accounts';

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
    accountId: z.uuid().optional(),
    listings: z
      .array(z.object({ isin: isinSchema, ticker: marketSymbolSchema }).strict())
      .max(100)
      .default([]),
    currency: z.enum(['EUR', 'USD']).optional(),
    source: z.enum(['GENERIC', 'BOURSORAMA']).default('GENERIC'),
  })
  .strict()
  .refine((v) => !!v.csv !== !!v.pdfBase64, 'Choisissez un CSV ou un avis PDF.')
  .refine(
    (v) => !v.pdfBase64 || !!v.platform || !!v.accountId,
    'Choisissez le compte destinataire de l’avis.',
  );
const assetPlanSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(120),
  symbol: z.string().min(1).max(100),
  platform: z.string(),
  currency: z.enum(['EUR', 'USD']),
  isin: z.string().optional(),
  ticker: marketSymbolSchema,
  accountId: z.uuid(),
  quote: securityQuoteSchema,
});
type AssetPlan = z.infer<typeof assetPlanSchema>;
const payloadSchema = z.object({
  kind: z.literal('TRANSACTION_SYNC_V2'),
  rows: z.array(z.object({ line: z.number().int(), data: transactionSchema, accountId: z.uuid() })),
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
  errors: { line: number; message: string; isin?: string; symbols?: string[] }[];
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
  // Les requêtes fournisseur sont hors verrou SQL. L'état est revérifié avant l'aperçu.
  const initial = path.length === 2 && path[1] === 'preview' ? await owned(userId) : null;
  const initialAssets = initial
    ? await db().asset.findMany({
        where: { portfolioId: initial.id, deletedAt: null },
        include: { category: true },
      })
    : [];
  const accounts = initial
    ? importAccounts(
        initial.id,
        await db().platform.findMany({ where: { portfolioId: initial.id } }),
        initialAssets,
      )
    : [];
  const quotes = new Map<number, SecurityQuote>();
  const quoteErrors = new Map<number, ImportPreview['errors'][number]>();
  if (initial) {
    const options = previewSchema.parse(input);
    if (new Set(options.listings.map((item) => item.isin)).size !== options.listings.length)
      throw new AppError('IMPORT_INVALID', 'Sélections de cotation répétées.', 422);
    let rows: ReturnType<typeof parseTransactionCsv>;
    try {
      rows = notice ? [{ line: 1, fields: notice }] : parseTransactionCsv(options.csv!);
    } catch (error) {
      throw new AppError('CSV_INVALID', (error as Error).message, 422);
    }
    const cache = new Map<string, Promise<SecurityQuote>>();
    for (const { line, fields: row } of rows) {
      try {
        if (!row.isin || row.asset_id) continue;
        const isin = isinSchema.parse(row.isin);
        const account = selectImportAccount(
          initial.id,
          accounts,
          row.platform || options.platform || '',
          row.account_id || options.accountId,
        );
        if (initialAssets.some((a) => matchesImportAsset(a, account, { isin }))) continue;
        const ticker =
          options.listings.find((item) => item.isin === isin)?.ticker || row.asset_symbol;
        const identity = JSON.stringify([isin, ticker]);
        if (!cache.has(identity)) cache.set(identity, resolveSecurity({ isin, ticker }));
        quotes.set(line, await cache.get(identity)!);
      } catch (error) {
        quoteErrors.set(line, {
          line,
          message: (error as Error).message,
          ...(error instanceof SecurityListingChoice
            ? { isin: isinSchema.parse(row.isin), symbols: error.symbols }
            : {}),
        });
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
        if (portfolio.version !== initial!.version)
          throw new AppError('PREVIEW_STALE', 'Le portefeuille a changé. Relancez l’aperçu.', 409);
        const assets = initialAssets;
        const existing = await history(tx, portfolio.id);
        const plans: AssetPlan[] = [],
          normalized: { line: number; data: ImportTransaction; accountId: string }[] = [],
          errors: ImportPreview['errors'] = [];
        for (const { line, fields: row } of parsed) {
          try {
            const account = selectImportAccount(
              portfolio.id,
              accounts,
              row.platform || options.platform || '',
              row.account_id || options.accountId,
            );
            const isin = row.isin ? isinSchema.parse(row.isin) : undefined;
            let matches = assets.filter((asset) =>
              matchesImportAsset(asset, account, {
                assetId: row.asset_id,
                isin,
                ticker: row.asset_symbol,
              }),
            );
            if (!matches.length && isin && !row.asset_id && quotes.has(line)) {
              matches = assets.filter(
                (asset) =>
                  asset.category.key === 'SECURITIES' &&
                  !securityIsin(asset) &&
                  matchesImportAsset(asset, account, { ticker: quotes.get(line)!.symbol }),
              );
            }
            // Conserve le libellé historique de la position pour le replay et les empreintes.
            const platform = matches[0]?.platform ?? account.name;
            if (matches.length > 1)
              throw new Error('Plusieurs actifs correspondent sur ce compte. Précisez asset_id.');
            let assetId = matches[0]?.id ?? null;
            if (!assetId && (row.asset_id || row.asset_symbol || isin)) {
              if (row.asset_id || !isin || !row.name)
                throw new Error(
                  'Actif introuvable. Créez sa fiche ou renseignez isin et name pour créer une fiche Bourse.',
                );
              if (quoteErrors.has(line)) {
                errors.push(quoteErrors.get(line)!);
                continue;
              }
              const quote = quotes.get(line);
              if (!quote) throw new Error('Cotation non vérifiée. Recréez l’aperçu.');
              if (quote.currency !== (row.currency || options.currency))
                throw new Error(
                  'La devise de la cotation diffère de celle de la transaction. Sélectionnez la bonne cotation.',
                );
              assetId = plannedAssetId(portfolio.id, account.id, isin);
              const plan = assetPlanSchema.parse({
                id: assetId,
                name: row.name,
                symbol: quote.symbol,
                platform,
                currency: row.currency || options.currency,
                isin,
                ticker: quote.symbol,
                accountId: account.id,
                quote,
              });
              const previous = plans.find((p) => p.id === assetId);
              if (
                previous &&
                (previous.currency !== plan.currency || previous.symbol !== plan.symbol)
              )
                throw new Error('Cotation ou devise incohérente pour le même produit.');
              if (!previous) plans.push(plan);
            }
            const data = normalizeCsvTransaction({ ...row, platform }, assetId, options);
            // Les anciennes références non namespacées restent valides sur leur compte.
            const legacy = existing.find(
              (t) =>
                t.platform === data.platform &&
                t.externalReference &&
                t.externalReference === data.externalReference,
            );
            const oldReference = sourceReference(
              options.source,
              data.platform,
              data.externalReference,
            );
            data.externalReference =
              legacy?.externalReference ??
              (existing.some(
                (t) => t.platform === data.platform && t.externalReference === oldReference,
              )
                ? oldReference
                : sourceReference(options.source, account.id, data.externalReference));
            normalized.push({ line, data, accountId: account.id });
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
            payload: json({ kind: 'TRANSACTION_SYNC_V2', rows: normalized, assets: plans }),
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
        const currentAssets = await tx.asset.findMany({
          where: { portfolioId: portfolio.id, deletedAt: null },
          include: { category: true },
        });
        const currentAccounts = importAccounts(
          portfolio.id,
          await tx.platform.findMany({ where: { portfolioId: portfolio.id } }),
          currentAssets,
        );
        for (const row of selected) {
          const saved = payload.rows.find((r) => r.line === row.line)!;
          const plan = payload.assets.find((p) => p.id === row.data.assetId);
          const account =
            currentAccounts.find((a) => a.id === saved.accountId) ??
            selectImportAccount(portfolio.id, currentAccounts, plan?.platform ?? row.data.platform);
          if (account.id !== saved.accountId)
            throw new AppError('PREVIEW_STALE', 'Le compte a changé. Recréez l’aperçu.', 409);
          if (plan) {
            const other = currentAssets.find(
              (a) =>
                a.id !== plan.id &&
                (matchesImportAsset(a, account, { isin: plan.isin }) ||
                  (a.category.key === 'SECURITIES' &&
                    !securityIsin(a) &&
                    matchesImportAsset(a, account, { ticker: plan.ticker }))),
            );
            const sameId = currentAssets.find((a) => a.id === plan.id);
            if (
              sameId &&
              (!matchesImportAsset(sameId, account, { isin: plan.isin }) ||
                sameId.currency !== plan.currency)
            )
              throw new AppError('PREVIEW_STALE', 'La fiche a changé. Recréez l’aperçu.', 409);
            if (other)
              throw new AppError(
                'PREVIEW_STALE',
                'Une position a été créée entre-temps. Recréez l’aperçu.',
                409,
              );
          } else if (
            row.data.assetId &&
            !currentAssets.some((a) =>
              matchesImportAsset(a, account, { assetId: row.data.assetId! }),
            )
          ) {
            throw new AppError(
              'PREVIEW_STALE',
              'La position ou le compte a changé. Recréez l’aperçu.',
              409,
            );
          }
          await persistImportAccount(tx, portfolio.id, account);
        }
        for (const plan of payload.assets.filter((p) =>
          selected.some((r) => r.data.assetId === p.id),
        )) {
          if (await tx.asset.findFirst({ where: { id: plan.id, portfolioId: portfolio.id } }))
            continue;
          const category = await tx.assetCategory.findUniqueOrThrow({
            where: { portfolioId_key: { portfolioId: portfolio.id, key: 'SECURITIES' } },
          });
          const created = await tx.asset.create({
            data: {
              id: plan.id,
              portfolioId: portfolio.id,
              categoryId: category.id,
              name: plan.name,
              symbol: plan.symbol,
              currency: plan.currency,
              platform: plan.platform,
              externalId: plan.isin,
              metadata: {
                accountId: plan.accountId,
                exchange: plan.quote.exchange,
                instrumentType: plan.quote.instrumentType,
                isin: plan.isin,
                ticker: plan.ticker,
                pricingMode: 'SECURITIES_MARKET',
                costBasis: 'KNOWN',
              },
            },
          });
          await saveSecurityQuote(tx, created, plan.quote);
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
