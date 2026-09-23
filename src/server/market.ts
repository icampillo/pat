import { db } from './db';
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
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`MARKET_HTTP_${response.status}`);
  return response.text();
}

export async function fetchEcbRate() {
  return parseEcbRate(await fetchText(ECB_URL));
}

async function syncMetalMarketData(portfolioId?: string) {
  const now = new Date();
  const portfolios = await db().portfolio.findMany({
    where: portfolioId ? { id: portfolioId } : {},
    select: { id: true },
  });
  if (!portfolios.length) return { rates: 0, prices: 0 };

  const rate = parseEcbRate(await fetchText(ECB_URL), now);
  const spotResults = await Promise.allSettled([
    fetchText(`${METAL_URL}XAU`).then((body) => parseMetalSpot(JSON.parse(body), 'GOLD', now)),
    fetchText(`${METAL_URL}XAG`).then((body) => parseMetalSpot(JSON.parse(body), 'SILVER', now)),
  ]);
  const gold = spotResults[0].status === 'fulfilled' ? spotResults[0].value : null;
  const silver = spotResults[1].status === 'fulfilled' ? spotResults[1].value : null;
  const spots = { GOLD: gold, SILVER: silver };
  let rates = 0;
  let prices = 0;
  for (const portfolio of portfolios) {
    const result = await db().$transaction(
      async (tx) => {
        let newRate = 0;
        let newPrices = 0;
        const existingRate = await tx.fxRate.findFirst({
          where: { portfolioId: portfolio.id, source: 'ecb', observedAt: rate.observedAt },
        });
        if (!existingRate) {
          await tx.fxRate.create({ data: { portfolioId: portfolio.id, ...rate, source: 'ecb' } });
          newRate = 1;
        }
        const assets = await tx.asset.findMany({
          where: { portfolioId: portfolio.id, deletedAt: null, category: { key: 'METALS' } },
        });
        for (const asset of assets) {
          if (asset.currency !== 'EUR') continue;
          const parsed = metadataSchema.safeParse(asset.metadata);
          if (!parsed.success) continue;
          const meta = parsed.data;
          if (
            meta.pricingMode !== 'METAL_MARKET' ||
            !meta.metalType ||
            !meta.weightGrams ||
            !meta.purity
          )
            continue;
          const spot = spots[meta.metalType];
          if (!spot) continue;
          const latest = await tx.priceHistory.findFirst({
            where: { assetId: asset.id },
            orderBy: [{ observedAt: 'desc' }, { createdAt: 'desc' }],
          });
          if (
            latest?.source === `gold-api:${meta.metalType}:ecb` &&
            latest.observedAt >= spot.observedAt
          )
            continue;
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
          newPrices++;
        }
        return { newRate, newPrices };
      },
      { timeout: 20_000 },
    );
    rates += result.newRate;
    prices += result.newPrices;
  }
  return {
    rates,
    prices,
    rateDate: rate.observedAt.toISOString(),
    goldAt: gold?.observedAt.toISOString() ?? null,
    silverAt: silver?.observedAt.toISOString() ?? null,
    ...(!gold || !silver
      ? { warning: 'Certains cours de métaux sont indisponibles ; dernières valeurs conservées.' }
      : {}),
  };
}

export async function syncMarketData(portfolioId?: string) {
  const [metals, securities] = await Promise.allSettled([
    syncMetalMarketData(portfolioId),
    syncSecuritiesPrices(portfolioId),
  ]);
  if (metals.status === 'rejected')
    console.warn(JSON.stringify({ code: 'METAL_MARKET_UNAVAILABLE' }));
  return {
    ...(metals.status === 'fulfilled' ? metals.value : { rates: 0, prices: 0 }),
    securities:
      securities.status === 'fulfilled'
        ? securities.value
        : {
            prices: 0,
            failures: [{ symbol: '', message: 'Actualisation boursière indisponible.' }],
          },
    ...(metals.status === 'rejected'
      ? { warning: 'Métaux ou taux indisponibles ; dernières valeurs conservées.' }
      : {}),
  };
}
