import { db } from './db';
import { marketQuote } from './market-cache';
import { providerFetch } from './provider-fetch';
import { decimal as d, metalValue, precise } from '@/domain/money';
import { metadataSchema } from '@/shared/schemas';
import { syncSecuritiesPrices } from './securities-market';

const TROY_OUNCE_GRAMS = '31.1034768';
const ECB_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
const METAL_URL = 'https://api.gold-api.com/price/';
const MAX_QUOTE_AGE_MS = 7 * 86400000;

type Metal = 'GOLD' | 'SILVER';
type Spot = { metal: Metal; usdPerOunce: string; observedAt: Date };
type Rate = { eurUsd: string; observedAt: Date };

function validPositive(value: unknown): string {
  const text = String(value);
  if (!/^\d+(\.\d+)?$/.test(text) || !d(text).gt(0) || !d(text).lt(1_000_000))
    throw new Error('INVALID_MARKET_PRICE');
  return text;
}

export function parseEcbRate(xml: string, now = new Date()): Rate {
  const date = xml.match(/<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]\s*>/)?.[1];
  const usd = xml.match(/<Cube\s+currency=['"]USD['"]\s+rate=['"]([\d.]+)['"]\s*\/>/)?.[1];
  if (!date || !usd) throw new Error('INVALID_ECB_RESPONSE');
  const observedAt = new Date(`${date}T00:00:00Z`);
  if (
    !Number.isFinite(observedAt.getTime()) ||
    observedAt.getTime() > now.getTime() ||
    now.getTime() - observedAt.getTime() > MAX_QUOTE_AGE_MS
  )
    throw new Error('STALE_ECB_RATE');
  return { eurUsd: validPositive(usd), observedAt };
}

export function parseMetalSpot(input: unknown, metal: Metal, now = new Date()): Spot {
  const row = input as Record<string, unknown>;
  const symbol = metal === 'GOLD' ? 'XAU' : 'XAG';
  if (!row || row.symbol !== symbol || row.currency !== 'USD')
    throw new Error('INVALID_METAL_RESPONSE');
  const observedAt = new Date(String(row.updatedAt));
  if (
    !Number.isFinite(observedAt.getTime()) ||
    observedAt.getTime() > now.getTime() + 60_000 ||
    now.getTime() - observedAt.getTime() > MAX_QUOTE_AGE_MS
  )
    throw new Error('STALE_METAL_SPOT');
  return { metal, usdPerOunce: validPositive(row.price), observedAt };
}

export function coinSpotValue(
  weightGrams: string,
  purity: string,
  usdPerOunce: string,
  eurUsd: string,
  premium = '0',
) {
  const eurPerGram = precise(d(usdPerOunce).div(eurUsd).div(TROY_OUNCE_GRAMS));
  return metalValue(weightGrams, purity, eurPerGram, premium);
}

async function fetchText(url: string) {
  const response = await providerFetch(url);
  if (!response.ok) throw new Error(`MARKET_HTTP_${response.status}`);
  return response.text();
}

export async function fetchEcbRate() {
  const rate = await marketQuote('ecb:EURUSD', async () => {
    const value = parseEcbRate(await fetchText(ECB_URL));
    return { ...value, observedAt: value.observedAt.toISOString() };
  });
  return { ...rate, observedAt: new Date(rate.observedAt) };
}

// Bootstrap conversion for fresh portfolios without waiting for the market cron.
// Existing (including manual) rates remain owned by the normal market refresh.
export async function ensurePortfolioFxRate(portfolioId: string) {
  const where = { portfolioId, observedAt: { lte: new Date() } };
  if (await db().fxRate.findFirst({ where })) return;
  const rate = await fetchEcbRate();
  await db().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Portfolio" WHERE id = ${portfolioId}::uuid FOR UPDATE`;
    if (!(await tx.fxRate.findFirst({ where })))
      await tx.fxRate.create({ data: { portfolioId, ...rate, source: 'ecb' } });
  });
}

async function syncMetalMarketData(portfolioId?: string) {
  const now = new Date();
  const started = Date.now();
  const portfolios = await db().portfolio.findMany({
    where: portfolioId ? { id: portfolioId } : {},
    orderBy: { id: 'asc' },
    take: 101,
    select: {
      id: true,
      rates: { where: { source: 'ecb' }, orderBy: { observedAt: 'desc' }, take: 1 },
      assets: {
        where: { deletedAt: null, status: 'ACTIVE', category: { key: 'METALS' } },
        select: {
          id: true,
          currency: true,
          metadata: true,
        },
      },
    },
  });
  const result = { rates: 0, prices: 0, failed: 0, hasMore: portfolios.length > 100 };
  if (!portfolios.length) return result;
  const configured = portfolios.slice(0, 100).map((portfolio) => ({
    ...portfolio,
    assets: portfolio.assets.flatMap((asset) => {
      const parsed = metadataSchema.safeParse(asset.metadata);
      const meta = parsed.success ? parsed.data : null;
      if (
        asset.currency !== 'EUR' ||
        meta?.pricingMode !== 'METAL_MARKET' ||
        !meta.metalType ||
        !meta.weightGrams ||
        !meta.purity
      )
        return [];
      return [{ ...asset, meta }];
    }),
  }));
  // The ECB publishes one fixing per working day; reuse today's persisted fixing.
  const cached = portfolios
    .flatMap((p) => p.rates)
    .find((r) => r.observedAt.toISOString().slice(0, 10) === now.toISOString().slice(0, 10));
  const rate = cached
    ? { eurUsd: String(cached.eurUsd), observedAt: cached.observedAt }
    : await fetchEcbRate();
  const metals = [...new Set(configured.flatMap((p) => p.assets.map((a) => a.meta.metalType!)))];
  const spots = new Map<Metal, Spot>();
  await Promise.all(
    metals.map(async (metal) => {
      try {
        const spot = await marketQuote(`gold-api:${metal}`, async () => {
          const value = parseMetalSpot(
            JSON.parse(await fetchText(`${METAL_URL}${metal === 'GOLD' ? 'XAU' : 'XAG'}`)),
            metal,
          );
          return { ...value, observedAt: value.observedAt.toISOString() };
        });
        spots.set(metal, { ...spot, observedAt: new Date(spot.observedAt) });
      } catch {
        result.failed++;
        console.warn(JSON.stringify({ job: 'market', code: 'METAL_QUOTE_UNAVAILABLE' }));
      }
    }),
  );
  for (const portfolio of configured) {
    if (Date.now() - started >= 180_000) {
      result.hasMore = true;
      break;
    }
    try {
      const changes = await db().$transaction(
        async (tx) => {
          // Serialize quote writers, including overlapping cron/manual invocations. No remote I/O here.
          await tx.$queryRaw`SELECT id FROM "Portfolio" WHERE id = ${portfolio.id}::uuid FOR UPDATE`;
          let rates = 0,
            prices = 0;
          const existingRate = await tx.fxRate.findFirst({
            where: { portfolioId: portfolio.id, source: 'ecb', observedAt: rate.observedAt },
          });
          if (!existingRate) {
            await tx.fxRate.create({ data: { portfolioId: portfolio.id, ...rate, source: 'ecb' } });
            rates++;
          }
          for (const candidate of portfolio.assets) {
            const asset = await tx.asset.findFirst({
              where: { id: candidate.id, deletedAt: null, status: 'ACTIVE' },
            });
            const parsed = metadataSchema.safeParse(asset?.metadata);
            if (!asset || asset.currency !== 'EUR' || !parsed.success) continue;
            const meta = parsed.data;
            if (
              meta.pricingMode !== 'METAL_MARKET' ||
              !meta.metalType ||
              !meta.weightGrams ||
              !meta.purity
            )
              continue;
            const spot = spots.get(meta.metalType);
            if (!spot) continue;
            const latest = await tx.priceHistory.findFirst({
              where: { assetId: asset.id },
              orderBy: [{ observedAt: 'desc' }, { createdAt: 'desc' }],
            });
            if (latest && latest.observedAt >= spot.observedAt) continue;
            await tx.priceHistory.create({
              data: {
                portfolioId: portfolio.id,
                assetId: asset.id,
                currency: 'EUR',
                source: `gold-api:${meta.metalType}:ecb`,
                observedAt: spot.observedAt,
                price: coinSpotValue(
                  meta.weightGrams,
                  meta.purity,
                  spot.usdPerOunce,
                  rate.eurUsd,
                  meta.premium || '0',
                ),
              },
            });
            prices++;
          }
          return { rates, prices };
        },
        { timeout: 20_000 },
      );
      result.rates += changes.rates;
      result.prices += changes.prices;
    } catch {
      result.failed++;
      console.warn(JSON.stringify({ job: 'market', code: 'METAL_WRITE_FAILED' }));
    }
  }
  return {
    ...result,
    rateDate: rate.observedAt.toISOString(),
    ...(result.failed
      ? { warning: 'Certains cours sont indisponibles ; dernières valeurs conservées.' }
      : {}),
  };
}

export async function syncMarketData(portfolioId?: string) {
  const [metals, securities] = await Promise.allSettled([
    syncMetalMarketData(portfolioId),
    syncSecuritiesPrices(portfolioId),
  ]);
  if (metals.status === 'rejected')
    console.warn(JSON.stringify({ job: 'market', code: 'METAL_MARKET_UNAVAILABLE' }));
  const metalResult =
    metals.status === 'fulfilled'
      ? metals.value
      : {
          rates: 0,
          prices: 0,
          failed: 1,
          hasMore: false,
          warning: 'Métaux ou taux indisponibles ; dernières valeurs conservées.',
        };
  const securitiesResult =
    securities.status === 'fulfilled'
      ? securities.value
      : {
          prices: 0,
          failures: [{ symbol: '', message: 'Actualisation boursière indisponible.' }],
          hasMore: false,
        };
  return {
    ...metalResult,
    securities: securitiesResult,
    failed: metalResult.failed + securitiesResult.failures.length,
    hasMore: metalResult.hasMore || securitiesResult.hasMore,
  };
}
