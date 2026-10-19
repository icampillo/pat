import { describe, expect, it } from 'vitest';
import {
  buildCategoryDetails,
  calculateCategoryValue,
  calculateCategoryWeight,
  calculatePerformance,
  calculateUnrealizedPnL,
  filterCategoryHistory,
  valueChange,
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
    expect(valueChange(150, history, now)).toEqual({
      absolute: 30,
      percent: 25,
      baselineDate: history[1].date,
      actualDays: 29,
      reason: null,
    });
    expect(
      valueChange(150, [...history, { date: '2026-08-24T12:00:00Z', value: 100 }], now).percent,
    ).toBe(50);
  });
  it('returns null for missing historical data, and no percentage for zero baseline', () => {
    expect(valueChange(10, [], now)).toMatchObject({
      absolute: null,
      percent: null,
      baselineDate: null,
    });
    expect(
      valueChange(
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

it('groups retired collection snapshots into OTHER without changing saved values', () => {
  const other = { id: 'other', key: 'OTHER', label: 'Autres actifs', color: '#8190a6' };
  const data = {
    rows: [
      {
        categoryId: 'old-pokemon',
        category: { key: 'POKEMON' },
        quantity: '1',
        valueEur: '10',
        valueUsd: '12',
      },
      {
        categoryId: 'old-one-piece',
        category: { key: 'ONE_PIECE' },
        quantity: '2',
        valueEur: '20',
        valueUsd: '24',
      },
      {
        categoryId: 'other',
        category: { key: 'OTHER' },
        quantity: '1',
        valueEur: '5',
        valueUsd: '6',
      },
      {
        categoryId: 'crypto',
        category: { key: 'CRYPTO' },
        quantity: '1',
        valueEur: '100',
        valueUsd: '120',
      },
      {
        categoryId: 'sold',
        category: { key: 'POKEMON' },
        quantity: '0',
        valueEur: '99',
        valueUsd: '99',
      },
    ],
  };
  const original = structuredClone(data);
  expect(snapshotCategoryValues(data, [other, category])).toEqual({
    other: { valueEur: '35', valueUsd: '42' },
    crypto: { valueEur: '100', valueUsd: '120' },
  });
  expect(data).toEqual(original);
  expect(snapshotCategoryValues({ rows: [{ ...data.rows[0], valueEur: null }] }, [other])).toEqual({
    other: { valueEur: null, valueUsd: '12' },
  });
});

describe.each([7, 30, 90, 365])('value reference at %i Paris days', (days) => {
  const target = Date.parse(now) - days * 86400000;
  const point = (offset: number, value: number | null = 100) => ({
    date: new Date(target + offset * 86400000).toISOString(),
    value,
  });
  const tolerance = Math.min(3, Math.ceil(days / 7));
  it('prefers the exact day, then the older equally close complete observation without mutation', () => {
    const history = [point(1, 80), point(-1), point(0, null)];
    const original = structuredClone(history);
    expect(valueChange(150, history, now, days)).toMatchObject({
      percent: 50,
      absolute: 50,
      baselineDate: history[1].date,
      actualDays: days + 1,
      reason: null,
    });
    expect(valueChange(150, [...history, point(0, 120)], now, days).percent).toBe(25);
    expect(valueChange(150, history.toReversed(), now, days).baselineDate).toBe(history[1].date);
    expect(history).toEqual(original);
  });
  it('bounds old references and gaps in longer histories', () => {
    for (const sign of [-1, 1])
      expect(valueChange(150, [point(sign * tolerance)], now, days).percent).toBe(50);
    for (const history of [[point(-tolerance - 1)], [point(-days), point(tolerance + 1)]])
      expect(valueChange(150, history, now, days)).toMatchObject({
        percent: null,
        absolute: null,
        baselineDate: null,
      });
  });
  it('uses the oldest complete observation for short histories, independent of ordering', () => {
    const oldest = point(tolerance + 1);
    const history = [point(days - 1, 120), point(0, null), oldest, { date: now, value: 150 }];
    const original = structuredClone(history);
    for (const points of [history, history.toReversed()])
      expect(valueChange(150, points, now, days)).toMatchObject({
        percent: 50,
        absolute: 50,
        baselineDate: oldest.date,
        actualDays: days - tolerance - 1,
        reason: null,
      });
    expect(history).toEqual(original);
    for (const value of [0, -100])
      expect(
        valueChange(150, [{ ...oldest, value }, point(days - 1, 120)], now, days),
      ).toMatchObject({
        percent: null,
        absolute: 150 - value,
        baselineDate: oldest.date,
      });
    expect(valueChange(null, [oldest], now, days).percent).toBeNull();
  });
  it('retains absolute changes with zero/negative references without hiding them behind another snapshot', () => {
    for (const value of [0, -100]) {
      expect(valueChange(50, [point(0, value), point(-1)], now, days)).toMatchObject({
        absolute: 50 - value,
        percent: null,
        baselineDate: point(0).date,
        reason: 'Pourcentage indéfinissable : valeur de référence nulle ou négative.',
      });
    }
    expect(valueChange(-50, [point(0)], now, days)).toMatchObject({
      percent: -150,
      absolute: -150,
    });
    expect(valueChange(0, [point(0)], now, days).percent).toBe(-100);
  });
  it('rejects incomplete current values, invalid observations, same-day and future observations', () => {
    for (const current of [null, NaN, Infinity])
      expect(valueChange(current, [point(0)], now, days)).toMatchObject({
        percent: null,
        absolute: null,
        reason: 'Valorisation actuelle incomplète.',
      });
    expect(
      valueChange(
        100,
        [
          point(0, NaN),
          { date: 'invalid', value: 1 },
          { date: now, value: 1 },
          { date: '2099-01-01', value: 1 },
        ],
        now,
        days,
      ).percent,
    ).toBeNull();
  });
});
it('does not round decimal differences before computing percentages', () => {
  const history = [{ date: '2026-08-24T12:00:00Z', value: 0.1 }];
  expect(valueChange(0.3, history, now)).toMatchObject({ absolute: 0.2, percent: 200 });
});
it('returns explicit unavailability for invalid dates and periods', () => {
  for (const days of [0, -1, 1.5, NaN])
    expect(valueChange(1, [], now, days).reason).toBe('Date de situation ou période invalide.');
  expect(valueChange(1, [], 'invalid', 7).percent).toBeNull();
});
