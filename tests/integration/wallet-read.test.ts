import 'dotenv/config';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { configureTestDatabase } from '../database-env';
import { db } from '@/server/db';
import { createUser } from '@/server/provision';
import { getState, runSnapshot } from '@/server/portfolio-query';
import { walletSyncStatus } from '@/server/wallet-state';
import { walletCommand, syncWallet } from '@/server/wallets';
import { normalizeZerion } from '@/server/zerion';
import { portfolio, fluidPositions, address } from '../fixtures/zerion';

configureTestDatabase();
beforeAll(() => {
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: process.env,
    stdio: 'pipe',
  });
});
afterAll(async () => {
  await db().$disconnect();
});
it('owner-scoped scalar status and live reads track a queued sync without altering captures or calculations', async () => {
  const owner = await createUser('Read test', `read-${randomUUID()}@example.test`, randomUUID());
  const other = await createUser('Other test', `read-${randomUUID()}@example.test`, randomUUID());
  // Fixed local rate: neither the test nor the wallet service needs an external provider.
  await db().fxRate.create({
    data: {
      portfolioId: owner.portfolioId,
      eurUsd: '1.25',
      source: 'test',
      observedAt: new Date(0),
    },
  });
  const call = (method: string, path: string, data: unknown) =>
    walletCommand(owner.userId, method, path.split('/'), data, randomUUID());
  const wallet = (await call('POST', 'wallets', { address, label: 'Fixture' })) as { id: string };
  expect((await walletSyncStatus(owner.userId)).wallets).toEqual([
    expect.objectContaining({ id: wallet.id, status: 'PENDING' }),
  ]);
  expect((await walletSyncStatus(other.userId)).wallets).toEqual([]);
  const sample = normalizeZerion(portfolio(), [fluidPositions()]);
  expect(await syncWallet(wallet.id, async () => sample)).toBe(true);
  const saved = await runSnapshot(owner.portfolioId);
  const full = await getState(owner.userId);
  const light = await walletSyncStatus(owner.userId);
  expect(light.wallets[0].status).toBe('OK');
  expect(light.wallets[0].lastSuccessAt).toBe(full.onchain.wallets[0].lastSuccessAt);
  for (const key of ['address', 'data', 'observations', 'totalUsd', 'leaseToken'])
    expect(light.wallets[0]).not.toHaveProperty(key);
  await db().walletConnection.update({
    where: { id: wallet.id },
    data: { lastAttemptAt: new Date(0) },
  });
  await call('POST', `wallets/${wallet.id}/sync`, {});
  expect((await walletSyncStatus(owner.userId)).wallets[0].status).toBe('PENDING');
  const live = await getState(owner.userId, false);
  expect(live).not.toHaveProperty('snapshots');
  expect(live.totals).toEqual(full.totals);
  expect(live.totals.valueUsd).toBe('905');
  expect(live.totals.valueEur).toBe('724');
  expect(await db().portfolioSnapshot.findUnique({ where: { id: saved!.id } })).toEqual(saved);
  await call('DELETE', `wallets/${wallet.id}`, {});
  expect((await walletSyncStatus(owner.userId)).wallets).toEqual([]);
  expect(await db().walletObservation.count({ where: { walletId: wallet.id } })).toBe(1);
});
