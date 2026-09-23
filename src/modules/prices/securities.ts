import { z } from 'zod';
import { decimal as d } from '@/domain/money';

export const marketSymbolSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9.=-]{0,39}$/, 'Ticker invalide (exemple : MC.PA ou AAPL).');
export const securityQuoteSchema = z.object({
  symbol: marketSymbolSchema,
  name: z.string().min(1).max(120),
  exchange: z.string().max(120),
  currency: z.enum(['EUR', 'USD']),
  instrumentType: z.enum(['STOCK', 'ETF']),
  price: z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .refine((value) => d(value).gt(0)),
  observedAt: z.iso.datetime(),
});
export type SecurityQuote = z.infer<typeof securityQuoteSchema>;

export function parseSecurityQuote(
  input: unknown,
  symbol: string,
  now = new Date(),
): SecurityQuote {
  const envelope = z
    .object({
      chart: z.object({
        error: z.unknown().optional(),
        result: z
          .array(
            z.object({
              meta: z.object({
                symbol: z.string(),
                currency: z.string(),
                instrumentType: z.string(),
                regularMarketPrice: z.number().positive().finite(),
                regularMarketTime: z.number().int().positive(),
                longName: z.string().optional(),
                shortName: z.string().optional(),
                fullExchangeName: z.string().optional(),
                exchangeName: z.string().optional(),
              }),
            }),
          )
          .nullable(),
      }),
    })
    .parse(input);
  const meta = envelope.chart.result?.[0]?.meta;
  if (envelope.chart.error || !meta || meta.symbol.toUpperCase() !== symbol.toUpperCase())
    throw new Error('Produit introuvable ou ticker différent de celui demandé.');
  if (!['EQUITY', 'ETF'].includes(meta.instrumentType))
    throw new Error('Seuls les actions et ETF sont pris en charge.');
  if (!['EUR', 'USD'].includes(meta.currency))
    throw new Error(
      `Devise ${meta.currency} non prise en charge : choisissez une cotation en EUR ou USD.`,
    );
  const observedAt = new Date(meta.regularMarketTime * 1000);
  if (
    observedAt.getTime() > now.getTime() + 60_000 ||
    now.getTime() - observedAt.getTime() > 7 * 86400000
  )
    throw new Error('Le dernier cours disponible est trop ancien.');
  return securityQuoteSchema.parse({
    symbol: meta.symbol,
    name: (meta.longName || meta.shortName || meta.symbol).slice(0, 120),
    exchange: (meta.fullExchangeName || meta.exchangeName || '').slice(0, 120),
    currency: meta.currency,
    instrumentType: meta.instrumentType === 'ETF' ? 'ETF' : 'STOCK',
    price: d(meta.regularMarketPrice).toFixed(),
    observedAt: observedAt.toISOString(),
  });
}

async function yahooJson(path: string) {
  // Fixed host: CSV values are never treated as arbitrary URLs.
  const response = await fetch(`https://query1.finance.yahoo.com/${path}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
    headers: { Accept: 'application/json' },
  });
  if (!response.ok)
    throw new Error('Cours indisponibles temporairement. Réessayez dans quelques minutes.');
  return response.json();
}
export async function fetchSecurityQuote(symbol: string): Promise<SecurityQuote> {
  const ticker = marketSymbolSchema.parse(symbol);
  return parseSecurityQuote(
    await yahooJson(`v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`),
    ticker,
  );
}
export async function resolveSecurity(input: {
  ticker?: string;
  isin?: string;
}): Promise<SecurityQuote> {
  const ticker = input.ticker ? marketSymbolSchema.parse(input.ticker) : undefined;
  if (!input.isin) {
    if (!ticker) throw new Error('Renseignez un ticker de cotation ou un ISIN.');
    return fetchSecurityQuote(ticker);
  }
  const search = z
    .object({ quotes: z.array(z.object({ symbol: z.string(), quoteType: z.string().optional() })) })
    .parse(
      await yahooJson(
        `v1/finance/search?q=${encodeURIComponent(input.isin)}&quotesCount=20&newsCount=0`,
      ),
    );
  const symbols = [
    ...new Set(
      search.quotes
        .filter((item) => ['ETF', 'EQUITY'].includes(item.quoteType || ''))
        .map((item) => item.symbol.toUpperCase()),
    ),
  ];
  if (ticker) {
    if (!symbols.includes(ticker))
      throw new Error(
        'Le ticker ne correspond pas aux cotations trouvées pour cet ISIN. Vérifiez les identifiants.',
      );
    return fetchSecurityQuote(ticker);
  }
  if (symbols.length !== 1)
    throw new Error(
      symbols.length
        ? `Plusieurs cotations trouvées : ${symbols.slice(0, 6).join(', ')}. Précisez le ticker dans le CSV.`
        : 'ISIN non trouvé. Précisez le ticker de cotation dans le CSV.',
    );
  return fetchSecurityQuote(symbols[0]);
}
