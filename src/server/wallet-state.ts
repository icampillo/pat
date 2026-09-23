import type { Prisma } from '@/generated/prisma/client';
import type { OnchainState, WalletData } from '@/shared/wallets';
import { decimal as d, precise } from '@/domain/money';
export async function walletState(
  tx: Prisma.TransactionClient,
  portfolioId: string,
  at: Date,
  eurUsd: string | null,
): Promise<OnchainState> {
  const config = await tx.deBankConfig.findUnique({
    where: { portfolioId },
    select: { enabled: true, intervalMinutes: true, mode: true, encryptedKey: true },
  });
  const rows = await tx.walletConnection.findMany({
    where: { portfolioId, deletedAt: null, createdAt: { lte: at } },
    orderBy: { createdAt: 'asc' },
    include: {
      observations: {
        where: { invalidatedAt: null, fetchedAt: { lte: at } },
        orderBy: { fetchedAt: 'desc' },
        take: 1,
      },
    },
  });
  const wallets = rows.map((w) => {
    const last = w.observations[0];
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
      stale:
        !last ||
        at.getTime() - last.fetchedAt.getTime() > (config?.intervalMinutes || 60) * 120_000,
      data: last ? (last.data as unknown as WalletData) : null,
    };
  });
  const included = wallets.filter((w) => w.included);
  const missing = included.filter((w) => !w.data).length;
  const total = included.reduce((s, w) => s.add(w.data?.totalUsd || 0), d(0));
  return {
    wallets,
    config: {
      configured: config?.mode !== 'API' || !!config.encryptedKey,
      enabled: config?.enabled ?? true,
      mode: config?.mode === 'API' ? 'API' : 'PUBLIC',
      hasKey: !!config?.encryptedKey,
      intervalMinutes: config?.intervalMinutes || 60,
    },
    includedCount: included.length,
    missing,
    staleCount: included.filter((w) => w.stale || w.status === 'ERROR').length,
    valueUsd: missing ? null : precise(total),
    valueEur: missing ? null : total.isZero() ? '0' : eurUsd ? precise(total.div(eurUsd)) : null,
  };
}
