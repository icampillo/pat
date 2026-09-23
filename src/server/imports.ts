import { parse } from 'csv-parse/sync';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  mutate,
  prepareTransaction,
  insertTransaction,
  validateLedger,
  json,
  toLedger,
} from './portfolio';
import { replay, type LedgerTransaction } from '@/domain/ledger';
import { transactionSchema } from '@/shared/schemas';
import { AppError } from './errors';

const previewSchema = z.object({ csv: z.string().min(1).max(200_000) }).strict();
const columns = [
  'asset_id',
  'asset_symbol',
  'type',
  'quantity',
  'unit_price',
  'amount',
  'fees',
  'currency',
  'occurred_at',
  'platform',
  'destination',
  'settlement',
  'comment',
  'external_reference',
];
export type ImportPreview = {
  id: string;
  rows: {
    line: number;
    asset: string;
    type: string;
    quantity: string;
    amount: string;
    currency: string;
    occurredAt: string;
  }[];
  errors: { line: number; message: string }[];
  expiresAt: string;
};

export async function importCommand(
  userId: string,
  path: string[],
  input: unknown,
  key: string | null,
) {
  return mutate(userId, key, `POST/${path.join('/')}`, input, async (tx, portfolio) => {
    if (path.length === 2 && path[1] === 'preview') {
      const { csv } = previewSchema.parse(input);
      const hash = createHash('sha256')
        .update(
          csv
            .replace(/^\uFEFF/, '')
            .replaceAll('\r\n', '\n')
            .trim(),
        )
        .digest('hex');
      if (
        await tx.importBatch.findFirst({
          where: { portfolioId: portfolio.id, hash, status: 'COMMITTED' },
        })
      )
        throw new AppError('IMPORT_DUPLICATE', 'Ce fichier a déjà été importé.', 409);
      let rows: Record<string, string>[];
      try {
        rows = parse(csv, {
          bom: true,
          skip_empty_lines: true,
          trim: true,
          max_record_size: 16_000,
          columns: (headers: string[]) => {
            if (
              new Set(headers).size !== headers.length ||
              headers.some((h) => !columns.includes(h)) ||
              !['type', 'currency', 'occurred_at', 'platform', 'external_reference'].every((h) =>
                headers.includes(h),
              )
            )
              throw new Error('Headers');
            return headers;
          },
        });
      } catch {
        throw new AppError(
          'CSV_INVALID',
          'CSV invalide. Utilisez les colonnes du modèle et une virgule comme séparateur.',
          422,
        );
      }
      if (!rows.length || rows.length > 500)
        throw new AppError('CSV_SIZE', 'Importez entre 1 et 500 lignes à la fois.', 422);
      const assets = await tx.asset.findMany({
        where: { portfolioId: portfolio.id, deletedAt: null },
      });
      const existing = await tx.transaction.findMany({ where: { portfolioId: portfolio.id } });
      const references = new Set(existing.map((t) => t.externalReference).filter(Boolean));
      const errors: ImportPreview['errors'] = [],
        display: ImportPreview['rows'] = [];
      const payload: z.infer<typeof transactionSchema>[] = [],
        prepared: LedgerTransaction[] = [];
      for (const [index, row] of rows.entries()) {
        const line = index + 2;
        try {
          if (!row.external_reference || references.has(row.external_reference))
            throw new AppError('DUPLICATE', 'Référence externe absente ou déjà utilisée.');
          references.add(row.external_reference);
          const matches = assets.filter((a) =>
            row.asset_id
              ? a.id === row.asset_id
              : row.asset_symbol
                ? a.symbol === row.asset_symbol
                : false,
          );
          if ((row.asset_id || row.asset_symbol) && matches.length !== 1)
            throw new AppError('ASSET', 'Actif introuvable ou symbole ambigu : utilisez asset_id.');
          const data = transactionSchema.parse({
            assetId: matches[0]?.id || null,
            type: row.type,
            quantity: row.quantity || '0',
            unitPrice: row.unit_price || '0',
            amount: row.amount || '0',
            fees: row.fees || '0',
            currency: row.currency,
            occurredAt: row.occurred_at,
            platform: row.platform,
            destination: row.destination || null,
            settlement: row.settlement || 'EXTERNAL',
            comment: row.comment || '',
            externalReference: row.external_reference,
          });
          const ready = await prepareTransaction(tx, portfolio.id, data);
          prepared.push({
            ...ready,
            id: randomUUID(),
            fxToEur: String(ready.fxToEur),
            fxToUsd: ready.fxToUsd === null ? null : String(ready.fxToUsd),
            occurredAt: ready.occurredAt.toISOString(),
            sequence: Math.max(0, ...existing.map((t) => t.sequence)) + index + 1,
          });
          payload.push(data);
          display.push({
            line,
            asset: matches[0]?.name || 'Liquidités',
            type: data.type,
            quantity: data.quantity,
            amount: ready.amount,
            currency: data.currency,
            occurredAt: data.occurredAt,
          });
        } catch (error) {
          errors.push({
            line,
            message:
              error instanceof z.ZodError
                ? error.issues[0].message
                : error instanceof AppError
                  ? error.message
                  : 'Ligne invalide.',
          });
        }
      }
      if (!errors.length) {
        try {
          replay([...existing.filter((t) => !t.voided).map(toLedger), ...prepared]);
        } catch (error) {
          errors.push({ line: 0, message: (error as Error).message });
        }
      }
      const expiresAt = new Date(Date.now() + 30 * 60_000);
      const batch = await tx.importBatch.create({
        data: {
          portfolioId: portfolio.id,
          hash,
          ledgerVersion: portfolio.version + 1,
          payload: json(payload),
          errors: json(errors),
          expiresAt,
        },
      });
      return { id: batch.id, rows: display, errors, expiresAt: expiresAt.toISOString() };
    }
    if (path.length === 3 && path[2] === 'confirm') {
      z.object({ confirmed: z.literal(true) })
        .strict()
        .parse(input);
      const batch = await tx.importBatch.findFirst({
        where: { id: path[1], portfolioId: portfolio.id },
      });
      if (!batch) throw new AppError('NOT_FOUND', 'Aperçu introuvable.', 404);
      if (!Array.isArray(batch.payload))
        throw new AppError('IMPORT_KIND', 'Cet aperçu ne concerne pas des transactions.', 422);
      if (batch.status === 'COMMITTED')
        return { id: batch.id, count: (batch.payload as unknown[]).length };
      if (batch.expiresAt < new Date() || batch.ledgerVersion !== portfolio.version)
        throw new AppError(
          'PREVIEW_STALE',
          'Le portefeuille a changé ou l’aperçu a expiré. Recréez l’aperçu.',
          409,
        );
      if ((batch.errors as unknown[]).length)
        throw new AppError('IMPORT_INVALID', 'Corrigez toutes les erreurs avant d’importer.', 422);
      for (const row of batch.payload as unknown[])
        await insertTransaction(tx, portfolio.id, userId, row);
      await validateLedger(tx, portfolio.id);
      await tx.importBatch.update({ where: { id: batch.id }, data: { status: 'COMMITTED' } });
      return { id: batch.id, count: (batch.payload as unknown[]).length };
    }
    throw new AppError('NOT_FOUND', 'Action d’import introuvable.', 404);
  });
}
