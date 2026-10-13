import { z } from 'zod';
import { Prisma } from '@/generated/prisma/client';
import { db } from './db';
import { owned, json } from './portfolio-store';
import { AppError } from './errors';

const cursorSchema = z.object({ date: z.iso.datetime(), id: z.uuid() });
export async function assetPrices(userId: string, assetId: string, cursor: string | null) {
  if (!z.uuid().safeParse(assetId).success)
    throw new AppError('NOT_FOUND', 'Actif introuvable.', 404);
  let before: z.infer<typeof cursorSchema> | undefined;
  if (cursor) {
    try {
      if (cursor.length > 512) throw new Error();
      before = cursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString()));
    } catch {
      throw new AppError('INVALID_CURSOR', 'Page d’historique invalide.', 400);
    }
  }
  return db().$transaction(
    async (tx) => {
      const p = await owned(userId, tx);
      const asset = await tx.asset.findFirst({
        where: { id: assetId, portfolioId: p.id },
        select: { id: true },
      });
      if (!asset) throw new AppError('NOT_FOUND', 'Actif introuvable.', 404);
      const rows = await tx.priceHistory.findMany({
        where: {
          portfolioId: p.id,
          assetId,
          ...(before
            ? {
                OR: [
                  { observedAt: { lt: new Date(before.date) } },
                  { observedAt: new Date(before.date), id: { lt: before.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ observedAt: 'desc' }, { id: 'desc' }],
        take: 51,
        select: { id: true, price: true, observedAt: true, source: true },
      });
      const items = rows.slice(0, 50);
      const last = items.at(-1);
      return json({
        items,
        nextCursor:
          rows.length > 50 && last
            ? Buffer.from(
                JSON.stringify({ date: last.observedAt.toISOString(), id: last.id }),
              ).toString('base64url')
            : null,
      });
    },
    { isolationLevel: 'RepeatableRead' },
  );
}
export async function walletHistory(userId: string, walletId: string) {
  if (!z.uuid().safeParse(walletId).success)
    throw new AppError('NOT_FOUND', 'Wallet introuvable.', 404);
  return db().$transaction(
    async (tx) => {
      const p = await owned(userId, tx);
      const wallet = await tx.walletConnection.findFirst({
        where: { id: walletId, portfolioId: p.id, deletedAt: null },
        select: { id: true },
      });
      if (!wallet) throw new AppError('NOT_FOUND', 'Wallet introuvable.', 404);
      // Last actual observation of each Paris day; no invented point, average or current FX.
      const points = await tx.$queryRaw<{ date: Date; value: string }[]>(Prisma.sql`
      SELECT "fetchedAt" AS date, "totalUsd"::text AS value FROM (
        SELECT DISTINCT ON (("fetchedAt" AT TIME ZONE 'Europe/Paris')::date)
          "fetchedAt", "totalUsd", id FROM "WalletObservation"
        WHERE "walletId" = ${walletId}::uuid AND "invalidatedAt" IS NULL AND "fetchedAt" <= now()
        ORDER BY ("fetchedAt" AT TIME ZONE 'Europe/Paris')::date, "fetchedAt" DESC, id DESC
      ) daily ORDER BY "fetchedAt" ASC
    `);
      return json({ points, asOf: new Date().toISOString() });
    },
    { isolationLevel: 'RepeatableRead' },
  );
}
