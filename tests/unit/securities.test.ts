import { afterEach, expect, it, vi } from 'vitest';
import { parseCsvDecimal, parseSecuritiesCsv } from '../../src/domain/securities-csv';
import { parseSecurityQuote, resolveSecurity } from '../../src/modules/prices/securities';

const header =
  'name;isin;quantity;buyingPrice;lastPrice;intradayVariation;amount;amountVariation;variation';
const quote = (extra = {}) => ({
  chart: {
    error: null,
    result: [
      {
        meta: {
          symbol: 'TEST.PA',
          currency: 'EUR',
          instrumentType: 'ETF',
          regularMarketPrice: 12.5,
          regularMarketTime: Math.floor(Date.now() / 1000),
          longName: 'ETF de test',
          exchangeName: 'PAR',
          ...extra,
        },
      },
    ],
  },
});
afterEach(() => vi.unstubAllGlobals());

it('reads the Bourso positions format with French decimals, rounding and a declared currency', () => {
  const result = parseSecuritiesCsv(
    `${header}\nETF de test;FR0011871128;2,00;10,00;11,00;0,10;21,99;1,98;9,90`,
    'BoursoBank PEA',
  );
  expect(result.errors).toEqual([]);
  expect(result.rows[0]).toMatchObject({
    quantity: '2',
    acquisitionCost: '20.01',
    costCurrency: 'EUR',
    costSource: 'BOURSO_PNL',
    platform: 'BoursoBank PEA',
  });
  expect(
    parseSecuritiesCsv(`${header}\nETF;FR0011871128;2;10;9;0;18;-2;-10`).rows[0].acquisitionCost,
  ).toBe('20');
});
it('supports generic CSVs, decimal separators and unknown or explicitly zero cost', () => {
  expect(parseCsvDecimal('1 234,56')).toBe('1234.56');
  expect(parseCsvDecimal('1,234.56')).toBe('1234.56');
  expect(parseSecuritiesCsv('ticker,quantity\nAAPL,2').rows[0]).toMatchObject({
    acquisitionCost: null,
    costSource: 'UNKNOWN',
  });
  expect(
    parseSecuritiesCsv('ticker;quantity;acquisition_cost;currency\nAAPL;2;0;USD').rows[0]
      .acquisitionCost,
  ).toBe('0');
  expect(
    parseSecuritiesCsv('ticker;quantity;pru;devise\nAAPL;2;10;USD').rows[0].acquisitionCost,
  ).toBe('20');
});
it('rejects inconsistent costs, duplicate headers, unsupported currency and transaction CSVs', () => {
  expect(parseSecuritiesCsv(`${header}\nETF;FR0011871128;2;10;11;0;22;10;100`).errors).toHaveLength(
    1,
  );
  expect(parseSecuritiesCsv('ticker;quantity;pru\nAAPL;2;10').errors[0].message).toContain(
    'devise',
  );
  expect(parseSecuritiesCsv('ticker;quantity;pru;currency\nAAPL;2;10;GBP').errors).toHaveLength(1);
  expect(parseSecuritiesCsv('ticker;quantity\nAAPL;0').errors).toHaveLength(1);
  expect(() => parseSecuritiesCsv('ticker;quantity;quantité\nAAPL;2;2')).toThrow();
  expect(() => parseSecuritiesCsv('ticker;quantity;type\nAAPL;2;BUY')).toThrow(/transactions/);
});
it('validates quote identity, product type, currency, price and source timestamp', () => {
  expect(parseSecurityQuote(quote(), 'TEST.PA')).toMatchObject({
    currency: 'EUR',
    price: '12.5',
    instrumentType: 'ETF',
  });
  for (const bad of [
    { symbol: 'OTHER' },
    { currency: 'GBp' },
    { instrumentType: 'CRYPTOCURRENCY' },
    { regularMarketPrice: 0 },
    { regularMarketTime: 1 },
    { regularMarketTime: Math.floor(Date.now() / 1000) + 3600 },
  ])
    expect(() => parseSecurityQuote(quote(bad), 'TEST.PA')).toThrow();
});
it('resolves a unique ISIN without confusing mutual funds with exchange-listed ETFs', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.includes('/search?')
        ? Response.json({
            quotes: [
              { symbol: 'TEST.PA', quoteType: 'ETF' },
              { symbol: 'FUND.SG', quoteType: 'MUTUALFUND' },
            ],
          })
        : Response.json(quote()),
    ),
  );
  expect((await resolveSecurity({ isin: 'FR0011871128' })).symbol).toBe('TEST.PA');
  await expect(resolveSecurity({ isin: 'FR0011871128', ticker: 'WRONG' })).rejects.toThrow(
    /correspond/,
  );
});
it('does not guess an ambiguous listing or manufacture a price on provider failure', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        quotes: [
          { symbol: 'ONE.PA', quoteType: 'ETF' },
          { symbol: 'TWO.DE', quoteType: 'ETF' },
        ],
      }),
    ),
  );
  await expect(resolveSecurity({ isin: 'FR0011871128' })).rejects.toThrow(/Plusieurs/);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('', { status: 429 })),
  );
  await expect(resolveSecurity({ ticker: 'AAPL' })).rejects.toThrow(/indisponibles/);
  await expect(resolveSecurity({ ticker: 'https://evil.test' })).rejects.toThrow();
});
