import { expect, it } from 'vitest';
import { parisDateTime, suggestInventoryDate } from '@/domain/inventory-date';

it('propose la date du nom Bourso, sans dépendre du fuseau du navigateur', () => {
  const local = suggestInventoryDate('export-positions-instantanees-23-09-2026_17-50-30.csv');
  expect(local).toBe('2026-09-23T17:50:30');
  expect(parisDateTime(local!)).toBe('2026-09-23T15:50:30.000Z');
  expect(parisDateTime('2026-01-23T17:50')).toBe('2026-01-23T16:50:00.000Z');
});
it('refuse de deviner une date invalide, absente ou une heure ambiguë au changement de saison', () => {
  for (const name of [
    'positions.csv',
    'positions-31-02-2026_17-50-30.csv',
    'positions-25-10-2026_02-30-00.csv',
  ])
    expect(suggestInventoryDate(name)).toBeNull();
  expect(() => parisDateTime('2026-03-29T02:30:00')).toThrow();
  expect(() => parisDateTime('2026-10-25T02:30:00')).toThrow();
});
