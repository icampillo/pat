import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { db } from '../src/server/db';
import { createUser } from '../src/server/provision';
import { insertTransaction, capture } from '../src/server/portfolio';
import { precise, decimal as d } from '../src/domain/money';
const email = 'demo@patrimoine.local';
const existing = await db().user.findUnique({ where: { email } });
if (existing) {
  console.log('Le compte de démonstration existe déjà. Aucune donnée modifiée.');
  await db().$disconnect();
  process.exit(0);
}
const password = randomBytes(18).toString('base64url');
const owner = await createUser('Ilan', email, password, true);
mkdirSync('.local', { recursive: true });
writeFileSync('.local/demo-access.json', JSON.stringify({ email, password }, null, 2), {
  mode: 0o600,
});
const now = new Date();
const start = new Date(now.getTime() - 400 * 86400000);
const entries = [
  ['Bitcoin', 'BTC', 'CRYPTO', '0.28', '41000', '64500', 'Ledger', { network: 'Bitcoin' }],
  ['Ethereum', 'ETH', 'CRYPTO', '2.4', '2100', '2850', 'Ledger', { network: 'Ethereum' }],
  [
    'S&P 500 UCITS ETF',
    'SXR8',
    'SECURITIES',
    '14',
    '440',
    '538',
    'Courtier',
    { instrumentType: 'ETF', exchange: 'XETRA' },
  ],
  [
    'Nova Technologies (fictif)',
    'NOVA',
    'SECURITIES',
    '30',
    '92',
    '83',
    'Courtier',
    { instrumentType: 'STOCK' },
  ],
  [
    'Napoléon 20 francs',
    'NAP20',
    'METALS',
    '4',
    '410',
    '495',
    'Coffre',
    {
      metalType: 'GOLD',
      weightGrams: '6.45',
      purity: '0.9',
      coinType: '20 francs',
      pricingMode: 'MANUAL',
    },
  ],
  [
    'Once d’argent',
    'AG1OZ',
    'METALS',
    '20',
    '25',
    '31',
    'Coffre',
    { metalType: 'SILVER', weightGrams: '31.1035', purity: '0.999', pricingMode: 'MANUAL' },
  ],
  [
    'Dracaufeu · Set de base',
    '4/102',
    'POKEMON',
    '1',
    '480',
    '720',
    'Collection',
    { setName: 'Set de base', language: 'Français', condition: 'Très bon', cardNumber: '4/102' },
  ],
  [
    'Monkey D. Luffy',
    'OP05-119',
    'ONE_PIECE',
    '1',
    '185',
    '245',
    'Collection',
    {
      setName: 'Awakening of the New Era',
      language: 'Japonais',
      condition: 'Excellent',
      cardNumber: 'OP05-119',
    },
  ],
] as const;
await db().$transaction(
  async (tx) => {
    const cats = await tx.assetCategory.findMany({ where: { portfolioId: owner.portfolioId } });
    await tx.fxRate.create({
      data: { portfolioId: owner.portfolioId, eurUsd: '1.1', source: 'demo', observedAt: start },
    });
    for (const [name, symbol, category, quantity, bought, current, platform, metadata] of entries) {
      const asset = await tx.asset.create({
        data: {
          portfolioId: owner.portfolioId,
          categoryId: cats.find((c) => c.key === category)!.id,
          name,
          symbol,
          currency: 'EUR',
          platform,
          metadata,
          notes: 'Exemple fictif — ne constitue pas une cotation de marché.',
        },
      });
      await insertTransaction(tx, owner.portfolioId, owner.userId, {
        assetId: asset.id,
        type: 'BUY',
        quantity,
        unitPrice: bought,
        fees: '0',
        currency: 'EUR',
        platform,
        occurredAt: start.toISOString(),
        settlement: 'EXTERNAL',
        comment: 'Données de démonstration',
      });
      const prices = Array.from({ length: 401 }, (_, day) => {
        const progress = day / 400;
        const wobble = day === 400 ? 0 : Math.sin(day / 19) * 0.035 + Math.sin(day / 7) * 0.012;
        const price = d(bought)
          .add(d(current).sub(bought).mul(String(progress)))
          .mul(String(1 + wobble));
        return {
          portfolioId: owner.portfolioId,
          assetId: asset.id,
          currency: 'EUR',
          price: precise(price),
          source: 'demo',
          observedAt: new Date(start.getTime() + day * 86400000),
        };
      });
      await tx.priceHistory.createMany({ data: prices });
    }
    await tx.portfolio.update({ where: { id: owner.portfolioId }, data: { version: 1 } });
  },
  { timeout: 30_000 },
);
for (let day = 0; day <= 400; day++) {
  await db().$transaction(
    (tx) => capture(tx, owner.portfolioId, 1, 'SEED', new Date(start.getTime() + day * 86400000)),
    { timeout: 20_000 },
  );
}
console.log(
  'Démonstration créée : 8 actifs, 8 achats, 401 snapshots. Identifiants dans .local/demo-access.json (ignoré par Git).',
);
await db().$disconnect();
