import 'dotenv/config';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { db } from '../../src/server/db';
import { createUser } from '../../src/server/provision';
import { command, getState, runSnapshot } from '../../src/server/portfolio';
import { auth } from '../../src/server/auth';
import { importCommand, type ImportPreview } from '../../src/server/imports';
import { saveImage, getImage } from '../../src/server/images';
import { exportData } from '../../src/server/exports';
import sharp from 'sharp';
import { GET, POST } from '../../src/app/api/v1/[...path]/route';
const testUrl = process.env.DATABASE_URL_TEST;
if (!testUrl || !new URL(testUrl).pathname.endsWith('_test'))
  throw new Error(
    'Tests refusés : DATABASE_URL_TEST doit désigner une base se terminant par _test.',
  );
process.env.DATABASE_URL = testUrl;
let userId: string,
  secondId: string,
  portfolioId: string,
  categoryId: string,
  sessionCookie: string;
const email = `integration-${randomUUID()}@example.test`,
  password = randomUUID() + randomUUID();
const commandFor = (
  method: string,
  path: string,
  data: unknown,
  version: string | null = null,
  key = randomUUID(),
) => command(userId, method, path.split('/'), data, key, version);
async function createAsset() {
  return commandFor('POST', 'assets', {
    name: 'Actif test',
    symbol: 'TEST',
    categoryId,
    currency: 'EUR',
    platform: 'Personnel',
    metadata: {},
  }) as Promise<{ id: string; version: number }>;
}
const purchase = (assetId: string, quantity = '2') => ({
  assetId,
  type: 'BUY',
  quantity,
  unitPrice: '100',
  fees: '2',
  currency: 'EUR',
  platform: 'Personnel',
  occurredAt: '2025-01-01T00:00:00Z',
  settlement: 'EXTERNAL',
});
beforeAll(async () => {
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: process.env,
    stdio: 'pipe',
    windowsHide: true,
  });
  const owner = await createUser('Test', email, password);
  userId = owner.userId;
  portfolioId = owner.portfolioId;
  secondId = (await createUser('Autre', `isolation-${randomUUID()}@example.test`, randomUUID()))
    .userId;
  categoryId = (await db().assetCategory.findFirstOrThrow({ where: { portfolioId } })).id;
  const login = await auth().api.signInEmail({ body: { email, password }, asResponse: true });
  expect(login.status).toBe(200);
  sessionCookie = login.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
});
afterAll(async () => {
  await db().$disconnect();
});
describe('Persistance PostgreSQL et mutations atomiques', () => {
  it('recalcule une position après achat et prix manuel', async () => {
    const asset = await createAsset();
    await commandFor('POST', 'transactions', purchase(asset.id));
    await commandFor('POST', `assets/${asset.id}/prices`, {
      price: '140',
      observedAt: '2025-01-02T00:00:00Z',
    });
    const state = await getState(userId);
    const row = state.rows.find((a: { id: string }) => a.id === asset.id);
    expect(row).toMatchObject({ quantity: '2', costEur: '202', valueEur: '280', gainEur: '78' });
  });
  it('refuse une position détenue puis archive sans altérer son histoire financière', async () => {
    const untouched = await createAsset();
    const before = await runSnapshot(portfolioId);
    const asset = await createAsset();
    const buy = await commandFor('POST', 'transactions', purchase(asset.id));
    await commandFor(
      'PATCH',
      `transactions/${buy.id}`,
      {
        transaction: { ...purchase(asset.id), unitPrice: '110' },
        reason: 'Correction du coût',
      },
      '1',
    );
    await commandFor('POST', `assets/${asset.id}/prices`, {
      price: '140',
      observedAt: '2025-01-02T00:00:00Z',
    });
    const content = await sharp({
      create: { width: 10, height: 10, channels: 3, background: '#6366f1' },
    })
      .png()
      .toBuffer();
    await saveImage(userId, asset.id, { base64: content.toString('base64') }, randomUUID());
    const during = await runSnapshot(portfolioId);

    const heldState = await getState(userId);
    await expect(
      commandFor('DELETE', `assets/${asset.id}`, { confirmed: true }, '1'),
    ).rejects.toMatchObject({ code: 'ASSET_POSITION_OPEN', status: 409 });
    const edit = {
      name: 'Actif test',
      symbol: 'TEST',
      categoryId,
      currency: 'EUR',
      platform: 'Personnel',
    };
    await expect(
      commandFor('PATCH', `assets/${asset.id}`, { ...edit, status: 'ARCHIVED' }, '1'),
    ).rejects.toMatchObject({ code: 'ASSET_POSITION_OPEN' });
    expect((await getState(userId)).totals).toEqual(heldState.totals);
    expect((await getState(userId)).portfolio.version).toBe(heldState.portfolio.version);
    const sale = await commandFor('POST', 'transactions', {
      ...purchase(asset.id),
      type: 'SELL',
      unitPrice: '150',
      fees: '0',
      settlement: 'INTERNAL',
      occurredAt: '2025-02-01T00:00:00Z',
    });
    const prior = await getState(userId);
    const history = await db().transaction.findMany({
      where: { assetId: asset.id },
      include: { revisions: true },
    });
    const prices = await db().priceHistory.findMany({ where: { assetId: asset.id } });
    const audits = await db().auditLog.findMany({ where: { portfolioId } });
    const key = randomUUID();
    const archived = await commandFor(
      'DELETE',
      `assets/${asset.id}`,
      { confirmed: true },
      '1',
      key,
    );
    expect(archived).toMatchObject({
      id: asset.id,
      archived: true,
      deleted: false,
      snapshotsDeleted: 0,
      status: 'ARCHIVED',
      version: 2,
    });
    expect(await commandFor('DELETE', `assets/${asset.id}`, { confirmed: true }, '1', key)).toEqual(
      archived,
    );
    expect(await db().asset.findUnique({ where: { id: asset.id } })).toMatchObject({
      status: 'ARCHIVED',
      deletedAt: null,
    });
    expect(
      await db().transaction.findMany({
        where: { assetId: asset.id },
        include: { revisions: true },
      }),
    ).toEqual(history);
    expect(
      await db().transactionRevision.count({ where: { transaction: { assetId: asset.id } } }),
    ).toBe(3);
    expect(await db().priceHistory.findMany({ where: { assetId: asset.id } })).toEqual(prices);
    expect((await getImage(userId, asset.id)).status).toBe(200);
    expect(await db().portfolioSnapshot.findUnique({ where: { id: during!.id } })).toEqual(during);
    expect(await db().portfolioSnapshot.findUnique({ where: { id: before!.id } })).toEqual(before);
    expect(await db().asset.findUnique({ where: { id: untouched.id } })).not.toBeNull();
    const state = await getState(userId);
    expect(state.rows.find((row: { id: string }) => row.id === asset.id)).toMatchObject({
      status: 'ARCHIVED',
      quantity: '0',
      realizedEur: '78',
    });
    expect(state.totals).toEqual(prior.totals);
    expect(
      state.transactions.filter((row: { assetId: string }) => row.assetId === asset.id),
    ).toHaveLength(2);
    expect(
      await db().auditLog.findMany({ where: { id: { in: audits.map((audit) => audit.id) } } }),
    ).toHaveLength(audits.length);
    expect(
      await db().auditLog.count({ where: { entityId: asset.id, action: 'ASSET_ARCHIVED' } }),
    ).toBe(1);
    const exported = await (await exportData(userId, 'portfolio.json')).json();
    expect(exported.assets.find((row: { id: string }) => row.id === asset.id)).toMatchObject({
      status: 'ARCHIVED',
    });
    expect(exported.snapshots.find((row: { id: string }) => row.id === during!.id)).toBeDefined();
    expect(
      exported.transactions.find((row: { id: string }) => row.id === buy.id).revisions,
    ).toHaveLength(2);
    await expect(commandFor('POST', 'transactions', purchase(asset.id))).rejects.toMatchObject({
      code: 'ASSET_ARCHIVED',
    });
    await expect(
      commandFor(
        'PATCH',
        `transactions/${sale.id}`,
        {
          transaction: {
            ...purchase(asset.id, '1'),
            type: 'SELL',
            occurredAt: '2025-02-01T00:00:00Z',
          },
          reason: 'Correction de quantité',
        },
        '1',
      ),
    ).rejects.toMatchObject({ code: 'ASSET_ARCHIVED' });
    await expect(
      commandFor(
        'DELETE',
        `transactions/${sale.id}`,
        { confirmed: true, reason: 'Annulation de vente' },
        '1',
      ),
    ).rejects.toMatchObject({ code: 'ASSET_ARCHIVED' });
    await commandFor('PATCH', `assets/${asset.id}`, { ...edit, status: 'ACTIVE' }, '2');
    await commandFor(
      'DELETE',
      `transactions/${sale.id}`,
      { confirmed: true, reason: 'Annulation de vente après réactivation' },
      '1',
    );
    expect(
      (await getState(userId)).rows.find((row: { id: string }) => row.id === asset.id).quantity,
    ).toBe('2');
    expect(await db().portfolioSnapshot.findUnique({ where: { id: during!.id } })).toEqual(during);
    expect(
      await db().auditLog.count({ where: { entityId: asset.id, action: 'ASSET_REACTIVATED' } }),
    ).toBe(1);
  });
  it('rejoue la même clé sans doubler l’achat ni changer la version', async () => {
    const asset = await createAsset(),
      key = randomUUID(),
      payload = purchase(asset.id);
    await commandFor('POST', 'transactions', payload, null, key);
    const before = await db().portfolio.findUniqueOrThrow({ where: { id: portfolioId } });
    await commandFor('POST', 'transactions', payload, null, key);
    expect(await db().transaction.count({ where: { assetId: asset.id } })).toBe(1);
    expect((await db().portfolio.findUniqueOrThrow({ where: { id: portfolioId } })).version).toBe(
      before.version,
    );
    await expect(
      commandFor('POST', 'transactions', { ...payload, quantity: '3' }, null, key),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('annule entièrement une vente impossible', async () => {
    const asset = await createAsset();
    await commandFor('POST', 'transactions', purchase(asset.id));
    await expect(
      commandFor('POST', 'transactions', { ...purchase(asset.id, '3'), type: 'SELL' }),
    ).rejects.toThrow('insuffisante');
    expect(await db().transaction.count({ where: { assetId: asset.id } })).toBe(1);
  });
  it('interdit les références vers le portefeuille d’un autre utilisateur', async () => {
    const asset = await createAsset();
    await expect(
      command(secondId, 'POST', ['transactions'], purchase(asset.id), randomUUID(), null),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('ne permet pas à deux ventes concurrentes de consommer les mêmes unités', async () => {
    const asset = await createAsset();
    await commandFor('POST', 'transactions', purchase(asset.id));
    const sell = {
      ...purchase(asset.id),
      type: 'SELL',
      unitPrice: '150',
      fees: '0',
      occurredAt: '2025-02-01T00:00:00Z',
    };
    const result = await Promise.allSettled([
      commandFor('POST', 'transactions', sell),
      commandFor('POST', 'transactions', sell),
    ]);
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db().transaction.count({ where: { assetId: asset.id, type: 'SELL' } })).toBe(1);
  });
  it('refuse de supprimer un achat consommé par une vente', async () => {
    const asset = await createAsset();
    const buy = (await commandFor('POST', 'transactions', purchase(asset.id))) as { id: string };
    await commandFor('POST', 'transactions', {
      ...purchase(asset.id, '1'),
      type: 'SELL',
      occurredAt: '2025-02-01T00:00:00Z',
    });
    await expect(
      commandFor('DELETE', `transactions/${buy.id}`, { confirmed: true, reason: 'Test' }, '1'),
    ).rejects.toThrow();
    expect((await db().transaction.findUniqueOrThrow({ where: { id: buy.id } })).voided).toBe(
      false,
    );
  });
  it('conserve un snapshot inchangé après une nouvelle cotation', async () => {
    const snapshot = (await commandFor('POST', 'snapshots', {})) as { id: string };
    const before = await db().portfolioSnapshot.findUniqueOrThrow({ where: { id: snapshot.id } });
    const asset = await createAsset();
    await commandFor('POST', `assets/${asset.id}/prices`, {
      price: '999',
      observedAt: new Date().toISOString(),
    });
    const after = await db().portfolioSnapshot.findUniqueOrThrow({ where: { id: snapshot.id } });
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });
  it('rejette une version de fiche périmée', async () => {
    const asset = await createAsset();
    await expect(
      commandFor(
        'PATCH',
        `assets/${asset.id}`,
        {
          name: 'Modification',
          symbol: 'TEST',
          categoryId,
          currency: 'EUR',
          platform: 'Personnel',
        },
        '999',
      ),
    ).rejects.toMatchObject({ status: 412 });
  });
  it('corrige une transaction avec révision et refuse une correction incohérente', async () => {
    const asset = await createAsset(),
      buy = (await commandFor('POST', 'transactions', purchase(asset.id))) as { id: string };
    await commandFor('POST', 'transactions', {
      ...purchase(asset.id, '1'),
      type: 'SELL',
      occurredAt: '2025-02-01T00:00:00Z',
    });
    await commandFor(
      'PATCH',
      `transactions/${buy.id}`,
      { transaction: { ...purchase(asset.id), unitPrice: '120' }, reason: 'Correction du prix' },
      '1',
    );
    expect(await db().transactionRevision.count({ where: { transactionId: buy.id } })).toBe(2);
    await expect(
      commandFor(
        'PATCH',
        `transactions/${buy.id}`,
        { transaction: purchase(asset.id, '0.5'), reason: 'Quantité erronée' },
        '2',
      ),
    ).rejects.toThrow('insuffisante');
    expect(
      (await db().transaction.findUniqueOrThrow({ where: { id: buy.id } })).quantity.toString(),
    ).toBe('2');
  });
});
describe('Cycle de vie des actifs', () => {
  const edit = (status = 'ARCHIVED') => ({
    name: 'Actif test',
    symbol: 'TEST',
    categoryId,
    currency: 'EUR',
    platform: 'Personnel',
    status,
  });
  it('archive une fiche vide par PATCH et protège version, confirmation et propriétaire', async () => {
    const asset = await createAsset();
    for (const method of ['PATCH', 'DELETE']) {
      await expect(
        command(
          secondId,
          method,
          ['assets', asset.id],
          method === 'PATCH' ? edit() : { confirmed: true },
          randomUUID(),
          '1',
        ),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        commandFor(method, `assets/${asset.id}`, method === 'PATCH' ? edit() : { confirmed: true }),
      ).rejects.toMatchObject({ status: 428 });
      await expect(
        commandFor(
          method,
          `assets/${asset.id}`,
          method === 'PATCH' ? edit() : { confirmed: true },
          '999',
        ),
      ).rejects.toMatchObject({ status: 412 });
    }
    await expect(
      commandFor('DELETE', `assets/${asset.id}`, { confirmed: 'true' }, '1'),
    ).rejects.toThrow();
    const archived = await commandFor('PATCH', `assets/${asset.id}`, edit(), '1');
    expect(archived).toMatchObject({ status: 'ARCHIVED', version: 2, deletedAt: null });
    expect(
      await commandFor('DELETE', `assets/${asset.id}`, { confirmed: true }, '2'),
    ).toMatchObject({ archived: true, version: 2 });
    expect(await db().asset.count({ where: { id: asset.id } })).toBe(1);
    await expect(
      command(secondId, 'PATCH', ['assets', asset.id], edit('ACTIVE'), randomUUID(), '2'),
    ).rejects.toMatchObject({ status: 404 });
    expect((await getState(secondId)).rows.some((row: { id: string }) => row.id === asset.id)).toBe(
      false,
    );
  });
  it('conserve aussi une opération annulée et toutes ses révisions', async () => {
    const asset = await createAsset();
    const buy = await commandFor('POST', 'transactions', purchase(asset.id));
    await commandFor(
      'DELETE',
      `transactions/${buy.id}`,
      { confirmed: true, reason: 'Saisie erronée' },
      '1',
    );
    const before = await db().transaction.findUniqueOrThrow({
      where: { id: buy.id },
      include: { revisions: true },
    });
    await commandFor('DELETE', `assets/${asset.id}`, { confirmed: true }, '1');
    expect(
      await db().transaction.findUniqueOrThrow({
        where: { id: buy.id },
        include: { revisions: true },
      }),
    ).toEqual(before);
    expect(before.revisions).toHaveLength(2);
  });
  it('ne perd pas les quantités positives des anciens actifs archivés dans les totaux', async () => {
    const asset = await createAsset();
    await commandFor('POST', 'transactions', purchase(asset.id));
    await commandFor('POST', `assets/${asset.id}/prices`, {
      price: '140',
      observedAt: '2025-01-02T00:00:00Z',
    });
    const before = await getState(userId);
    // Reproduit un état permis par l’ancienne version, sans modifier le journal.
    await db().asset.update({ where: { id: asset.id }, data: { status: 'ARCHIVED' } });
    const after = await getState(userId);
    expect(after.totals).toEqual(before.totals);
    expect(after.rows.find((row: { id: string }) => row.id === asset.id)).toMatchObject({
      quantity: '2',
      valueEur: '280',
      status: 'ARCHIVED',
    });
    await commandFor('PATCH', `assets/${asset.id}`, edit('ACTIVE'), '1');
  });
  it('refuse même une quantité minimale et une opération légèrement future', async () => {
    const tiny = await createAsset();
    await commandFor('POST', 'transactions', purchase(tiny.id, '0.000000000000000001'));
    await expect(commandFor('PATCH', `assets/${tiny.id}`, edit(), '1')).rejects.toMatchObject({
      code: 'ASSET_POSITION_OPEN',
    });
    const future = await createAsset();
    await commandFor('POST', 'transactions', {
      ...purchase(future.id),
      occurredAt: new Date(Date.now() + 50_000).toISOString(),
    });
    await expect(
      commandFor('DELETE', `assets/${future.id}`, { confirmed: true }, '1'),
    ).rejects.toMatchObject({ code: 'ASSET_PENDING_TRANSACTION' });
  });
  it('ne crée pas une position initiale sur une fiche archivée', async () => {
    const before = await db().asset.count({ where: { portfolioId } });
    await expect(commandFor('POST', 'assets', { ...edit(), quantity: '1' })).rejects.toMatchObject({
      code: 'ASSET_ARCHIVED',
    });
    expect(await db().asset.count({ where: { portfolioId } })).toBe(before);
  });
  it('refuse le rattachement d’une correction à un actif archivé', async () => {
    const archived = await createAsset();
    await commandFor('DELETE', `assets/${archived.id}`, { confirmed: true }, '1');
    const active = await createAsset();
    const buy = await commandFor('POST', 'transactions', purchase(active.id));
    await expect(
      commandFor(
        'PATCH',
        `transactions/${buy.id}`,
        { transaction: purchase(archived.id), reason: 'Changement d’actif' },
        '1',
      ),
    ).rejects.toMatchObject({ code: 'ASSET_ARCHIVED' });
    expect(await db().transaction.findUnique({ where: { id: buy.id } })).toMatchObject({
      assetId: active.id,
      version: 1,
    });
  });
  it('sérialise un achat et un archivage concurrents sans position archivée ouverte', async () => {
    const asset = await createAsset();
    const results = await Promise.allSettled([
      commandFor('POST', 'transactions', purchase(asset.id)),
      commandFor('DELETE', `assets/${asset.id}`, { confirmed: true }, '1'),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const row = (await getState(userId)).rows.find((row: { id: string }) => row.id === asset.id);
    expect(row.status === 'ARCHIVED' ? row.quantity === '0' : row.quantity === '2').toBe(true);
  });
});
describe('Import CSV avec aperçu', () => {
  const csv = (id: string, reference = randomUUID(), q = '1') =>
    `asset_id,type,quantity,unit_price,currency,occurred_at,platform,external_reference\n${id},BUY,${q},100,EUR,2025-01-01T00:00:00Z,Personnel,${reference}`;
  const preview = async (text: string) =>
    (await importCommand(
      userId,
      ['imports', 'preview'],
      { csv: text },
      randomUUID(),
    )) as ImportPreview;
  const confirm = (id: string) =>
    importCommand(userId, ['imports', id, 'confirm'], { confirmed: true }, randomUUID());
  it('rejette les actifs archivés et invalide les aperçus antérieurs à leur archivage', async () => {
    const asset = await createAsset();
    const batch = await preview(csv(asset.id));
    await commandFor('DELETE', `assets/${asset.id}`, { confirmed: true }, '1');
    await expect(confirm(batch.id)).rejects.toMatchObject({ code: 'PREVIEW_STALE' });
    for (const text of [
      csv(asset.id),
      csv(asset.id).replace('asset_id', 'asset_symbol').replace(asset.id, 'ARCHIVED_ONLY'),
    ]) {
      // Le symbole explicite évite les autres fiches TEST du portefeuille.
      if (text.includes('ARCHIVED_ONLY'))
        await db().asset.update({ where: { id: asset.id }, data: { symbol: 'ARCHIVED_ONLY' } });
      const rejected = await preview(text);
      expect(rejected.errors).toEqual([
        expect.objectContaining({ message: expect.stringContaining('archivé') }),
      ]);
      await expect(confirm(rejected.id)).rejects.toMatchObject({ code: 'IMPORT_INVALID' });
    }
    expect(await db().transaction.count({ where: { assetId: asset.id } })).toBe(0);
  });
  it('ne crée aucune écriture avant confirmation et ne double jamais un import', async () => {
    const asset = await createAsset(),
      text = csv(asset.id),
      batch = await preview(text);
    expect(batch.errors).toEqual([]);
    expect(await db().transaction.count({ where: { assetId: asset.id } })).toBe(0);
    await confirm(batch.id);
    await confirm(batch.id);
    expect(await db().transaction.count({ where: { assetId: asset.id } })).toBe(1);
    await expect(preview(text)).rejects.toMatchObject({ status: 409 });
  });
  it('détecte les lignes invalides et interdit toute validation partielle', async () => {
    const asset = await createAsset(),
      batch = await preview(csv(asset.id, randomUUID(), '-1'));
    expect(batch.errors).toHaveLength(1);
    await expect(confirm(batch.id)).rejects.toMatchObject({ status: 422 });
    expect(await db().transaction.count({ where: { assetId: asset.id } })).toBe(0);
  });
  it('refuse un aperçu périmé après modification du portefeuille', async () => {
    const asset = await createAsset(),
      batch = await preview(csv(asset.id));
    await createAsset();
    await expect(confirm(batch.id)).rejects.toMatchObject({ status: 409 });
  });
  it('détecte les références déjà importées et les ventes sans provision', async () => {
    const asset = await createAsset(),
      reference = randomUUID(),
      batch = await preview(csv(asset.id, reference));
    await confirm(batch.id);
    expect((await preview(csv(asset.id, reference, '2'))).errors[0].message).toContain(
      'déjà utilisée',
    );
    expect(
      (await preview(csv(asset.id).replace(',BUY,', ',SELL,').replace(',1,100,', ',9,100,')))
        .errors[0].message,
    ).toContain('insuffisante');
  });
  it('isole les aperçus entre propriétaires', async () => {
    const asset = await createAsset(),
      batch = await preview(csv(asset.id));
    await expect(
      importCommand(secondId, ['imports', batch.id, 'confirm'], { confirmed: true }, randomUUID()),
    ).rejects.toMatchObject({ status: 404 });
  });
});
describe('Snapshots quotidiens', () => {
  it('crée une seule capture même avec deux jobs concurrents, au jour du portefeuille', async () => {
    const instant = new Date('2025-01-01T23:30:00Z');
    const [first, second] = await Promise.all([
      runSnapshot(portfolioId, true, instant),
      runSnapshot(portfolioId, true, instant),
    ]);
    expect(first!.id).toBe(second!.id);
    expect(first!.dailyKey).toBe('2025-01-02');
    expect(
      await db().portfolioSnapshot.count({ where: { portfolioId, dailyKey: '2025-01-02' } }),
    ).toBe(1);
  });
});
describe('Routes API privées', () => {
  const context = (path: string[]) => ({ params: Promise.resolve({ path }) });
  it('retourne 401 sans session', async () =>
    expect(
      (await GET(new Request('http://localhost:3000/api/v1/state'), context(['state']))).status,
    ).toBe(401));
  it('lit le portefeuille avec une session valide', async () => {
    const result = await GET(
      new Request('http://localhost:3000/api/v1/state', { headers: { cookie: sessionCookie } }),
      context(['state']),
    );
    expect(result.status).toBe(200);
    expect((await result.json()).data.portfolio.id).toBe(portfolioId);
    expect(result.headers.get('cache-control')).toContain('no-store');
  });
  it('refuse une mutation issue d’une origine tierce', async () => {
    const result = await POST(
      new Request('http://localhost:3000/api/v1/snapshots', {
        method: 'POST',
        headers: {
          cookie: sessionCookie,
          origin: 'https://other.example',
          'Content-Type': 'application/json',
        },
        body: '{}',
      }),
      context(['snapshots']),
    );
    expect(result.status).toBe(403);
  });
  it('exporte seulement les données du propriétaire et jamais les sessions', async () => {
    const result = await GET(
      new Request('http://localhost:3000/api/v1/exports/portfolio.json', {
        headers: { cookie: sessionCookie },
      }),
      context(['exports', 'portfolio.json']),
    );
    expect(result.status).toBe(200);
    const data = await result.json();
    expect(data.portfolio.id).toBe(portfolioId);
    expect(data.sessions).toBeUndefined();
    expect(JSON.stringify(data)).not.toContain(password);
  });
});
describe('Métaux et images privées', () => {
  it('calcule le métal fin et conserve le prix lorsque la source est indisponible', async () => {
    const category = await db().assetCategory.findFirstOrThrow({
      where: { portfolioId, key: 'METALS' },
    });
    const asset = (await commandFor('POST', 'assets', {
      name: 'Pièce',
      symbol: 'GOLD',
      categoryId: category.id,
      currency: 'EUR',
      platform: 'Coffre',
      metadata: { metalType: 'GOLD', weightGrams: '10', purity: '0.9', pricingMode: 'MANUAL' },
    })) as { id: string };
    await commandFor('POST', `assets/${asset.id}/prices`, {
      gramPrice: '50',
      premium: '20',
      observedAt: '2025-01-01T00:00:00Z',
    });
    const refreshed = (await commandFor('POST', `assets/${asset.id}/refresh`, {})) as {
      fallback: boolean;
      quote: { price: string };
    };
    expect(refreshed.fallback).toBe(true);
    expect(refreshed.quote.price).toBe('470');
    expect(await db().priceHistory.count({ where: { assetId: asset.id } })).toBe(1);
  });
  it('normalise les images, interdit les SVG et contrôle le propriétaire', async () => {
    const asset = await createAsset();
    const content = await sharp({
      create: { width: 10, height: 10, channels: 3, background: '#6366f1' },
    })
      .png()
      .toBuffer();
    await saveImage(userId, asset.id, { base64: content.toString('base64') }, randomUUID());
    const result = await getImage(userId, asset.id);
    expect(result.headers.get('content-type')).toBe('image/webp');
    expect(result.headers.get('cache-control')).toContain('no-store');
    await expect(getImage(secondId, asset.id)).rejects.toMatchObject({ status: 404 });
    await expect(
      saveImage(
        userId,
        asset.id,
        { base64: Buffer.from('<svg/>').toString('base64') },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 422 });
  });
});
