import { db } from './db';
import { owned } from './portfolio-store';
import type { WalletSyncStatus } from '@/shared/wallets';
import { Prisma } from '@/generated/prisma/client';
import type { OnchainState, WalletData } from '@/shared/wallets';
import { zerionConfigured } from './zerion';
import { decimal as d, precise } from '@/domain/money';
export async function walletState(
  tx: Prisma.TransactionClient,
  portfolioId: string,
  at: Date,
  eurUsd: string | null,
): Promise<OnchainState> {
  const config = await tx.walletSyncConfig.findUnique({
    where: { portfolioId },
    select: { enabled: true },
  });
  const rows = await tx.walletConnection.findMany({
    where: { portfolioId, deletedAt: null, createdAt: { lte: at } },
    orderBy: { createdAt: 'asc' },
  });
  // Per-parent LIMIT is executed by PostgreSQL, not by Prisma's relation materializer.
  const observations = rows.length
    ? await tx.$queryRaw<
        {
          walletId: string;
          fetchedAt: Date;
          data: unknown;
        }[]
      >(Prisma.sql`
    SELECT w.id AS "walletId", o."fetchedAt", o.data FROM "WalletConnection" w
    CROSS JOIN LATERAL (
      SELECT "fetchedAt", data FROM "WalletObservation" WHERE "walletId" = w.id
        AND "invalidatedAt" IS NULL AND "fetchedAt" <= ${at}
      ORDER BY "fetchedAt" DESC LIMIT 1
    ) o WHERE w."portfolioId" = ${portfolioId}::uuid AND w."deletedAt" IS NULL AND w."createdAt" <= ${at}
  `)
    : [];
  const latest = new Map(observations.map((observation) => [observation.walletId, observation]));
  const wallets = rows.map((w) => {
    const last = latest.get(w.id);
    return {
      id: w.id,
      address: w.address,
      label: w.label,
      enabled: w.enabled,
      included: w.included,
      referenceUsd: w.referenceUsd === null ? null : String(w.referenceUsd),
      referenceAt: w.referenceAt?.toISOString() || null,
      status: w.status,
      errorCode: w.errorCode,
      lastSuccessAt: last?.fetchedAt.toISOString() || null,
      nextSyncAt: w.nextSyncAt.toISOString(),
      stale: !last || at.getTime() - last.fetchedAt.getTime() > 48 * 60 * 60_000,
      data: last ? (last.data as unknown as WalletData) : null,
    };
  });
  const included = wallets.filter((w) => w.included);
  const missing = included.filter((w) => !w.data).length;
  const total = included.reduce((s, w) => s.add(w.data?.totalUsd || 0), d(0));
  return {
    wallets,
    config: {
      configured: zerionConfigured(),
      enabled: config?.enabled ?? true,
      mode: 'API',
      hasKey: zerionConfigured(),
      intervalMinutes: 1440,
    },
    includedCount: included.length,
    missing,
    staleCount: included.filter(
      (w) =>
        w.stale || w.status === 'ERROR' || w.status === 'PARTIAL' || w.data?.quality === 'partial',
    ).length,
    valueUsd: missing ? null : precise(total),
    valueEur: missing ? null : total.isZero() ? '0' : eurUsd ? precise(total.div(eurUsd)) : null,
  };
}

export async function walletSyncStatus(userId: string): Promise<WalletSyncStatus> {
  const portfolio = await owned(userId);
  const [config, wallets] = await Promise.all([
    db().walletSyncConfig.findUnique({
      where: { portfolioId: portfolio.id },
      select: { enabled: true },
    }),
    db().walletConnection.findMany({
      where: { portfolioId: portfolio.id, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        enabled: true,
        status: true,
        errorCode: true,
        lastSuccessAt: true,
        nextSyncAt: true,
      },
    }),
  ]);
  return {
    enabled: config?.enabled ?? true,
    wallets: wallets.map((wallet) => ({
      ...wallet,
      lastSuccessAt: wallet.lastSuccessAt?.toISOString() ?? null,
      nextSyncAt: wallet.nextSyncAt.toISOString(),
    })),
  };
}
