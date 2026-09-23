import { db } from './db';
import { metadataSchema } from '@/shared/schemas';
import { fetchSecurityQuote, type SecurityQuote } from '@/modules/prices/securities';
import type { TxDb } from './portfolio';

export async function saveSecurityQuote(
  tx: TxDb,
  asset: { id: string; portfolioId: string; currency: string },
  quote: SecurityQuote,
) {
  if (quote.currency !== asset.currency)
    throw new Error('La devise de cotation a changé. Le dernier cours connu est conservé.');
  const latest = await tx.priceHistory.findFirst({
    where: { assetId: asset.id },
    orderBy: [{ observedAt: 'desc' }, { createdAt: 'desc' }],
  });
  const observedAt = new Date(quote.observedAt);
  if (latest && latest.observedAt >= observedAt) return 0;
  await tx.priceHistory.create({
    data: {
      assetId: asset.id,
      portfolioId: asset.portfolioId,
      currency: asset.currency,
      price: quote.price,
      observedAt,
      source: `yahoo:${quote.symbol}`,
    },
  });
  return 1;
}

export async function syncSecuritiesPrices(portfolioId?: string) {
  const assets = await db().asset.findMany({
    where: {
      ...(portfolioId ? { portfolioId } : {}),
      deletedAt: null,
      status: 'ACTIVE',
      category: { key: 'SECURITIES' },
    },
  });
  const configured = assets.flatMap((asset) => {
    const parsed = metadataSchema.safeParse(asset.metadata);
    return parsed.success && parsed.data.pricingMode === 'SECURITIES_MARKET' && parsed.data.ticker
      ? [{ asset, ticker: parsed.data.ticker }]
      : [];
  });
  const tickers = [...new Set(configured.map((item) => item.ticker))];
  let prices = 0;
  const failures: { symbol: string; message: string }[] = [];
  // Bounded concurrency and one remote request per listing, even across multiple portfolios.
  for (let offset = 0; offset < tickers.length; offset += 4) {
    await Promise.all(
      tickers.slice(offset, offset + 4).map(async (ticker) => {
        try {
          const quote = await fetchSecurityQuote(ticker);
          for (const { asset } of configured.filter((item) => item.ticker === ticker)) {
            prices += await db().$transaction(async (tx) => {
              const current = await tx.asset.findFirst({
                where: { id: asset.id, version: asset.version, deletedAt: null, status: 'ACTIVE' },
              });
              return current ? saveSecurityQuote(tx, current, quote) : 0;
            });
          }
        } catch (error) {
          failures.push({
            symbol: ticker,
            message: error instanceof Error ? error.message : 'Cours indisponible.',
          });
        }
      }),
    );
  }
  return { prices, failures };
}
