import { db } from './db';
import { metadataSchema } from '@/shared/schemas';
import { fetchSecurityQuote, type SecurityQuote } from '@/modules/prices/securities';
import type { TxDb } from './portfolio-store';

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
  const started = Date.now();
  const assets = await db().asset.findMany({
    where: {
      ...(portfolioId ? { portfolioId } : {}),
      deletedAt: null,
      status: 'ACTIVE',
      category: { key: 'SECURITIES' },
    },
    orderBy: { id: 'asc' },
    take: 501,
    include: { prices: { orderBy: [{ observedAt: 'desc' }, { createdAt: 'desc' }], take: 1 } },
  });
  let hasMore = assets.length > 500;
  const configured = assets.slice(0, 500).flatMap((asset) => {
    if (
      asset.prices[0]?.source.startsWith('yahoo:') &&
      Date.now() - asset.prices[0].createdAt.getTime() < 60_000
    )
      return [];
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
    if (Date.now() - started >= 150_000) {
      hasMore = true;
      break;
    }
    await Promise.all(
      tickers.slice(offset, offset + 4).map(async (ticker) => {
        try {
          const quote = await fetchSecurityQuote(ticker);
          for (const { asset } of configured.filter((item) => item.ticker === ticker)) {
            if (Date.now() - started >= 180_000) {
              hasMore = true;
              break;
            }
            prices += await db().$transaction(
              async (tx) => {
                await tx.$queryRaw`SELECT id FROM "Portfolio" WHERE id = ${asset.portfolioId}::uuid FOR UPDATE`;
                const current = await tx.asset.findFirst({
                  where: {
                    id: asset.id,
                    version: asset.version,
                    deletedAt: null,
                    status: 'ACTIVE',
                  },
                });
                return current ? saveSecurityQuote(tx, current, quote) : 0;
              },
              { timeout: 10_000 },
            );
          }
        } catch {
          failures.push({
            symbol: ticker,
            message: 'Cours indisponible ; dernière valeur conservée.',
          });
        }
      }),
    );
  }
  return { prices, failures, hasMore };
}
