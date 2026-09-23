import { stringify } from 'csv-stringify/sync';
import { db } from './db';
import { owned, valuation, json } from './portfolio';
import { AppError } from './errors';
export function safeCsv(rows: Record<string, unknown>[]) {
  return (
    '\uFEFF' +
    stringify(
      rows.map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([key, value]) => {
            const s = value === null || value === undefined ? '' : String(value);
            return [
              key,
              /^[\s]*[=+@\t\r]/.test(s) || /^\s*-(?!\d+(?:\.\d+)?$)/.test(s) ? `'${s}` : s,
            ];
          }),
        ),
      ),
      { header: true, quoted: true },
    )
  );
}
export async function exportData(userId: string, file: string) {
  const payload = await db().$transaction(
    async (tx) => {
      const p = await owned(userId, tx);
      if (file === 'assets.csv') {
        const state = await valuation(tx, p.id);
        return safeCsv(
          state.rows.map((a) => ({
            id: a.id,
            name: a.name,
            symbol: a.symbol,
            category: a.category.label,
            currency: a.currency,
            quantity: a.quantity,
            average_price: a.averagePrice,
            current_price: a.price,
            current_value_eur: a.valueEur,
            current_value_usd: a.valueUsd,
            platform: a.platform,
            notes: a.notes,
            status: a.deletedAt ? 'DELETED' : a.status,
          })),
        );
      }
      if (file === 'transactions.csv') {
        const rows = await tx.transaction.findMany({
          where: { portfolioId: p.id },
          include: { asset: { select: { name: true } } },
          orderBy: { occurredAt: 'asc' },
        });
        return safeCsv(
          rows.map((t) => ({
            id: t.id,
            asset: t.asset?.name || 'Liquidités',
            type: t.type,
            quantity: t.quantity,
            unit_price: t.unitPrice,
            amount: t.amount,
            fees: t.fees,
            currency: t.currency,
            occurred_at: t.occurredAt.toISOString(),
            platform: t.platform,
            comment: t.comment,
            voided: t.voided,
            external_reference: t.externalReference,
          })),
        );
      }
      if (file === 'history.csv') {
        const rows = await tx.portfolioSnapshot.findMany({
          where: { portfolioId: p.id },
          orderBy: { capturedAt: 'asc' },
        });
        return safeCsv(
          rows.map((s) => ({
            id: s.id,
            captured_at: s.capturedAt.toISOString(),
            kind: s.kind,
            total_eur: s.totalEur,
            total_usd: s.totalUsd,
            invested_eur: s.investedEur,
            net_flows_eur: s.netFlowsEur,
            detail_json: JSON.stringify(s.data),
          })),
        );
      }
      if (file === 'portfolio.json') {
        const [assets, transactions, snapshots, fxRates, categories, platforms, audits] =
          await Promise.all([
            tx.asset.findMany({
              where: { portfolioId: p.id },
              include: { prices: true, image: true },
            }),
            tx.transaction.findMany({ where: { portfolioId: p.id }, include: { revisions: true } }),
            tx.portfolioSnapshot.findMany({ where: { portfolioId: p.id } }),
            tx.fxRate.findMany({ where: { portfolioId: p.id } }),
            tx.assetCategory.findMany({ where: { portfolioId: p.id } }),
            tx.platform.findMany({ where: { portfolioId: p.id } }),
            tx.auditLog.findMany({ where: { portfolioId: p.id } }),
          ]);
        return JSON.stringify(
          json({
            schemaVersion: 2,
            exportedAt: new Date(),
            portfolio: p,
            categories,
            platforms,
            assets: assets.map((a) => ({
              ...a,
              image: a.image
                ? {
                    updatedAt: a.image.updatedAt,
                    mimeType: 'image/webp',
                    base64: Buffer.from(a.image.content).toString('base64'),
                  }
                : null,
            })),
            transactions,
            snapshots,
            fxRates,
            audits,
            wallets: await tx.walletConnection.findMany({
              where: { portfolioId: p.id },
              select: {
                id: true,
                address: true,
                label: true,
                enabled: true,
                included: true,
                createdAt: true,
                deletedAt: true,
                referenceUsd: true,
                referenceAt: true,
                observations: true,
              },
            }),
          }),
          null,
          2,
        );
      }
      throw new AppError('NOT_FOUND', 'Export introuvable.', 404);
    },
    { isolationLevel: 'RepeatableRead', timeout: 30_000 },
  );
  return new Response(payload, {
    headers: {
      'Content-Type': file.endsWith('.json')
        ? 'application/json; charset=utf-8'
        : 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="patrimoine-${file}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
