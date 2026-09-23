export interface PriceableAsset {
  id: string;
  symbol: string;
  currency: string;
  category: string;
  externalId?: string;
}
export interface PriceQuote {
  price: string;
  currency: string;
  source: string;
  observedAt: Date;
  fetchedAt: Date;
}
export interface PriceProvider {
  readonly id: string;
  getPrice(asset: PriceableAsset): Promise<PriceQuote>;
}
export class ManualPriceProvider implements PriceProvider {
  readonly id = 'manual';
  constructor(private lookup: (id: string) => Promise<PriceQuote | null>) {}
  async getPrice(asset: PriceableAsset) {
    const quote = await this.lookup(asset.id);
    if (!quote) throw new Error('NO_MANUAL_PRICE');
    return quote;
  }
}
export class UnconfiguredProvider implements PriceProvider {
  constructor(readonly id: 'crypto' | 'securities' | 'metals' | 'cards') {}
  async getPrice(): Promise<PriceQuote> {
    throw new Error('PROVIDER_NOT_CONFIGURED');
  }
}
export async function withFallback(
  provider: PriceProvider,
  asset: PriceableAsset,
  lastKnown: PriceQuote | null,
  log: (code: string) => void,
) {
  try {
    const quote = await provider.getPrice(asset);
    if (
      quote.currency !== asset.currency ||
      !/^\d+(\.\d+)?$/.test(quote.price) ||
      !Number.isFinite(quote.observedAt.getTime()) ||
      quote.observedAt.getTime() > Date.now()
    )
      throw new Error('INVALID_QUOTE');
    return { quote, stale: Date.now() - quote.observedAt.getTime() > 86400000, fallback: false };
  } catch {
    log('PRICE_PROVIDER_FAILED');
    return {
      quote: lastKnown?.currency === asset.currency ? lastKnown : null,
      stale: true,
      fallback: true,
    };
  }
}
