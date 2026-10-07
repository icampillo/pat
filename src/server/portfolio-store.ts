import { db } from './db';
import type { Prisma, Transaction } from '@/generated/prisma/client';
import type { LedgerTransaction } from '@/domain/ledger';
import { AppError } from './errors';
import { createHash } from 'node:crypto';

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
// Sortie sans écriture : annule aussi version, audit et clé d’idempotence.
export class UnchangedMutation extends Error {
  constructor(readonly result: unknown) {
    super('Aucune modification');
  }
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
      if (error instanceof UnchangedMutation) return error.result;
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      if (code === 'P2034' && attempt < 2) continue;
      if (code === 'P2002') throw new AppError('DUPLICATE', 'Cette référence existe déjà.', 409);
      throw error;
    }
  }
}
export function checkVersion(version: number, expected: string | null) {
  if (!expected) throw new AppError('VERSION_REQUIRED', 'Version de la ressource manquante.', 428);
  if (String(version) !== expected.replaceAll('"', ''))
    throw new AppError('STALE_VERSION', 'La ressource a changé. Rechargez la page.', 412);
}
