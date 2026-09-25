import 'dotenv/config';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { db } from '../../src/server/db';
import { createUser } from '../../src/server/provision';
import { getState, command, runSnapshot } from '../../src/server/portfolio';
import { buildCategoryDetails } from '../../src/domain/categories';
import type { AppState } from '../../src/shared/types';
import { walletCommand, syncWallet } from '../../src/server/wallets';
import { normalizeDeBank, DeBankError } from '../../src/server/debank';
import { exportData } from '../../src/server/exports';
import { auth } from '../../src/server/auth';
import { POST, PATCH } from '../../src/app/api/v1/[...path]/route';
import { total, tokens, protocols, address } from '../fixtures/debank';
const testUrl = process.env.DATABASE_URL_TEST;
if (!testUrl || !new URL(testUrl).pathname.endsWith('_test'))
  throw new Error('Base de test requise.');
process.env.DATABASE_URL = testUrl;
const sample = normalizeDeBank(total, tokens, protocols);
const owners: string[] = [];
beforeAll(() => {
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: process.env,
    stdio: 'pipe',
    windowsHide: true,
  });
});
afterAll(async () => {
  await db().deBankConfig.updateMany({
    where: { portfolioId: { in: owners } },
    data: { enabled: false },
  });
  await db().$disconnect();
});
async function setup(included = true) {
  const email = `wallet-${randomUUID()}@example.test`,
    password = randomUUID() + randomUUID();
  const owner = await createUser('Wallet test', email, password);
  owners.push(owner.portfolioId);
  const call = (method: string, path: string, input: unknown, key = randomUUID()) =>
    walletCommand(owner.userId, method, path.split('/'), input, key);
  const { id } = (await call('POST', 'wallets', {
    address,
    label: 'Wallet fixture',
    referenceUsd: '1000',
    included,
  })) as { id: string };
  const configure = () =>
    call('PATCH', 'debank/config', {
      mode: 'API',
      accessKey: 'test-key-not-real',
      enabled: true,
      intervalMinutes: 60,
    });
  const due = () =>
    db().walletConnection.update({
      where: { id },
      data: { nextSyncAt: new Date(0), lastAttemptAt: new Date(0) },
    });
  return { ...owner, email, password, call, id, configure, due };
}
describe('Synchronisation DeBank persistante et isolée', () => {
  it('enregistre une adresse en mode gratuit, sans clé ni valeur inventée ; refuse le doublon', async () => {
    const s = await setup();
    const provider = vi.fn(async () => sample);
    const state = await getState(s.userId);
    expect(state.onchain.missing).toBe(1);
    expect(state.totals.valueUsd).toBeNull();
    expect(state.onchain.wallets[0].referenceUsd).toBe('1000');
    expect(state.onchain.config).toMatchObject({
      mode: 'PUBLIC',
      configured: true,
      hasKey: false,
      enabled: true,
    });
    expect(await syncWallet(s.id, provider)).toBe(true);
    expect(provider).toHaveBeenCalledWith(address, '');
    expect((await getState(s.userId)).onchain.valueUsd).toBe('905');
    await expect(
      s.call('POST', 'wallets', { address: address.toUpperCase() }),
    ).rejects.toMatchObject({ code: 'DUPLICATE' });
  });
  it('conserve les secrets hors état, exports et réponses ; chiffre leur stockage', async () => {
    const s = await setup();
    expect(await s.configure()).toEqual({ configured: true });
    const stored = await db().deBankConfig.findUniqueOrThrow({
      where: { portfolioId: s.portfolioId },
    });
    expect(stored.encryptedKey).not.toContain('test-key-not-real');
    const state = JSON.stringify(await getState(s.userId)),
      exported = await (await exportData(s.userId, 'portfolio.json')).text();
    for (const payload of [state, exported]) {
      expect(payload).not.toContain('test-key-not-real');
      expect(payload).not.toContain('encryptedKey');
      expect(payload).not.toContain('leaseToken');
    }
  });
  it('actualise les totaux sans snapshot de synchronisation ni faux achats', async () => {
    const s = await setup();
    await s.configure();
    await command(
      s.userId,
      'POST',
      ['fx-rates'],
      { eurUsd: '1.25', observedAt: new Date(Date.now() - 1000).toISOString() },
      randomUUID(),
      null,
    );
    expect(await syncWallet(s.id, async () => sample)).toBe(true);
    const state = await getState(s.userId);
    expect(state.totals).toMatchObject({
      valueUsd: '905',
      valueEur: '724',
      costEur: '0',
      unrealizedEur: null,
    });
    expect(state.transactions).toHaveLength(0);
    expect(state.snapshots).toHaveLength(1);
    // The only capture records inclusion, before any observation: its value stays unknown.
    expect(state.snapshots[0]).toMatchObject({ kind: 'WALLET', totalUsd: null });
    expect(await db().walletObservation.count({ where: { walletId: s.id } })).toBe(1);
    const provider = vi.fn();
    expect(await syncWallet(s.id, provider)).toBe(false);
    expect(provider).not.toHaveBeenCalled();
  });
  it.each([15, 60, 240])(
    'sépare les observations à %i min des captures manuelles et quotidiennes immuables',
    async (intervalMinutes) => {
      const s = await setup();
      await s.call('PATCH', 'debank/config', {
        mode: 'API',
        accessKey: 'test-key-not-real',
        enabled: true,
        intervalMinutes,
      });
      await command(
        s.userId,
        'POST',
        ['fx-rates'],
        {
          eurUsd: '1.25',
          observedAt: new Date(Date.now() - 1000).toISOString(),
        },
        randomUUID(),
        null,
      );
      expect(await syncWallet(s.id, async () => sample)).toBe(true);
      const manual = await runSnapshot(s.portfolioId);
      expect(String(manual!.totalUsd)).toBe('905');
      const before = await getState(s.userId);
      await s.due();
      expect(await syncWallet(s.id, async () => ({ ...sample, totalUsd: '1000' }))).toBe(true);
      const dailyAt = new Date();
      const [daily, concurrent] = await Promise.all([
        runSnapshot(s.portfolioId, true, dailyAt),
        runSnapshot(s.portfolioId, true, dailyAt),
      ]);
      expect(concurrent!.id).toBe(daily!.id);
      expect(String(daily!.totalUsd)).toBe('1000');
      await s.due();
      expect(await syncWallet(s.id, async () => ({ ...sample, totalUsd: '1100' }))).toBe(true);
      expect(await runSnapshot(s.portfolioId, true, dailyAt)).toEqual(daily);
      const state: AppState = await getState(s.userId);
      expect(state.totals).toMatchObject({ valueUsd: '1100', valueEur: '880', netFlowsEur: '0' });
      expect(state.portfolio.version).toBeGreaterThan(before.portfolio.version);
      expect(state.transactions).toHaveLength(0);
      expect(state.snapshots).toHaveLength(3); // inclusion + manual + daily, not three syncs
      expect(await db().walletObservation.count({ where: { walletId: s.id } })).toBe(3);
      expect(await db().portfolioSnapshot.findUnique({ where: { id: manual!.id } })).toEqual(
        manual,
      );
      const crypto = state.categories.find((c) => c.key === 'CRYPTO')!;
      const details = buildCategoryDetails(state, crypto, 'USD');
      expect(details.category.totalValue).toBe(1100);
      expect(
        state.snapshots.find((snap) => snap.id === manual!.id)?.categoryValues?.[crypto.id],
      ).toEqual({ valueEur: '724', valueUsd: '905' });
      expect(details.history.map((point) => point.value)).toEqual([null, 905, 1000, 1100]);
      expect(details.unrealizedPnL).toBeNull();
      const nextDay = await runSnapshot(
        s.portfolioId,
        true,
        new Date(dailyAt.getTime() + 86400000),
      );
      expect(nextDay!.id).not.toBe(daily!.id);
      expect(String(nextDay!.totalUsd)).toBe('1100');
      expect(await db().portfolioSnapshot.count({ where: { portfolioId: s.portfolioId } })).toBe(4);
    },
  );
  it('pause, reprise, renommage et configuration ne changent ni périmètre ni captures', async () => {
    const s = await setup();
    await syncWallet(s.id, async () => sample);
    const saved = await runSnapshot(s.portfolioId);
    for (const input of [
      { enabled: false },
      { enabled: true },
      { label: 'Nouveau nom' },
      { included: true },
    ]) {
      await s.call('PATCH', `wallets/${s.id}`, input);
      const state = await getState(s.userId);
      expect(state.totals.valueUsd).toBe('905');
      expect(state.snapshots).toHaveLength(2);
    }
    await s.call('DELETE', 'debank/config', {});
    expect(await syncWallet(s.id, async () => sample)).toBe(false);
    expect((await getState(s.userId)).totals.valueUsd).toBe('905');
    expect(await db().portfolioSnapshot.count({ where: { portfolioId: s.portfolioId } })).toBe(2);
    expect(await db().portfolioSnapshot.findUnique({ where: { id: saved!.id } })).toEqual(saved);
  });
  it('fige les dernières observations valides de chaque wallet à la date de capture', async () => {
    const s = await setup();
    const second = (await s.call('POST', 'wallets', {
      address: `0x${'c'.repeat(40)}`,
    })) as { id: string };
    await syncWallet(s.id, async () => sample);
    await syncWallet(second.id, async () => ({ ...sample, totalUsd: '95' }));
    const at = new Date();
    // A known invalid read and a future read must never replace the observations at this instant.
    await db().walletObservation.createMany({
      data: [
        {
          walletId: s.id,
          fetchedAt: at,
          totalUsd: '9999',
          data: { ...sample, totalUsd: '9999' },
          invalidatedAt: at,
          invalidReason: 'Fixture invalide',
        },
        {
          walletId: second.id,
          fetchedAt: new Date(at.getTime() + 3600000),
          totalUsd: '8888',
          data: { ...sample, totalUsd: '8888' },
        },
      ],
    });
    const snapshot = await runSnapshot(s.portfolioId, false, at);
    expect(String(snapshot!.totalUsd)).toBe('1000');
    expect(snapshot!.data).toMatchObject({
      onchain: {
        includedCount: 2,
        missing: 0,
        valueUsd: '1000',
        wallets: expect.arrayContaining([
          expect.objectContaining({ id: s.id, data: expect.objectContaining({ totalUsd: '905' }) }),
          expect.objectContaining({
            id: second.id,
            data: expect.objectContaining({ totalUsd: '95' }),
          }),
        ]),
      },
    });
    expect(
      await db().walletObservation.count({ where: { walletId: { in: [s.id, second.id] } } }),
    ).toBe(4);
    expect(await db().portfolioSnapshot.count({ where: { portfolioId: s.portfolioId } })).toBe(3);
  });
  it('capture seulement les changements réels de périmètre, y compris retrait et restauration', async () => {
    const s = await setup(false);
    await syncWallet(s.id, async () => sample);
    expect((await getState(s.userId)).snapshots).toHaveLength(0);
    expect((await getState(s.userId)).totals.valueUsd).toBe('0');
    const key = randomUUID();
    await s.call('PATCH', `wallets/${s.id}`, { included: true }, key);
    await s.call('PATCH', `wallets/${s.id}`, { included: true }, key);
    await s.call('PATCH', `wallets/${s.id}`, { included: true });
    const included = (await getState(s.userId)).snapshots;
    expect(included).toHaveLength(1);
    expect(included[0]).toMatchObject({ kind: 'WALLET', totalUsd: '905' });
    await s.call('DELETE', `wallets/${s.id}`, {});
    const removed = await getState(s.userId);
    expect(removed.onchain.wallets).toHaveLength(0);
    expect(removed.totals.valueUsd).toBe('0');
    expect(removed.snapshots).toHaveLength(2);
    expect(removed.snapshots.at(-1)).toMatchObject({ kind: 'WALLET', totalUsd: '0' });
    // Keep the structural marker used to suppress Dietz even after the wallet disappears.
    expect(removed.snapshots.some((snap: { kind: string }) => snap.kind === 'WALLET')).toBe(true);
    const restoreKey = randomUUID();
    const restored = await s.call('POST', 'wallets', { address }, restoreKey);
    expect(restored).toEqual({ id: s.id });
    expect(await s.call('POST', 'wallets', { address }, restoreKey)).toEqual(restored);
    const state = await getState(s.userId);
    expect(state.snapshots).toHaveLength(3);
    expect(state.snapshots[0]).toEqual(included[0]);
    expect(state.snapshots.at(-1)).toMatchObject({ kind: 'WALLET', totalUsd: '905' });
    expect(state.onchain.wallets[0].data.totalUsd).toBe('905');
    expect(await db().walletObservation.count({ where: { walletId: s.id } })).toBe(1);
  });
  it('un seul appel fournisseur pour deux workers concurrents', async () => {
    const s = await setup();
    await s.configure();
    const provider = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return sample;
    });
    const results = await Promise.all([syncWallet(s.id, provider), syncWallet(s.id, provider)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(await db().walletObservation.count({ where: { walletId: s.id } })).toBe(1);
    expect((await getState(s.userId)).snapshots).toHaveLength(1);
  });
  it('conserve la réussite précédente et sa date sur erreur puis programme une reprise', async () => {
    const s = await setup();
    await s.configure();
    await syncWallet(s.id, async () => sample);
    const before = (await getState(s.userId)).onchain.wallets[0];
    await s.due();
    expect(
      await syncWallet(s.id, async () => {
        throw new DeBankError('RATE_LIMIT');
      }),
    ).toBe(false);
    const after = (await getState(s.userId)).onchain.wallets[0];
    expect(after.data).toEqual(before.data);
    expect(after.lastSuccessAt).toEqual(before.lastSuccessAt);
    expect(after.errorCode).toBe('RATE_LIMIT');
    expect(Date.parse(after.nextSyncAt)).toBeGreaterThan(Date.now());
    expect(await db().walletObservation.count({ where: { walletId: s.id } })).toBe(1);
    expect((await getState(s.userId)).snapshots).toHaveLength(1);
  });
  it('une pause ou une suppression pendant un appel empêche la publication tardive', async () => {
    const s = await setup();
    await s.configure();
    expect(
      await syncWallet(s.id, async () => {
        await s.call('PATCH', `wallets/${s.id}`, { enabled: false });
        return sample;
      }),
    ).toBe(false);
    expect(await db().walletObservation.count({ where: { walletId: s.id } })).toBe(0);
    expect((await getState(s.userId)).snapshots).toHaveLength(1);
    await s.call('PATCH', `wallets/${s.id}`, { enabled: true });
    await s.due();
    expect(
      await syncWallet(s.id, async () => {
        await s.call('DELETE', 'debank/config', {});
        return sample;
      }),
    ).toBe(false);
    expect(await db().walletObservation.count({ where: { walletId: s.id } })).toBe(0);
    expect((await getState(s.userId)).snapshots).toHaveLength(1);
  });
  it('isole les propriétaires et les clés idempotentes', async () => {
    const a = await setup(),
      b = await setup();
    await expect(b.call('PATCH', `wallets/${a.id}`, { included: false })).rejects.toMatchObject({
      status: 404,
    });
    await expect(b.call('POST', `wallets/${a.id}/sync`, {})).rejects.toMatchObject({ status: 404 });
    const key = randomUUID();
    const data = { address: `0x${'b'.repeat(40)}` };
    const first = await a.call('POST', 'wallets', data, key);
    expect(await a.call('POST', 'wallets', data, key)).toEqual(first);
    expect((await getState(b.userId)).onchain.wallets).toHaveLength(1);
  });
  it('exclut un wallet sans effacer son observation et garde les snapshots après retrait', async () => {
    const s = await setup();
    await s.configure();
    await syncWallet(s.id, async () => sample);
    const saved = await runSnapshot(s.portfolioId);
    await s.call('PATCH', `wallets/${s.id}`, { included: false });
    expect((await getState(s.userId)).totals.valueUsd).toBe('0');
    const captures = (await getState(s.userId)).snapshots;
    expect(captures.at(-1)).toMatchObject({ kind: 'WALLET', totalUsd: '0' });
    await s.call('DELETE', `wallets/${s.id}`, {});
    expect((await getState(s.userId)).onchain.wallets).toHaveLength(0);
    expect((await getState(s.userId)).snapshots).toEqual(captures);
    expect(await db().portfolioSnapshot.findUnique({ where: { id: saved!.id } })).toEqual(saved);
    expect(await db().walletObservation.count({ where: { walletId: s.id } })).toBe(1);
    expect(
      await db().portfolioSnapshot.count({ where: { portfolioId: s.portfolioId, totalUsd: 905 } }),
    ).toBe(1);
  });
  it('protége les routes par session, origine et délai anti-rafale', async () => {
    const s = await setup();
    await s.configure();
    const path = { params: Promise.resolve({ path: ['wallets', s.id, 'sync'] }) };
    const request = (headers: Record<string, string> = {}) =>
      new Request(`${process.env.APP_ORIGIN}/api/v1/wallets/${s.id}/sync`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': randomUUID(),
          ...headers,
        },
        body: '{}',
      });
    expect((await POST(request(), path)).status).toBe(401);
    const login = await auth().api.signInEmail({
      body: { email: s.email, password: s.password },
      asResponse: true,
    });
    const cookie = login.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
    expect((await POST(request({ cookie, origin: 'https://other.test' }), path)).status).toBe(403);
    await syncWallet(s.id, async () => sample);
    expect((await POST(request({ cookie, origin: process.env.APP_ORIGIN! }), path)).status).toBe(
      429,
    );
    const configRequest = new Request(`${process.env.APP_ORIGIN}/api/v1/debank/config`, {
      method: 'PATCH',
      headers: {
        cookie,
        origin: process.env.APP_ORIGIN!,
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
      },
      body: JSON.stringify({ enabled: true, intervalMinutes: 15 }),
    });
    const saved = await PATCH(configRequest, {
      params: Promise.resolve({ path: ['debank', 'config'] }),
    });
    expect(saved.status).toBe(200);
    expect(await saved.text()).not.toContain('test-key-not-real');
  });
});
