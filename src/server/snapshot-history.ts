import { Prisma } from '@/generated/prisma/client';
import type { TxDb } from './portfolio-store';
import {
  summarizeSnapshot,
  summaryCategoryValues,
  type SnapshotSummary,
} from '@/domain/snapshot-summary';
import type { AppState } from '@/shared/types';

// Transitional projection for historical captures without summaries. Never transfers wallet
// positions, asset metadata, notes, prices or ledger flows. PostgreSQL still reads/toasts data.
export const snapshotProjection = Prisma.sql`jsonb_build_object(
  'rows', CASE WHEN jsonb_typeof(s.data->'rows') = 'array' THEN
    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'categoryId', r->'categoryId', 'category', jsonb_build_object('key', r->'category'->'key'),
      'quantity', r->'quantity', 'valueEur', r->'valueEur', 'valueUsd', r->'valueUsd'
    )), '[]'::jsonb) FROM jsonb_array_elements(s.data->'rows') r) ELSE NULL END,
  'cash', CASE WHEN jsonb_typeof(s.data->'cash') = 'array' THEN
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('valueEur', c->'valueEur', 'valueUsd', c->'valueUsd')), '[]'::jsonb)
     FROM jsonb_array_elements(s.data->'cash') c) ELSE NULL END,
  'onchain', jsonb_build_object('includedCount', s.data->'onchain'->'includedCount',
    'valueEur', s.data->'onchain'->'valueEur', 'valueUsd', s.data->'onchain'->'valueUsd')
)`;
type HistoryRow = {
  id: string;
  capturedAt: Date;
  referenceDay: string;
  kind: string;
  totalEur: string | null;
  totalUsd: string | null;
  investedEur: string | null;
  ledgerVersion: number;
  summary: SnapshotSummary | null;
  projection: unknown;
};
export async function snapshotHistory(
  tx: TxDb,
  ownerId: string,
  categories: AppState['categories'],
) {
  const rows = await tx.$queryRaw<HistoryRow[]>(Prisma.sql`
    SELECT s.id, s."capturedAt", s."referenceDay", s.kind, s."totalEur"::text,
      s."totalUsd"::text, s."investedEur"::text, s."ledgerVersion",
      CASE WHEN s.summary->>'version' = '1' THEN s.summary ELSE NULL END AS summary,
      CASE WHEN s.summary->>'version' = '1' THEN NULL ELSE ${snapshotProjection} END AS projection
    FROM "PortfolioSnapshot" s
    WHERE s."referenceOwnerId" = ${ownerId} AND s."referenceDay" IS NOT NULL
    ORDER BY s."capturedAt" ASC, s.id ASC
  `);
  return rows.map(({ summary, projection, ...snapshot }) => {
    const saved = summary ?? summarizeSnapshot(projection);
    return {
      ...snapshot,
      // Match Prisma Decimal JSON serialization (no fixed trailing decimal places).
      totalEur:
        snapshot.totalEur === null ? null : new Prisma.Decimal(snapshot.totalEur).toString(),
      totalUsd:
        snapshot.totalUsd === null ? null : new Prisma.Decimal(snapshot.totalUsd).toString(),
      investedEur:
        snapshot.investedEur === null ? null : new Prisma.Decimal(snapshot.investedEur).toString(),
      categoryValues: summaryCategoryValues(saved, categories),
      cashValues: saved.cashValues,
    };
  });
}
// One bounded batch, repeatable and safe to resume. Does not rewrite data or an existing summary.
export async function backfillSnapshotSummaries(tx: TxDb, batchSize = 100) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500)
    throw new Error('Invalid batch size');
  const rows = await tx.$queryRaw<{ id: string; projection: unknown }[]>(Prisma.sql`
    SELECT s.id, ${snapshotProjection} AS projection FROM "PortfolioSnapshot" s
    WHERE s.summary IS NULL ORDER BY s.id LIMIT ${batchSize}
  `);
  if (!rows.length) return 0;
  return tx.$executeRaw(Prisma.sql`
    UPDATE "PortfolioSnapshot" s SET summary = v.summary FROM (VALUES ${Prisma.join(
      rows.map(
        (row) =>
          Prisma.sql`(${row.id}::uuid, ${JSON.stringify(summarizeSnapshot(row.projection))}::jsonb)`,
      ),
    )}) AS v(id, summary) WHERE s.id = v.id AND s.summary IS NULL
  `);
}
