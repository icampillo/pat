import { describe, expect, it } from 'vitest';
import {
  allocationRects,
  availableChartPeriod,
  snapshotCashValues,
} from '../../src/domain/dashboard';
import {
  buildCategoryDetails,
  filterCategoryHistory,
  valueChange,
} from '../../src/domain/categories';
import { canCalculatePortfolioPerformance } from '../../src/domain/portfolio-performance';
import { dashboardFixture, dashboardWithPropertyAndWallet } from '../fixtures/dashboard';
const asOf = '2026-10-09T12:00:00Z';
const baseline = { date: '2026-10-02T12:00:00Z', value: 100 };
describe.each([7, 30] as const)('dashboard value changes over %i days', (days) => {
  const reference = new Date(Date.parse(asOf) - days * 86400000);
  const baseline = { date: reference.toISOString(), value: 100 };
  it('measures held value including trades, not flow-adjusted return', () => {
    expect(valueChange(150, [baseline], asOf, days).percent).toBe(50);
    expect(valueChange(75, [baseline], asOf, days).percent).toBe(-25);
    expect(valueChange(100, [baseline], asOf, days).percent).toBe(0);
  });
  it('rejects missing, distant or incomplete history and nonpositive percentage baselines', () => {
    for (const points of [
      [],
      [{ ...baseline, date: new Date(reference.getTime() - 4 * 86400000).toISOString() }],
      [{ ...baseline, value: null }],
      [{ ...baseline, value: 0 }],
      [{ ...baseline, value: -100 }],
    ]) {
      const result = valueChange(150, points, asOf, days);
      expect(result.percent).toBeNull();
      expect(result.reason).toBeTruthy();
    }
    expect(valueChange(null, [baseline], asOf, days).percent).toBeNull();
  });
  it('uses the saved Paris calendar day regardless of observation time', () => {
    for (const hours of [-14, -0.001, 9.999]) {
      const date = new Date(reference.getTime() + hours * 3600000).toISOString();
      const result = valueChange(150, [{ ...baseline, date }], asOf, days);
      expect(result.percent).toBe(50);
      expect(result.baselineDate).toBe(date);
    }
    for (const hours of [-14.001, 10]) {
      const date = new Date(reference.getTime() + hours * 3600000).toISOString();
      expect(valueChange(150, [{ ...baseline, date }], asOf, days).percent).toBe(50);
    }
    expect(valueChange(0, [baseline], asOf, days).percent).toBe(-100);
    expect(valueChange(150, [], asOf, days).reason).toContain(`${days} jours`);
  });
  it('uses saved category values in the requested currency, not current positions', () => {
    const state = dashboardFixture();
    const snapshot = state.snapshots.at(-2)!;
    snapshot.capturedAt = new Date(Date.parse(state.asOf) - days * 86400000).toISOString();
    const current = buildCategoryDetails(state, state.categories[0], 'USD');
    const previous = Number(snapshot.categoryValues!.crypto.valueUsd);
    expect(
      valueChange(current.category.totalValue, current.history, state.asOf, days).percent,
    ).toBeCloseTo(((current.category.totalValue! - previous) / previous) * 100);
    state.rows[0].valueUsd = '1234';
    expect(buildCategoryDetails(state, state.categories[0], 'USD').history).toEqual(
      current.history,
    );
  });
});
it('extracts historical cash with stored FX and never invents absent history', () => {
  expect(
    snapshotCashValues({
      cash: [
        { valueEur: '0.1', valueUsd: '0.11' },
        { valueEur: '0.2', valueUsd: '0.22' },
      ],
    }),
  ).toEqual({ valueEur: '0.3', valueUsd: '0.33' });
  expect(snapshotCashValues({})).toBeUndefined();
  expect(snapshotCashValues({ cash: [] })).toEqual({ valueEur: '0', valueUsd: '0' });
  expect(snapshotCashValues({ cash: [{ valueEur: null, valueUsd: '-50' }] })).toEqual({
    valueEur: null,
    valueUsd: '-50',
  });
  expect(snapshotCashValues({ cash: [null] })).toEqual({ valueEur: null, valueUsd: null });
});
it('treemap preserves areas, bounds and non-overlap for arbitrary categories', () => {
  const items = Array.from({ length: 23 }, (_, i) => ({ id: String(i), value: i + 1 }));
  const rects = allocationRects([
    ...items,
    { id: 'negative', value: -1 },
    { id: 'zero', value: 0 },
  ]);
  const total = items.reduce((sum, item) => sum + item.value, 0);
  expect(rects).toHaveLength(items.length);
  for (const [i, rect] of rects.entries()) {
    expect((rect.width * rect.height) / 10000).toBeCloseTo(items[i].value / total, 10);
    expect(rect.x + rect.width).toBeLessThanOrEqual(100.00000001);
    expect(rect.y + rect.height).toBeLessThanOrEqual(100.00000001);
    for (const other of rects.slice(i + 1)) {
      const overlap =
        Math.max(
          0,
          Math.min(rect.x + rect.width, other.x + other.width) - Math.max(rect.x, other.x),
        ) *
        Math.max(
          0,
          Math.min(rect.y + rect.height, other.y + other.height) - Math.max(rect.y, other.y),
        );
      expect(overlap).toBeCloseTo(0, 8);
    }
  }
  expect(allocationRects([])).toEqual([]);
  expect(allocationRects([{ id: 'one', value: 1 }])).toEqual([
    { id: 'one', x: 0, y: 0, width: 100, height: 100 },
  ]);
});

describe('available chart periods', () => {
  const periods = ['7d', '30d', '90d', '1y', 'all'];
  it('keeps seven days as the initial window when recorded values exist', () => {
    expect(availableChartPeriod([[baseline, { date: asOf, value: 120 }]], asOf, periods)).toBe(
      '7d',
    );
  });
  it('exposes old seeded observations without changing their dates or the seven-day variation', () => {
    const history = [
      { date: '2026-09-20T12:00:00Z', value: 100 },
      { date: '2026-09-21T12:00:00Z', value: 120 },
    ];
    expect(availableChartPeriod([history], asOf, periods)).toBe('30d');
    expect(availableChartPeriod([history], '2026-11-09T12:00:00Z', periods)).toBe('90d');
    expect(availableChartPeriod([history], '2028-11-09T12:00:00Z', periods)).toBe('all');
    expect(valueChange(130, history, asOf, 7).percent).toBeNull();
  });
  it('ignores future or unknown valuations, and does not invent an available period', () => {
    for (const history of [
      [],
      [baseline],
      [baseline, { date: asOf, value: null }],
      [baseline, { date: '2027-01-01T12:00:00Z', value: 120 }],
    ]) {
      expect(availableChartPeriod([history], asOf, periods)).toBe('7d');
    }
  });
  it('selects a common category window from category values, not just global totals', () => {
    const history = [
      { date: '2026-09-20T12:00:00Z', value: 0 },
      { date: '2026-09-21T12:00:00Z', value: -10 },
    ];
    expect(availableChartPeriod([[], history], asOf, ['7d', '30d'])).toBe('30d');
    expect(availableChartPeriod([history], '2027-10-09T12:00:00Z', ['7d', '30d'])).toBe('7d');
  });
});

// Clock changes must not turn a Paris calendar window into elapsed 24-hour slices.
it.each([
  ['2026-03-30T00:30:00+02:00', '2026-03-23T00:00:00+01:00', 7],
  ['2026-10-26T23:30:00+01:00', '2026-10-19T00:00:00+02:00', 7],
  ['2026-03-30T00:30:00+02:00', '2026-02-28T00:00:00+01:00', 30],
  ['2026-10-26T23:30:00+01:00', '2026-09-26T00:00:00+02:00', 30],
] as const)('aligns category curves and references at %s over Paris days', (asOf, start, days) => {
  const points = [
    { date: new Date(Date.parse(start) - 1).toISOString(), value: 50 },
    { date: start, value: 100 },
    { date: new Date(Date.parse(start) + 86400000).toISOString(), value: null },
    { date: asOf, value: 150 },
    { date: new Date(Date.parse(asOf) + 1).toISOString(), value: 200 },
  ];
  expect(filterCategoryHistory(points, `${days}d`, asOf, true)).toEqual(points.slice(1, 4));
  expect(valueChange(150, points, asOf, days)).toMatchObject({
    percent: 50,
    baselineDate: start,
    reason: null,
  });
  expect(valueChange(150, [points[0], points[2]], asOf, days)).toMatchObject({
    percent: 200,
    actualDays: days + 1,
    baselineDate: points[0].date,
  });
});

it('uses the same accounting-day window for the initial category period', () => {
  const history = [
    { date: '2026-10-01T22:00:00Z', value: 100 },
    { date: asOf, value: 120 },
  ];
  expect(availableChartPeriod([history], asOf, ['7d', '30d'], true)).toBe('7d');
  // Other charts keep their existing elapsed-time filtering.
  expect(availableChartPeriod([history], asOf, ['7d', '30d'])).toBe('30d');
});

it.each(['EUR', 'USD'] as const)(
  'keeps category/dashboard changes consistent with wallets and revisions in %s',
  (currency) => {
    const state = dashboardWithPropertyAndWallet();
    state.historyRevised = true;
    const before = structuredClone(state);
    const detail = buildCategoryDetails(state, state.categories[0], currency);
    const change = valueChange(detail.category.totalValue, detail.history, state.asOf, 30);
    expect(change.percent).not.toBeNull();
    expect(detail.category).toMatchObject({
      change30dPercent: change.percent,
      change30dAbsolute: change.absolute,
      baselineDate: change.baselineDate,
      change30dReason: null,
      historyRevised: true,
    });
    const field = currency === 'EUR' ? 'totalEur' : 'totalUsd';
    const global = valueChange(
      Number(currency === 'EUR' ? state.totals.valueEur : state.totals.valueUsd),
      state.snapshots.map((s) => ({ date: s.capturedAt, value: Number(s[field]) })),
      state.asOf,
      7,
    );
    expect(global.percent).not.toBeNull();
    expect(canCalculatePortfolioPerformance(state, currency)).toBe(false);
    expect(state).toEqual(before);
  },
);

it('does not borrow one category’s history to fill another category', () => {
  const state = dashboardFixture();
  for (const snapshot of state.snapshots)
    snapshot.categoryValues!.stocks = { valueEur: null, valueUsd: null };
  const crypto = buildCategoryDetails(state, state.categories[0], 'EUR');
  const stocks = buildCategoryDetails(state, state.categories[1], 'EUR');
  expect(
    valueChange(crypto.category.totalValue, crypto.history, state.asOf, 7).percent,
  ).not.toBeNull();
  expect(valueChange(stocks.category.totalValue, stocks.history, state.asOf, 7).percent).toBeNull();
});
