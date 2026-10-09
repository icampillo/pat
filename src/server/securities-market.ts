import { z } from 'zod';
import { securityIsin } from '@/domain/security-identity';
import { AppError } from './errors';
import { owned, mutate, checkVersion, json } from './portfolio-store';
import {
  resolveSecurity,
  marketSymbolSchema,
  SecurityListingChoice,
} from '@/modules/prices/securities';
import { db } from './db';
import { marketQuote } from './market-cache';
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
  });
  let hasMore = assets.length > 500;
  const configured = assets.slice(0, 500).flatMap((asset) => {
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
          const quote = await marketQuote(`yahoo:${ticker}`, () => fetchSecurityQuote(ticker));
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

export async function repairSecurityPricing(
  userId: string,
  assetId: string,
  input: unknown,
  key: string | null,
) {
  const options = z
    .object({
      ticker: marketSymbolSchema.optional(),
      confirmed: z.boolean().default(false),
      version: z.number().int().positive().optional(),
    })
    .strict()
    .parse(input);
  const portfolio = await owned(userId);
  const asset = await db().asset.findFirst({
    where: {
      id: assetId,
      portfolioId: portfolio.id,
      deletedAt: null,
      status: 'ACTIVE',
      category: { key: 'SECURITIES' },
    },
  });
  if (!asset) throw new AppError('NOT_FOUND', 'Fiche Bourse active introuvable.', 404);
  const metadata = metadataSchema.parse(asset.metadata);
  if (!options.confirmed && metadata.pricingMode && metadata.pricingMode !== 'MANUAL')
    throw new AppError('PRICING_MODE', 'Cette fiche n’est pas en mode manuel.', 409);
  let quote: SecurityQuote;
  try {
    quote = await resolveSecurity({
      isin: securityIsin(asset),
      ticker: options.ticker || metadata.ticker,
    });
  } catch (error) {
    throw new AppError(
      error instanceof SecurityListingChoice ? 'LISTING_SELECTION_REQUIRED' : 'QUOTE_UNAVAILABLE',
      error instanceof z.ZodError ? 'Réponse de cotation invalide.' : (error as Error).message,
      422,
    );
  }
  if (quote.currency !== asset.currency)
    throw new AppError(
      'QUOTE_CURRENCY',
      'La cotation ne correspond pas à la devise de la fiche.',
      422,
    );
  if (!options.confirmed)
    return {
      id: asset.id,
      version: asset.version,
      quote,
      changes: { pricingMode: 'SECURITIES_MARKET', ticker: quote.symbol },
      preserved:
        'Identifiant, compte, transactions, frais, coûts, anciens cours et snapshots conservés.',
    };
  if (!options.version)
    throw new AppError('VERSION_REQUIRED', 'Prévisualisez la correction avant confirmation.', 428);
  return mutate(
    userId,
    key,
    `POST/securities/${assetId}/repair`,
    input,
    async (tx, currentPortfolio) => {
      const current = await tx.asset.findFirst({
        where: { id: assetId, portfolioId: currentPortfolio.id, deletedAt: null, status: 'ACTIVE' },
      });
      if (!current) throw new AppError('NOT_FOUND', 'Fiche introuvable.', 404);
      checkVersion(current.version, String(options.version));
      checkVersion(current.version, String(asset.version));
      const mode = (current.metadata as Record<string, unknown>).pricingMode;
      if (mode && mode !== 'MANUAL')
        throw new AppError('PRICING_MODE', 'Cette fiche n’est pas en mode manuel.', 409);
      await tx.asset.update({
        where: { id: assetId },
        data: {
          metadata: json({
            ...(current.metadata as Record<string, unknown>),
            ticker: quote.symbol,
            exchange: quote.exchange,
            instrumentType: quote.instrumentType,
            pricingMode: 'SECURITIES_MARKET',
          }),
          version: { increment: 1 },
        },
      });
      const prices = await saveSecurityQuote(tx, current, quote);
      return { id: assetId, prices, ticker: quote.symbol };
    },
  );
}
