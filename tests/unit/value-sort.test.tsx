import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { sortByValue, valueInEur } from '@/domain/value-sort';
import { HistoryView } from '@/components/history-view';
import { workspaceFixture } from '../fixtures/workspace';

const chart = vi.hoisted(() => vi.fn(() => null));
vi.mock('@/components/charts', () => ({ EvolutionChart: chart }));

it('sorts exact monetary values descending, keeps ties stable and unknowns last without mutation', () => {
  const rows = Object.freeze([
    { id: 'unknown', value: null },
    { id: 'low', value: '9' },
    { id: 'negative', value: '-1' },
    { id: 'high', value: '100.000000000000000002' },
    { id: 'close', value: '100.000000000000000001' },
    { id: 'tie', value: '9' },
    { id: 'zero', value: '0' },
  ]);
  expect(sortByValue(rows, (row) => row.value).map((row) => row.id)).toEqual([
    'high',
    'close',
    'low',
    'tie',
    'zero',
    'negative',
    'unknown',
  ]);
  expect(rows[0].id).toBe('unknown');
});

it('compares currencies in EUR and leaves unavailable conversions unknown', () => {
  const rows = [
    { amount: '110', currency: 'USD' },
    { amount: '100', currency: 'EUR' },
  ];
  expect(sortByValue(rows, (row) => valueInEur(row.amount, row.currency, '1.2'))[0].currency).toBe(
    'EUR',
  );
  expect(valueInEur('110', 'USD', null)).toBeNull();
  expect(valueInEur(null, 'EUR', '1.2')).toBeNull();
  expect(valueInEur('110', 'USD', '0')).toBeNull();
  expect(valueInEur('0', 'USD', null)).toBe('0');
});

it('sorts history by value while preserving chronological deltas and chart points', () => {
  const state = workspaceFixture();
  state.snapshots = ['100', '300', '200'].map((totalEur, i) => ({
    id: String(i),
    capturedAt: `2026-10-0${i + 1}T12:00:00Z`,
    kind: 'MANUAL',
    totalEur,
    totalUsd: totalEur,
    investedEur: '0',
    ledgerVersion: 1,
  }));
  const html = renderToStaticMarkup(<HistoryView state={state} currency="EUR" />);
  const rows = html.match(/<tbody>(.*?)<\/tbody>/s)![1].match(/<tr>.*?<\/tr>/gs)!;
  expect(rows[0]).toContain('300,00');
  expect(rows[0]).toContain('+200,00');
  expect(rows[1]).toContain('200,00');
  expect(rows[1]).toContain('-100,00');
  expect(rows[2]).toContain('100,00');
  expect(chart.mock.calls[0]).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        points: state.snapshots.map((s) => ({ date: s.capturedAt, value: Number(s.totalEur) })),
      }),
    ]),
  );
  expect(state.snapshots.map((s) => s.totalEur)).toEqual(['100', '300', '200']);
});
