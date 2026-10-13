import { Prisma } from '@/generated/prisma/client';
import { db } from './db';
import { owned, json } from './portfolio-store';
import { walletState } from './wallet-state';
import { zerionConfigured } from './zerion';
import { importAccounts } from './import-accounts';

export async function getPageState(userId: string, scope: 'settings' | 'wallets') {
  return db().$transaction(
    async (tx) => {
      const portfolio = await owned(userId, tx);
      const asOf = new Date();
      const rate = await tx.fxRate.findFirst({
        where: { portfolioId: portfolio.id, observedAt: { lte: asOf } },
        orderBy: { observedAt: 'desc' },
        select: { eurUsd: true, observedAt: true, source: true },
      });
      const [personal] = await tx.$queryRaw<{ present: boolean }[]>(Prisma.sql`
      SELECT EXISTS(SELECT 1 FROM "Asset" WHERE "portfolioId" = ${portfolio.id}::uuid
        AND metadata->>'costBasis' = 'UNKNOWN') AS present
    `);
      const shared = { portfolio, asOf, fxRate: rate, personalData: personal.present };
      if (scope === 'wallets')
        return json({
          ...shared,
          onchain: await walletState(tx, portfolio.id, asOf, rate ? String(rate.eurUsd) : null),
        });
      const [config, wallets, platforms, assets] = await Promise.all([
        tx.walletSyncConfig.findUnique({
          where: { portfolioId: portfolio.id },
          select: { enabled: true },
        }),
        tx.walletConnection.findMany({
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
        tx.platform.findMany({
          where: { portfolioId: portfolio.id },
          select: { id: true, name: true },
        }),
        tx.$queryRaw<{ platform: string; metadata: { accountId: string | null } }[]>(Prisma.sql`
        SELECT DISTINCT platform, jsonb_build_object('accountId', metadata->'accountId') AS metadata
        FROM "Asset" WHERE "portfolioId" = ${portfolio.id}::uuid
      `),
      ]);
      const configured = zerionConfigured();
      return json({
        ...shared,
        accounts: importAccounts(portfolio.id, platforms, assets),
        onchain: {
          wallets,
          config: {
            configured,
            hasKey: configured,
            enabled: config?.enabled ?? true,
            intervalMinutes: 1440,
            mode: 'API',
          },
        },
      });
    },
    { isolationLevel: 'RepeatableRead', timeout: 20_000 },
  );
}
