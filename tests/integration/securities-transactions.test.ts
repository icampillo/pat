import 'dotenv/config';
import { configureTestDatabase } from '../database-env';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { db } from '@/server/db';
import { createUser } from '@/server/provision';
import { command } from '@/server/portfolio';
import { getState, runSnapshot } from '@/server/portfolio-query';
import { importCommand, type ImportPreview } from '@/server/imports';
import { previewSecurities, confirmSecurities } from '@/server/securities-import';
import { repairSecurityPricing, syncSecuritiesPrices } from '@/server/securities-market';
import { parseBoursoNotice } from '@/domain/bourso-notice';
import { sourceReference } from '@/server/import-matching';

const notice = `BoursoBank ACHAT COMPTANT ETR ACTION
Informations sur l'exécution 07/10/2026 09:58:14 30 iShares MSCI World Swap PEA UCITS ETF Référence : 123456789
Code ISIN : IE0002XZSHO1 Cours exécuté : 7,1930 EUR
Lieu d'exécution : EURONEXT PARIS
Montant transaction brut Intérêts Montant transaction total brut Courtages Montant transaction net
215,79 EUR 0,00 EUR 000 jours 215,79 EUR 0,00 EUR 0,00 EUR
Commission Frais divers Montant total des frais
1,08 EUR 0,00 EUR 1,08 EUR
Montant net au débit de votre compte 216,87 EUR`;
// Le décodage PDF réel reste couvert par portfolio.test.ts avec son PDF synthétique.
// Ici on exerce le chemin PDF avec le texte du cas financier demandé.
vi.mock('@/server/bourso-notice', () => ({
  readBoursoNotice: vi.fn(async () => parseBoursoNotice(notice)),
}));
configureTestDatabase();
beforeAll(() => {
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: process.env,
    stdio: 'pipe',
  });
});
beforeEach(async () => {
  await db().marketQuoteCache.deleteMany({});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
afterAll(async () => {
  await db().$disconnect();
});

const isin = 'IE0002XZSHO1';
const platform = 'BoursoBank PEA';
const pdf = { pdfBase64: 'JVBERi0=', platform };
const owner = () => createUser('Bourse tests', `${randomUUID()}@example.test`, randomUUID());
function provider(
  symbols = ['WPEA.PA'],
  price = 7.5,
  seconds = Math.floor(Date.now() / 1000) - 60,
) {
  const fetcher = vi.fn(async (url: string) =>
    url.includes('/search?')
      ? Response.json({ quotes: symbols.map((symbol) => ({ symbol, quoteType: 'ETF' })) })
      : Response.json({
          chart: {
            error: null,
            result: [
              {
                meta: {
                  symbol: decodeURIComponent(url.split('/chart/')[1].split('?')[0]),
                  currency: 'EUR',
                  instrumentType: 'ETF',
                  longName: 'iShares World',
                  fullExchangeName: 'Paris',
                  regularMarketPrice: price,
                  regularMarketTime: seconds,
                },
              },
            ],
          },
        }),
  );
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
async function preview(userId: string, input: unknown = pdf) {
  return (await importCommand(
    userId,
    ['imports', 'preview'],
    input,
    randomUUID(),
  )) as ImportPreview;
}
const confirm = (userId: string, id: string, decisions: { line: number; action: string }[] = []) =>
  importCommand(userId, ['imports', id, 'confirm'], { confirmed: true, decisions }, randomUUID());
async function csvInventory(user: Awaited<ReturnType<typeof owner>>) {
  // Date de l'inventaire de test antérieure au nouvel avis ; aucune donnée réelle.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
  provider();
  try {
    const batch = await previewSecurities(
      user.userId,
      {
        asOf: '2026-09-23T15:50:30.000Z',
        csv: 'name;isin;quantity;pru;currency\nLibellé CSV différent; ie0002xzsho1 ;10;7;EUR',
        platform,
      },
      randomUUID(),
    );
    expect(batch.errors).toEqual([]);
    await confirmSecurities(user.userId, batch.id, { confirmed: true }, randomUUID());
  } finally {
    vi.useRealTimers();
  }
  provider();
  return (await getState(user.userId)).rows[0];
}
async function manualAsset(user: Awaited<ReturnType<typeof owner>>, overrides = {}) {
  const category = await db().assetCategory.findFirstOrThrow({
    where: { portfolioId: user.portfolioId, key: 'SECURITIES' },
  });
  return await command(
    user.userId,
    'POST',
    ['assets'],
    {
      name: 'Ancien libellé',
      symbol: 'WPEA.PA',
      categoryId: category.id,
      currency: 'EUR',
      platform,
      metadata: {
        isin: ' ie0002xzsho1 ',
        ticker: 'WPEA.PA',
        pricingMode: 'MANUAL',
        costBasis: 'KNOWN',
      },
      ...overrides,
    },
    randomUUID(),
    null,
  );
}

it('renforce une position CSV par ISIN et compte sélectionné malgré des libellés différents, sans réimport', async () => {
  const user = await owner();
  const asset = await csvInventory(user);
  const before = await db().transaction.findMany({ where: { assetId: asset.id } });
  const accountId = asset.metadata.accountId;
  const batch = await preview(user.userId, {
    ...pdf,
    platform: 'Boursorama - intitulé du PDF',
    accountId,
  });
  expect(batch.errors).toEqual([]);
  expect(batch.summary).toMatchObject({ NEW: 1, reinforced: 1, newPositions: 0 });
  expect(batch.rows[0].data.assetId).toBe(asset.id);
  await confirm(user.userId, batch.id);
  const state = await getState(user.userId);
  expect(state.rows[0]).toMatchObject({ id: asset.id, quantity: '40', costEur: '286.87' });
  expect(state.transactions.find((t: { type: string }) => t.type === 'BUY')).toMatchObject({
    quantity: '30',
    unitPrice: '7.193',
    fees: '1.08',
    amount: '215.79',
  });
  expect(await db().transaction.findUnique({ where: { id: before[0].id } })).toEqual(before[0]);
  expect((await preview(user.userId, { ...pdf, accountId })).summary).toMatchObject({
    EXISTING: 1,
    NEW: 0,
  });
  expect(state.snapshots).toEqual([]);
});
it('crée une fiche depuis le PDF avec ticker vérifié, premier cours daté puis synchronisation', async () => {
  const user = await owner();
  const seconds = Math.floor(Date.now() / 1000) - 60;
  provider(['WPEA.PA'], 7.5, seconds);
  const batch = await preview(user.userId);
  expect(batch.errors).toEqual([]);
  expect(batch.summary.newPositions).toBe(1);
  expect(await db().asset.count({ where: { portfolioId: user.portfolioId } })).toBe(0);
  await confirm(user.userId, batch.id);
  const state = await getState(user.userId);
  expect(state.rows[0]).toMatchObject({
    symbol: 'WPEA.PA',
    quantity: '30',
    costEur: '216.87',
    price: '7.5',
    priceDate: new Date(seconds * 1000).toISOString(),
    metadata: { isin, ticker: 'WPEA.PA', pricingMode: 'SECURITIES_MARKET' },
  });
  provider(['WPEA.PA'], 7.6, seconds + 30);
  expect(await syncSecuritiesPrices(user.portfolioId)).toMatchObject({ prices: 1, failures: [] });
  expect(await syncSecuritiesPrices(user.portfolioId)).toMatchObject({ prices: 0, failures: [] });
  expect((await getState(user.userId)).rows[0].price).toBe('7.6');
});
it('conserve deux comptes distincts pour un ISIN identique et refuse asset_id sur le mauvais compte', async () => {
  const user = await owner();
  const pea = await csvInventory(user);
  const batch = await preview(user.userId, { ...pdf, platform: 'BoursoBank CTO' });
  expect(batch.summary).toMatchObject({ NEW: 1, newPositions: 1, reinforced: 0 });
  await confirm(user.userId, batch.id);
  expect((await getState(user.userId)).rows).toHaveLength(2);
  expect(
    (await getState(user.userId)).rows.find((a: { id: string }) => a.id === pea.id).quantity,
  ).toBe('10');
  const wrong = await preview(user.userId, {
    csv: `asset_id;type;quantity;unit_price;currency;occurred_at;platform\n${pea.id};BUY;1;7;EUR;2026-10-07;BoursoBank CTO`,
  });
  expect(wrong.errors[0].message).toContain('introuvable');
});
it('retrouve les ISIN historiques en minuscules, dans externalId, et les anciennes fiches ticker seules après vérification', async () => {
  const user = await owner();
  provider();
  const asset = await manualAsset(user);
  expect((await preview(user.userId)).rows[0].data.assetId).toBe(asset.id);
  await db().asset.update({
    where: { id: asset.id },
    data: { metadata: { pricingMode: 'MANUAL' }, externalId: ' ie0002xzsho1 ' },
  });
  expect((await preview(user.userId)).rows[0].data.assetId).toBe(asset.id);
  await db().asset.update({
    where: { id: asset.id },
    data: { metadata: { ticker: 'wpea.pa', pricingMode: 'MANUAL' }, externalId: null },
  });
  const byTicker = await preview(user.userId);
  expect(byTicker.errors).toEqual([]);
  expect(byTicker.rows[0].data.assetId).toBe(asset.id);
});
it('ne choisit pas une cotation ambiguë et revérifie la sélection explicite', async () => {
  const user = await owner();
  provider(['WPEA.PA', 'WPEA.DE']);
  const ambiguous = await preview(user.userId);
  expect(ambiguous.errors[0]).toMatchObject({ isin, symbols: ['WPEA.PA', 'WPEA.DE'] });
  await expect(confirm(user.userId, ambiguous.id)).rejects.toMatchObject({
    code: 'IMPORT_INVALID',
  });
  const wrong = await preview(user.userId, { ...pdf, listings: [{ isin, ticker: 'OTHER.PA' }] });
  expect(wrong.errors[0].message).toContain('correspond');
  const selected = await preview(user.userId, { ...pdf, listings: [{ isin, ticker: 'WPEA.PA' }] });
  expect(selected.errors).toEqual([]);
  await confirm(user.userId, selected.id);
  expect((await getState(user.userId)).rows[0].metadata.ticker).toBe('WPEA.PA');
});
it('ne crée ni position ni prix si le fournisseur ne trouve rien ou échoue', async () => {
  const user = await owner();
  provider([]);
  expect((await preview(user.userId)).errors[0].message).toContain('ISIN non trouvé');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('', { status: 503 })),
  );
  const unavailable = await preview(user.userId);
  expect(unavailable.errors[0].message).toContain('indisponibles');
  await expect(confirm(user.userId, unavailable.id)).rejects.toMatchObject({
    code: 'IMPORT_INVALID',
  });
  expect(await db().asset.count({ where: { portfolioId: user.portfolioId } })).toBe(0);
  expect(await db().priceHistory.count({ where: { portfolioId: user.portfolioId } })).toBe(0);
});
it('bloque un achat antérieur à un inventaire CSV, y compris un forçage CREATE', async () => {
  const user = await owner();
  provider();
  const inv = await previewSecurities(
    user.userId,
    {
      asOf: '2026-10-08T12:00:00.000Z',
      csv: 'isin;quantity;pru;currency\nIE0002XZSHO1;30;7.229;EUR',
      platform,
    },
    randomUUID(),
  );
  await confirmSecurities(user.userId, inv.id, { confirmed: true }, randomUUID());
  const before = await db().transaction.findMany({ where: { portfolioId: user.portfolioId } });
  const batch = await preview(user.userId);
  expect(batch.rows[0]).toMatchObject({
    status: 'INVENTORY_REVIEW',
    canCreate: false,
    candidates: [],
  });
  await expect(
    confirm(user.userId, batch.id, [{ line: 1, action: 'CREATE' }]),
  ).rejects.toMatchObject({ code: 'IMPORT_DECISION' });
  await confirm(user.userId, batch.id);
  expect(await db().transaction.findMany({ where: { portfolioId: user.portfolioId } })).toEqual(
    before,
  );
});
it('conserve les anciennes références broker basées sur le libellé du compte', async () => {
  const user = await owner();
  provider();
  const batch = await preview(user.userId);
  await confirm(user.userId, batch.id);
  const entry = await db().transaction.findFirstOrThrow({
    where: { portfolioId: user.portfolioId },
  });
  await db().transaction.update({
    where: { id: entry.id },
    data: { externalReference: sourceReference('BOURSORAMA', platform, '123456789') },
  });
  expect((await preview(user.userId)).summary.EXISTING).toBe(1);
});
it('refuse une position concurrente plutôt que créer un second actif pour le même ISIN/compte', async () => {
  const user = await owner();
  provider();
  const batch = await preview(user.userId);
  await manualAsset(user);
  await expect(confirm(user.userId, batch.id)).rejects.toMatchObject({ code: 'PREVIEW_STALE' });
  expect(await db().asset.count({ where: { portfolioId: user.portfolioId } })).toBe(1);
});
it('répare MANUAL après aperçu sans toucher aux identifiants, historique, frais, coûts ni snapshots', async () => {
  const user = await owner();
  provider();
  const asset = await manualAsset(user, {
    quantity: '10',
    acquisitionCost: '70',
    notes: 'À conserver',
  });
  await command(
    user.userId,
    'POST',
    ['assets', asset.id, 'prices'],
    { price: '7', observedAt: '2026-10-01T00:00:00Z' },
    randomUUID(),
    null,
  );
  await runSnapshot(user.portfolioId);
  const before = await getState(user.userId);
  const oldPrices = await db().priceHistory.findMany({ where: { assetId: asset.id } });
  const check = (await repairSecurityPricing(user.userId, asset.id, {}, randomUUID())) as {
    version: number;
  };
  const afterPreview = await getState(user.userId);
  expect({ ...afterPreview, asOf: before.asOf }).toEqual(before);
  const key = randomUUID();
  const input = { confirmed: true, version: check.version, ticker: 'WPEA.PA' };
  const result = await repairSecurityPricing(user.userId, asset.id, input, key);
  expect(await repairSecurityPricing(user.userId, asset.id, input, key)).toEqual(result);
  const after = await getState(user.userId);
  expect(after.transactions).toEqual(before.transactions);
  expect(after.snapshots).toEqual(before.snapshots);
  expect(after.rows[0]).toMatchObject({
    id: asset.id,
    quantity: '10',
    costEur: '70',
    notes: 'À conserver',
    symbol: asset.symbol,
    metadata: { pricingMode: 'SECURITIES_MARKET', ticker: 'WPEA.PA', costBasis: 'KNOWN' },
  });
  expect(await db().priceHistory.findUnique({ where: { id: oldPrices[0].id } })).toEqual(
    oldPrices[0],
  );
  expect(
    await db().transactionRevision.count({ where: { transaction: { assetId: asset.id } } }),
  ).toBe(1);
});
it('refuse une réparation étrangère, obsolète, en devise différente ou sans cotation vérifiée', async () => {
  const user = await owner(),
    other = await owner();
  provider();
  const asset = await manualAsset(user);
  await expect(
    repairSecurityPricing(other.userId, asset.id, {}, randomUUID()),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(
    repairSecurityPricing(user.userId, asset.id, { confirmed: true, version: 99 }, randomUUID()),
  ).rejects.toMatchObject({ code: 'STALE_VERSION' });
  provider([]);
  await expect(repairSecurityPricing(user.userId, asset.id, {}, randomUUID())).rejects.toThrow(
    /correspond/,
  );
  provider();
  await db().asset.update({ where: { id: asset.id }, data: { currency: 'USD' } });
  await expect(
    repairSecurityPricing(user.userId, asset.id, {}, randomUUID()),
  ).rejects.toMatchObject({ code: 'QUOTE_CURRENCY' });
  expect((await db().asset.findUniqueOrThrow({ where: { id: asset.id } })).metadata).toMatchObject({
    pricingMode: 'MANUAL',
  });
});
