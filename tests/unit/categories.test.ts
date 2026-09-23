import { describe, expect, it } from 'vitest';
import {
  buildCategoryDetails,
  calculateCategoryValue,
  calculateCategoryWeight,
  calculatePerformance,
  calculateUnrealizedPnL,
  filterCategoryHistory,
  performance30d,
  snapshotCategoryValues,
} from '../../src/domain/categories';
import type { AppState, AssetView } from '../../src/shared/types';

const category = { id: 'crypto', key: 'CRYPTO', label: 'Crypto', color: '#6556dc' };
const now = '2026-09-23T12:00:00Z';
const asset = (overrides: Partial<AssetView> = {}): AssetView =>
  ({
    id: 'a',
    name: 'Bitcoin',
    quantity: '2',
    categoryId: category.id,
    valueEur: '100',
    valueUsd: '125',
    costEur: '80',
    costUsd: '100',
    price: '62.5',
    currency: 'USD',
    metadata: {},
    deletedAt: null,
    ...overrides,
  }) as AssetView;
const state = (rows: AssetView[] = [asset()]): AppState =>
  ({
    rows,
    categories: [category],
    asOf: now,
    snapshots: [],
    totals: { valueEur: '200', valueUsd: '250' },
    fxRate: { eurUsd: '1.25' },
    onchain: { wallets: [], includedCount: 0, valueEur: '0', valueUsd: '0' },
  }) as unknown as AppState;

describe('category calculations', () => {
  it('sums decimal values and rejects missing prices, undefined and invalid values', () => {
    expect(calculateCategoryValue(['0.1', '0.2'])).toBe(0.3);
    expect(calculateCategoryValue([])).toBe(0);
    for (const missing of [null, undefined, NaN, ''])
      expect(calculateCategoryValue(['10', missing])).toBeNull();
  });
  it('calculates portfolio weight without dividing by zero or unknown totals', () => {
    expect(calculateCategoryWeight(50, 200)).toBe(25);
    expect(calculateCategoryWeight(0, 200)).toBe(0);
    expect(calculateCategoryWeight(0, 0)).toBeNull();
    expect(calculateCategoryWeight(50, null)).toBeNull();
  });
  it('selects the nearest usable snapshot on either side of day 30, not the first or latest', () => {
    const history = [
      { date: '2026-08-20T12:00:00Z', value: 100 },
      { date: '2026-08-25T12:00:00Z', value: 120 },
      { date: '2026-08-24T12:00:00Z', value: null },
      { date: '2026-09-22T12:00:00Z', value: 140 },
    ];
    expect(performance30d(150, history, now)).toEqual({
      absolute: 30,
      percent: 25,
      baselineDate: history[1].date,
    });
    expect(
      performance30d(150, [...history, { date: '2026-08-24T12:00:00Z', value: 100 }], now).percent,
    ).toBe(50);
  });
  it('returns null for missing historical data, and no percentage for zero baseline', () => {
    expect(performance30d(10, [], now)).toEqual({
      absolute: null,
      percent: null,
      baselineDate: null,
    });
    expect(
      performance30d(
        10,
        [
          { date: now, value: 10 },
          { date: '2099-01-01', value: 5 },
        ],
        now,
      ).percent,
    ).toBeNull();
    expect(calculatePerformance(10, 0)).toEqual({ absolute: 10, percent: null });
    expect(calculatePerformance(null, 10)).toEqual({ absolute: null, percent: null });
    expect(calculatePerformance(5, 10)).toEqual({ absolute: -5, percent: -50 });
  });
  it('uses only known acquisition costs and permits an explicitly known zero cost', () => {
    expect(calculateUnrealizedPnL(150, [50, 50])).toEqual({
      investedCapital: 100,
      unrealizedPnL: 50,
      unrealizedPnLPercent: 50,
    });
    expect(calculateUnrealizedPnL(150, [50, null])).toEqual({
      investedCapital: null,
      unrealizedPnL: null,
      unrealizedPnLPercent: null,
    });
    expect(calculateUnrealizedPnL(150, [undefined]).investedCapital).toBeNull();
    expect(calculateUnrealizedPnL(10, [0]).unrealizedPnL).toBe(10);
  });
  it('uses already converted values, only held positions, and preserves missing prices', () => {
    const data = state([
      asset(),
      asset({ id: 'euro', currency: 'EUR', valueEur: '20', valueUsd: '25' }),
      asset({ id: 'sold', quantity: '0' }),
      asset({ id: 'deleted', deletedAt: now }),
      asset({ id: 'other', categoryId: 'metals' }),
    ]);
    expect(buildCategoryDetails(data, category, 'EUR').category).toMatchObject({
      totalValue: 120,
      assetCount: 2,
      portfolioWeight: 60,
    });
    expect(buildCategoryDetails(data, category, 'USD').category.totalValue).toBe(150);
    expect(
      buildCategoryDetails(state([asset({ valueEur: null })]), category, 'EUR').category.totalValue,
    ).toBeNull();
    expect(
      buildCategoryDetails(state([asset({ costEur: null })]), category, 'EUR').unrealizedPnL,
    ).toBeNull();
    expect(buildCategoryDetails(state([]), category, 'EUR').category).toMatchObject({
      totalValue: 0,
      assetCount: 0,
    });
  });
  it('extracts saved category valuations including wallets, never borrowing current FX', () => {
    expect(
      snapshotCategoryValues(
        { rows: [asset()], onchain: { includedCount: 1, valueEur: '80', valueUsd: '100' } },
        [category],
      ),
    ).toEqual({ crypto: { valueEur: '180', valueUsd: '225' } });
    expect(
      snapshotCategoryValues({ rows: [asset({ valueEur: null })] }, [category]).crypto.valueEur,
    ).toBeNull();
    expect(snapshotCategoryValues({}, [category])).toEqual({});
    expect(snapshotCategoryValues({ rows: [] }, [category]).crypto.valueEur).toBe('0');
  });
  it('includes wallet net value and residual once, without inventing acquisition costs', () => {
    const data = state([]);
    data.onchain.wallets = [
      {
        id: 'wallet',
        label: 'Wallet',
        included: true,
        data: {
          totalUsd: '150',
          tokens: [
            {
              id: 'eth',
              chain: 'eth',
              symbol: 'ETH',
              amount: '1',
              priceUsd: '100',
              valueUsd: '100',
            },
          ],
          positions: [{ id: 'defi', protocol: 'Aave', kind: 'Lending', netUsd: '40' }],
        },
      },
    ] as AppState['onchain']['wallets'];
    const result = buildCategoryDetails(data, category, 'EUR');
    expect(result.category).toMatchObject({ totalValue: 120, assetCount: 2 });
    expect(result.assets.map((row) => row.value)).toEqual([80, 32, 8]);
    expect(result.investedCapital).toBeNull();
    expect(result.unrealizedPnL).toBeNull();
    data.fxRate = null;
    expect(buildCategoryDetails(data, category, 'EUR').category.totalValue).toBeNull();
    expect(buildCategoryDetails(data, category, 'USD').category.totalValue).toBe(150);
    data.onchain.wallets[0].included = false;
    expect(buildCategoryDetails(data, category, 'USD').category.assetCount).toBe(0);
  });
  it('filters history to the chosen period and excludes future points', () => {
    const history = [
      { date: '2026-01-01', value: 5 },
      { date: '2026-09-22', value: 10 },
      { date: '2099-01-01', value: 10 },
    ];
    expect(filterCategoryHistory(history, '30d', now)).toEqual([history[1]]);
    expect(filterCategoryHistory(history, 'all', now)).toEqual(history.slice(0, 2));
  });
});
