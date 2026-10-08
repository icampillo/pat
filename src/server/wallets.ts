import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from './db';
import { AppError } from './errors';
import { json, mutate } from './portfolio-store';
import { addressSchema, fetchZerion, ZerionError } from './zerion';
import type { WalletData } from '@/shared/wallets';
import { compareWalletCoverage } from './wallet-coverage';

const createSchema = z.object({
  address: addressSchema,
  label: z.string().trim().max(80).default(''),
  referenceUsd: z
    .string()
    .regex(/^\d{1,15}(\.\d{1,2})?$/)
    .optional(),
  included: z.boolean().default(true),
});
const configSchema = z.object({ enabled: z.boolean() }).strict();
const nextDay = (at: Date) =>
  new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 1));
type WalletProvider = (address: string) => Promise<WalletData>;
export async function walletCommand(
  userId: string,
  method: string,
  path: string[],
  input: unknown,
  key: string | null,
) {
  return mutate(userId, key, `${method}/${path.join('/')}`, input, async (tx, p) => {
    if (path.join('/') === 'zerion/config' && ['PATCH', 'DELETE'].includes(method)) {
      const data = method === 'DELETE' ? { enabled: false } : configSchema.parse(input);
      await tx.walletSyncConfig.upsert({
        where: { portfolioId: p.id },
        create: { portfolioId: p.id, ...data },
        update: { ...data, revision: { increment: 1 } },
      });
      // Invalidate in-flight publications, not their shared address lock or their daily schedule.
      await tx.walletConnection.updateMany({
        where: { portfolioId: p.id, deletedAt: null },
        data: { leaseToken: null, leaseUntil: null, status: 'PENDING' },
      });
      return { configured: true };
    }
    if (path[0] !== 'wallets') throw new AppError('NOT_FOUND', 'Action introuvable.', 404);
    if (path.length === 1 && method === 'POST') {
      const data = createSchema.parse(input);
      if (
        (await tx.walletConnection.count({ where: { portfolioId: p.id, deletedAt: null } })) >= 20
      )
        throw new AppError('LIMIT', 'Vous pouvez suivre jusqu’à 20 adresses.');
      const previous = await tx.walletConnection.findUnique({
        where: { portfolioId_address: { portfolioId: p.id, address: data.address } },
      });
      if (previous && !previous.deletedAt)
        throw new AppError('DUPLICATE', 'Cette adresse est déjà suivie.', 409);
      await tx.walletSyncConfig.upsert({
        where: { portfolioId: p.id },
        create: { portfolioId: p.id },
        update: {},
      });
      const fields = {
        address: data.address,
        label: data.label || `${data.address.slice(0, 6)}…${data.address.slice(-4)}`,
        included: data.included,
        referenceUsd: data.referenceUsd || null,
        referenceAt: data.referenceUsd ? new Date() : null,
        enabled: true,
        deletedAt: null,
        nextSyncAt: new Date(),
        status: 'PENDING',
        errorCode: null,
      };
      const row = previous
        ? await tx.walletConnection.update({ where: { id: previous.id }, data: fields })
        : await tx.walletConnection.create({ data: { ...fields, portfolioId: p.id } });
      return { id: row.id };
    }
    if (!path[1] || !z.uuid().safeParse(path[1]).success)
      throw new AppError('NOT_FOUND', 'Wallet introuvable.', 404);
    const wallet = await tx.walletConnection.findFirst({
      where: { id: path[1], portfolioId: p.id, deletedAt: null },
    });
    if (!wallet) throw new AppError('NOT_FOUND', 'Wallet introuvable.', 404);
    if (path.length === 3 && path[2] === 'sync' && method === 'POST') {
      const config = await tx.walletSyncConfig.findUnique({ where: { portfolioId: p.id } });
      if (!config?.enabled || !wallet.enabled)
        throw new AppError('PAUSED', 'Activez Zerion et la synchronisation de ce wallet.');
      if (wallet.lastAttemptAt && Date.now() - wallet.lastAttemptAt.getTime() < 300_000)
        throw new AppError('COOLDOWN', 'Attendez cinq minutes entre deux synchronisations.', 429);
      await tx.walletConnection.update({
        where: { id: wallet.id },
        data: { nextSyncAt: new Date() },
      });
      return { id: wallet.id, queued: true };
    }
    if (path.length === 2 && method === 'PATCH') {
      const data = z
        .object({
          label: z.string().trim().min(1).max(80).optional(),
          enabled: z.boolean().optional(),
          included: z.boolean().optional(),
        })
        .strict()
        .parse(input);
      await tx.walletConnection.update({
        where: { id: wallet.id },
        data: {
          ...data,
          ...(data.enabled !== undefined
            ? { leaseToken: null, leaseUntil: null, status: 'PENDING' }
            : {}),
        },
      });
      return { id: wallet.id };
    }
    if (path.length === 2 && method === 'DELETE') {
      await tx.walletConnection.update({
        where: { id: wallet.id },
        data: {
          deletedAt: new Date(),
          enabled: false,
          included: false,
          leaseToken: null,
          leaseUntil: null,
        },
      });
      return { id: wallet.id };
    }
    throw new AppError('NOT_FOUND', 'Action introuvable.', 404);
  });
}

// A database lease prevents parallel Next instances or manual refreshes from paying twice.
export async function syncWallet(id: string, provider?: WalletProvider) {
  return (await syncWalletResult(id, provider)) === 'succeeded';
}

async function syncWalletResult(
  id: string,
  provider?: WalletProvider,
): Promise<'succeeded' | 'failed' | 'skipped'> {
  const wallet = await db().walletConnection.findUnique({ where: { id } });
  if (!wallet) return 'skipped';
  const config = await db().walletSyncConfig.findUnique({
    where: { portfolioId: wallet.portfolioId },
  });
  if (!config?.enabled) return 'skipped';
  const now = new Date(),
    leaseToken = randomUUID();
  const claimed = await db().walletConnection.updateMany({
    where: {
      id,
      deletedAt: null,
      enabled: true,
      nextSyncAt: { lte: now },
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
    },
    data: {
      leaseToken,
      leaseUntil: new Date(now.getTime() + 180_000),
      lastAttemptAt: now,
      status: 'SYNCING',
    },
  });
  if (!claimed.count) return 'skipped';
  try {
    const fetched = await fetchAddress(wallet.address, provider || fetchZerion);
    if (!fetched) {
      await db().walletConnection.updateMany({
        where: { id, leaseToken },
        data: {
          leaseToken: null,
          leaseUntil: null,
          status: 'PENDING',
          nextSyncAt: new Date(Date.now() + 60_000),
        },
      });
      return 'skipped';
    }
    const data = fetched.data;
    const fetchedAt = fetched.fetchedAt;
    return await db().$transaction(
      async (tx) => {
        // The same portfolio lock as user mutations prevents a late sync from undoing a pause/key change.
        const p = await tx.portfolio.update({
          where: { id: wallet.portfolioId },
          data: { version: { increment: 1 } },
        });
        const currentConfig = await tx.walletSyncConfig.findUnique({
          where: { portfolioId: p.id },
        });
        const current = await tx.walletConnection.findUnique({ where: { id } });
        if (
          !currentConfig?.enabled ||
          currentConfig.revision !== config.revision ||
          !current?.enabled ||
          current.deletedAt ||
          current.leaseToken !== leaseToken
        )
          return 'skipped';
        const previous = await tx.walletObservation.findFirst({
          where: { walletId: id, invalidatedAt: null },
          orderBy: { fetchedAt: 'desc' },
        });
        const coverageWarnings = previous
          ? compareWalletCoverage(previous.data as unknown as WalletData, data)
          : [];
        const observation: WalletData = {
          ...data,
          warnings: [...(data.warnings || []), ...coverageWarnings],
          quality: data.quality === 'partial' || coverageWarnings.length ? 'partial' : 'complete',
        };
        await tx.walletObservation.create({
          data: { walletId: id, fetchedAt, totalUsd: data.totalUsd, data: json(observation) },
        });
        await tx.walletConnection.update({
          where: { id },
          data: {
            leaseToken: null,
            leaseUntil: null,
            status: observation.quality === 'partial' ? 'PARTIAL' : 'OK',
            errorCode: null,
            failureCount: 0,
            lastSuccessAt: fetchedAt,
            nextSyncAt: nextDay(fetchedAt),
          },
        });
        // Successful observations feed live valuation. Portfolio captures are scheduled
        // separately (daily/manual) or triggered by a change in the included wallet perimeter.
        return 'succeeded';
      },
      { timeout: 30_000 },
    );
  } catch (error) {
    const code = error instanceof ZerionError ? error.code : 'NETWORK';
    const failures = Math.min(wallet.failureCount + 1, 10);
    const retryMs = Math.max(
      error instanceof ZerionError ? error.retryAfterMs : 0,
      ['AUTH', 'ACCESS', 'KEY', 'QUOTA'].includes(code)
        ? nextDay(new Date()).getTime() - Date.now()
        : Math.min(360, 5 * 2 ** failures) * 60_000,
    );
    await db().walletConnection.updateMany({
      where: { id, leaseToken },
      data: {
        status: 'ERROR',
        errorCode: code,
        failureCount: failures,
        leaseToken: null,
        leaseUntil: null,
        nextSyncAt: new Date(Date.now() + retryMs),
      },
    });
    console.warn(JSON.stringify({ job: 'wallets', code }));
    return 'failed';
  }
}
export async function syncDueWallets(provider?: WalletProvider) {
  const started = Date.now();
  const now = new Date();
  const due = await db().walletConnection.findMany({
    where: {
      deletedAt: null,
      enabled: true,
      nextSyncAt: { lte: now },
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
      portfolio: { walletSync: { is: { enabled: true } } },
    },
    orderBy: [{ nextSyncAt: 'asc' }, { id: 'asc' }],
    take: 21,
    select: { id: true },
  });
  const result = { processed: 0, succeeded: 0, failed: 0, skipped: 0, hasMore: due.length > 20 };
  // Sequential wallets; the database request gate also limits simultaneous Vercel instances.
  for (const wallet of due.slice(0, 20)) {
    // Reserve 90 s for one complete API read + DB commit, below maxDuration=300.
    if (Date.now() - started >= 180_000) {
      result.hasMore = true;
      break;
    }
    result.processed++;
    try {
      result[await syncWalletResult(wallet.id, provider)]++;
    } catch {
      result.failed++;
      console.warn(JSON.stringify({ job: 'wallets', code: 'WALLET_SYNC_FAILED' }));
    }
  }
  return result;
}

// A shared address lease prevents duplicate calls across different portfolios/instances.
// Cache is brief and contains only normalized public positions, never credentials.
async function fetchAddress(address: string, provider: WalletProvider) {
  const now = new Date(),
    leaseToken = randomUUID();
  const cached = await db().zerionAddressCache.upsert({
    where: { address },
    create: { address },
    update: {},
  });
  if (cached.data && cached.fetchedAt && now.getTime() - cached.fetchedAt.getTime() < 300_000)
    return { data: cached.data as unknown as WalletData, fetchedAt: cached.fetchedAt };
  const claimed = await db().zerionAddressCache.updateMany({
    where: {
      address,
      AND: [
        { OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
        { OR: [{ fetchedAt: null }, { fetchedAt: { lte: new Date(now.getTime() - 300_000) } }] },
      ],
    },
    data: { leaseToken, leaseUntil: new Date(now.getTime() + 150_000) },
  });
  if (!claimed.count) return null;
  try {
    const data = await provider(address),
      fetchedAt = new Date();
    const published = await db().zerionAddressCache.updateMany({
      where: { address, leaseToken },
      data: { data: json(data), fetchedAt, leaseToken: null, leaseUntil: null },
    });
    if (!published.count) return null;
    return { data, fetchedAt };
  } finally {
    await db().zerionAddressCache.updateMany({
      where: { address, leaseToken },
      data: { leaseToken: null, leaseUntil: null },
    });
  }
}
