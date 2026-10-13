import { expect, it } from 'vitest';
import { summarizeSnapshot, summaryCategoryValues } from '@/domain/snapshot-summary';
import { snapshotCategoryValues } from '@/domain/categories';
import { snapshotCashValues } from '@/domain/dashboard';
const categories = [
  { id: 'crypto', key: 'CRYPTO', label: 'Crypto', color: 'blue' },
  { id: 'other', key: 'OTHER', label: 'Autres', color: 'red' },
  { id: 'new', key: 'NEW', label: 'Nouvelle', color: 'green' },
];
const row = (categoryId: string, key: string, value: unknown, quantity = '1') => ({
  categoryId,
  category: { key },
  quantity,
  valueEur: value,
  valueUsd: value,
  metadata: { huge: 'x'.repeat(10000) },
});
it.each([
  {},
  { rows: [], cash: [] },
  {
    rows: [row('crypto', 'CRYPTO', '0.1'), row('crypto', 'CRYPTO', '0.2')],
    cash: [{ valueEur: null, valueUsd: '12' }],
  },
  {
    rows: [
      row('other', 'OTHER', '21'),
      row('old', 'POKEMON', '12'),
      row('older', 'ONE_PIECE', '19'),
    ],
    cash: [],
  },
  { rows: [row('other', 'POKEMON', '21'), row('other', 'OTHER', '12')], cash: [] },
  {
    rows: [row('crypto', 'CRYPTO', null)],
    onchain: { includedCount: 1, valueEur: '10', valueUsd: '20' },
  },
  {
    rows: [row('crypto', 'CRYPTO', '4', '0')],
    onchain: { includedCount: 1, valueEur: null, valueUsd: '20' },
  },
  {
    rows: [
      row('crypto', 'CRYPTO', '9007199254740991'),
      row('old', 'POKEMON', '-12.123456789012345678'),
    ],
    cash: [{ valueEur: '0', valueUsd: '0' }],
  },
])('matches the original reader, without copying financial details (%#)', (saved) => {
  const summary = summarizeSnapshot(saved);
  expect(summaryCategoryValues(summary, categories)).toEqual(
    snapshotCategoryValues(saved, categories),
  );
  expect(summary.cashValues).toEqual(snapshotCashValues(saved));
  expect(JSON.stringify(summary)).not.toContain('metadata');
});
it('uses saved category membership and FX values, including removed legacy categories', () => {
  const saved = {
    rows: [row('crypto', 'CRYPTO', '41'), row('removed', 'POKEMON', '13')],
    cash: [{ valueEur: '8', valueUsd: '10' }],
  };
  const summary = summarizeSnapshot(saved);
  saved.rows[0].categoryId = 'other';
  saved.rows[0].valueEur = '999';
  expect(summaryCategoryValues(summary, categories)).toMatchObject({
    crypto: { valueEur: '41' },
    other: { valueEur: '13' },
  });
  expect(summary.cashValues).toEqual({ valueEur: '8', valueUsd: '10' });
});
