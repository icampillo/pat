import { describe, expect, it } from 'vitest';
import { allocationRects, snapshotCashValues, valueChange7d } from '../../src/domain/dashboard';
import { buildCategoryDetails } from '../../src/domain/categories';
import { dashboardFixture } from '../fixtures/dashboard';
const asOf = '2026-10-09T12:00:00Z';
const baseline = { date: '2026-10-02T12:00:00Z', value: 100 };
describe('dashboard value changes', () => {
  it('measures held value including trades, not flow-adjusted return', () => {
    expect(valueChange7d(150, [baseline], asOf).percent).toBe(50);
    expect(valueChange7d(75, [baseline], asOf).percent).toBe(-25);
    expect(valueChange7d(100, [baseline], asOf).percent).toBe(0);
  });
  it('never substitutes another interval, a partial value, zero or revised perimeter', () => {
    for (const points of [
      [],
      [{ ...baseline, date: '2026-10-02T11:59:59Z' }],
      [{ ...baseline, value: null }],
      [{ ...baseline, value: 0 }],
      [{ ...baseline, value: -100 }],
    ]) {
      const result = valueChange7d(150, points, asOf);
      expect(result.percent).toBeNull();
      expect(result.reason).toBeTruthy();
    }
    expect(valueChange7d(null, [baseline], asOf).percent).toBeNull();
    expect(valueChange7d(150, [baseline], asOf, true).percent).toBeNull();
  });
  it('uses saved category values in the requested currency, not current positions', () => {
    const state = dashboardFixture();
    const snapshot = state.snapshots.at(-2)!;
    const current = buildCategoryDetails(state, state.categories[0], 'USD');
    const previous = Number(snapshot.categoryValues!.crypto.valueUsd);
    expect(
      valueChange7d(current.category.totalValue, current.history, state.asOf).percent,
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
