import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from './db';
import { AppError } from './errors';
import { capture, json, mutate } from './portfolio';
import { addressSchema, fetchDeBank, DeBankError } from './debank';
import { encryptKey, decryptKey } from './wallet-crypto';

const createSchema = z.object({
  address: addressSchema,
  label: z.string().trim().max(80).default(''),
  referenceUsd: z
    .string()
    .regex(/^\d{1,15}(\.\d{1,2})?$/)
    .optional(),
  included: z.boolean().default(true),
});
const configSchema = z.object({
  mode: z.enum(['PUBLIC', 'API']).default('PUBLIC'),
  accessKey: z
    .string()
    .trim()
    .min(8)
    .max(512)
    .regex(/^[\x21-\x7e]+$/)
    .optional(),
  enabled: z.boolean(),
  intervalMinutes: z.union([z.literal(15), z.literal(60), z.literal(240)]),
});
export async function walletCommand(
  userId: string,
  method: string,
  path: string[],
  input: unknown,
  key: string | null,
) {
  return mutate(userId, key, `${method}/${path.join('/')}`, input, async (tx, p) => {
    if (path.join('/') === 'debank/config' && method === 'PATCH') {
      const data = configSchema.parse(input);
      const previous = await tx.deBankConfig.findUnique({ where: { portfolioId: p.id } });
      if (data.mode === 'API' && !data.accessKey && !previous?.encryptedKey)
        throw new AppError('KEY_REQUIRED', 'Renseignez votre clé DeBank Cloud.');
      const settings = {
        mode: data.mode,
        enabled: data.enabled,
        intervalMinutes: data.intervalMinutes,
        ...(data.accessKey ? { encryptedKey: encryptKey(data.accessKey, p.id) } : {}),
      };
      await tx.deBankConfig.upsert({
        where: { portfolioId: p.id },
        create: {
          portfolioId: p.id,
          ...settings,
          encryptedKey: settings.encryptedKey || previous?.encryptedKey || null,
        },
        update: { ...settings, revision: { increment: 1 } },
      });
      await tx.walletConnection.updateMany({
        where: { portfolioId: p.id, deletedAt: null },
        data: {
          leaseToken: null,
          leaseUntil: null,
          status: 'PENDING',
          errorCode: null,
          failureCount: 0,
          nextSyncAt: new Date(),
        },
      });
      return { configured: true };
    }
    if (path.join('/') === 'debank/config' && method === 'DELETE') {
      await tx.deBankConfig.upsert({
        where: { portfolioId: p.id },
        create: { portfolioId: p.id, mode: 'PUBLIC', enabled: false },
        update: { encryptedKey: null, mode: 'PUBLIC', enabled: false, revision: { increment: 1 } },
      });
      await tx.walletConnection.updateMany({
        where: { portfolioId: p.id },
        data: { leaseToken: null, leaseUntil: null, status: 'PENDING', errorCode: null },
      });
      return { configured: false };
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
      await tx.deBankConfig.upsert({
        where: { portfolioId: p.id },
        create: { portfolioId: p.id, mode: 'PUBLIC' },
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
      // Inclusion is a structural change, even before the first observation (unknown value).
      if (row.included) await capture(tx, p.id, p.version + 1, 'WALLET');
      return { id: row.id };
    }
    if (!path[1] || !z.uuid().safeParse(path[1]).success)
      throw new AppError('NOT_FOUND', 'Wallet introuvable.', 404);
    const wallet = await tx.walletConnection.findFirst({
      where: { id: path[1], portfolioId: p.id, deletedAt: null },
    });
    if (!wallet) throw new AppError('NOT_FOUND', 'Wallet introuvable.', 404);
    if (path.length === 3 && path[2] === 'sync' && method === 'POST') {
      const config = await tx.deBankConfig.findUnique({ where: { portfolioId: p.id } });
      if (!config?.enabled || !wallet.enabled)
        throw new AppError('PAUSED', 'Activez DeBank et la synchronisation de ce wallet.');
      if (wallet.lastAttemptAt && Date.now() - wallet.lastAttemptAt.getTime() < 60_000)
        throw new AppError('COOLDOWN', 'Attendez une minute entre deux synchronisations.', 429);
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
      if (data.included !== undefined && data.included !== wallet.included)
        await capture(tx, p.id, p.version + 1, 'WALLET');
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
      if (wallet.included) await capture(tx, p.id, p.version + 1, 'WALLET');
      return { id: wallet.id };
    }
    throw new AppError('NOT_FOUND', 'Action introuvable.', 404);
  });
}

// A database lease prevents parallel Next instances or manual refreshes from paying twice.
export async function syncWallet(id: string, provider?: typeof fetchDeBank) {
  const wallet = await db().walletConnection.findUnique({ where: { id } });
  if (!wallet) return false;
  const config = await db().deBankConfig.findUnique({ where: { portfolioId: wallet.portfolioId } });
  if (!config?.enabled) return false;
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
  if (!claimed.count) return false;
  try {
    const accessKey =
      config.mode === 'API'
        ? config.encryptedKey
          ? decryptKey(config.encryptedKey, wallet.portfolioId)
          : null
        : '';
    if (accessKey === null) throw new DeBankError('KEY');
    const data = provider
      ? await provider(wallet.address, accessKey)
      : config.mode === 'API'
        ? await fetchDeBank(wallet.address, accessKey)
        : await (await import('./debank-public')).fetchDeBankPublic(wallet.address);
    const fetchedAt = new Date();
    return await db().$transaction(
      async (tx) => {
        // The same portfolio lock as user mutations prevents a late sync from undoing a pause/key change.
        const p = await tx.portfolio.update({
          where: { id: wallet.portfolioId },
          data: { version: { increment: 1 } },
        });
        const currentConfig = await tx.deBankConfig.findUnique({ where: { portfolioId: p.id } });
        const current = await tx.walletConnection.findUnique({ where: { id } });
        if (
          !currentConfig?.enabled ||
          currentConfig.revision !== config.revision ||
          !current?.enabled ||
          current.deletedAt ||
          current.leaseToken !== leaseToken
        )
          return false;
        await tx.walletObservation.create({
          data: { walletId: id, fetchedAt, totalUsd: data.totalUsd, data: json(data) },
        });
        await tx.walletConnection.update({
          where: { id },
          data: {
            leaseToken: null,
            leaseUntil: null,
            status: 'OK',
            errorCode: null,
            failureCount: 0,
            lastSuccessAt: fetchedAt,
            nextSyncAt: new Date(fetchedAt.getTime() + config.intervalMinutes * 60_000),
          },
        });
        // High-frequency observations feed live valuation. Portfolio captures are scheduled
        // separately (daily/manual) or triggered by a change in the included wallet perimeter.
        return true;
      },
      { timeout: 30_000 },
    );
  } catch (error) {
    const code = error instanceof DeBankError ? error.code : 'NETWORK';
    const failures = Math.min(wallet.failureCount + 1, 10);
    const retryMinutes = ['AUTH', 'CREDITS', 'KEY'].includes(code)
      ? 360
      : Math.min(360, Math.max(config.intervalMinutes, 5 * 2 ** failures));
    await db().walletConnection.updateMany({
      where: { id, leaseToken },
      data: {
        status: 'ERROR',
        errorCode: code,
        failureCount: failures,
        leaseToken: null,
        leaseUntil: null,
        nextSyncAt: new Date(Date.now() + retryMinutes * 60_000),
      },
    });
    return false;
  }
}
export async function syncDueWallets(provider?: typeof fetchDeBank) {
  const due = await db().walletConnection.findMany({
    where: {
      deletedAt: null,
      enabled: true,
      nextSyncAt: { lte: new Date() },
      portfolio: { debank: { is: { enabled: true } } },
    },
    orderBy: { nextSyncAt: 'asc' },
    take: 20,
    select: { id: true },
  });
  for (const wallet of due) await syncWallet(wallet.id, provider);
}
