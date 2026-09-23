import 'dotenv/config';
import { db } from '../src/server/db';
import { getState } from '../src/server/portfolio';

const rate = await db().fxRate.findFirst({ orderBy: { observedAt: 'desc' } });
const quote = await db().priceHistory.findFirst({
  where: { source: { startsWith: 'gold-api:' } },
  orderBy: { createdAt: 'desc' },
});
const portfolio = await db().portfolio.findFirst({ where: { isDemo: false } });
const state = portfolio ? await getState(portfolio.ownerId) : null;
console.log(JSON.stringify({
  now: new Date().toISOString(),
  rate: rate && { value: String(rate.eurUsd), at: rate.observedAt.toISOString(), source: rate.source },
  quote: quote && { value: String(quote.price), at: quote.observedAt.toISOString(), source: quote.source },
  portfolio: state && {
    totalEur: state.totals.valueEur,
    totalUsd: state.totals.valueUsd,
    coins: state.rows.filter((row: { category: { key: string } }) => row.category.key === 'METALS').length,
    walletCount: state.onchain.wallets.length,
  },
}, null, 2));
await db().$disconnect();
