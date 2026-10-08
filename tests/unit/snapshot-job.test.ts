import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ findMany: vi.fn(), findUnique: vi.fn(), runSnapshot: vi.fn() }));
vi.mock('@/server/db', () => ({
  db: () => ({
    user: { findMany: mocks.findMany },
    portfolioSnapshot: { findUnique: mocks.findUnique },
  }),
}));
vi.mock('@/server/portfolio-query', () => ({ runSnapshot: mocks.runSnapshot }));
import { createPortfolioSnapshots } from '@/server/jobs/portfolio-snapshot';
import { snapshotDay, snapshotChartPoints } from '@/domain/snapshot-day';
beforeEach(() => {
  vi.resetAllMocks();
  mocks.findMany.mockResolvedValue([
    { id: 'owner-a', portfolios: [{ id: 'a' }] },
    { id: 'owner-b', portfolios: [{ id: 'b' }] },
  ]);
  mocks.findUnique.mockResolvedValue(null);
  mocks.runSnapshot.mockResolvedValue({ id: 'daily' });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it.each([
  ['2026-10-07T22:00:00Z', '2026-10-08'],
  ['2026-03-28T23:30:00Z', '2026-03-29'],
  ['2026-03-29T22:00:00Z', '2026-03-30'],
  ['2026-10-25T22:30:00Z', '2026-10-25'],
  ['2026-10-25T23:00:00Z', '2026-10-26'],
])('uses Paris accounting day, including DST: %s', (at, day) => {
  expect(snapshotDay(at)).toBe(day);
});
it('uses one fixed timezone for every owner and never backfills', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-07T22:30:00Z'));
  expect(await createPortfolioSnapshots()).toMatchObject({ processed: 2, succeeded: 2, failed: 0 });
  expect(
    mocks.findUnique.mock.calls.map(
      ([arg]) => arg.where.referenceOwnerId_referenceDay.referenceDay,
    ),
  ).toEqual(['2026-10-08', '2026-10-08']);
  expect(mocks.runSnapshot).toHaveBeenCalledWith('a', new Date());
});
it('skips immutable daily references on repeat execution', async () => {
  const saved = new Set<string>();
  mocks.findUnique.mockImplementation(async ({ where }) =>
    saved.has(where.referenceOwnerId_referenceDay.referenceOwnerId) ? { id: 'daily' } : null,
  );
  mocks.runSnapshot.mockImplementation(async (id) => {
    saved.add('owner-' + id);
    return { id };
  });
  await createPortfolioSnapshots();
  expect(await createPortfolioSnapshots()).toMatchObject({ succeeded: 0, skipped: 2 });
  expect(mocks.runSnapshot).toHaveBeenCalledTimes(2);
});
it('isolates failures, logs safe context and retries the failed owner on a later invocation', async () => {
  const saved = new Set<string>();
  mocks.findUnique.mockImplementation(async ({ where }) =>
    saved.has(where.referenceOwnerId_referenceDay.referenceOwnerId) ? { id: 'daily' } : null,
  );
  mocks.runSnapshot.mockRejectedValueOnce(new Error('database secret'));
  mocks.runSnapshot.mockImplementation(async (id) => {
    saved.add('owner-' + id);
    return { id };
  });
  expect(await createPortfolioSnapshots()).toMatchObject({ succeeded: 1, failed: 1 });
  expect(await createPortfolioSnapshots()).toMatchObject({ succeeded: 1, skipped: 1, failed: 0 });
  const logs = JSON.stringify(vi.mocked(console.warn).mock.calls);
  expect(logs).not.toContain('secret');
  expect(JSON.parse(vi.mocked(console.warn).mock.calls[0][0])).toMatchObject({
    portfolioId: 'a',
    event: 'failed',
  });
});
it('stops scheduling before the function deadline', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  mocks.runSnapshot.mockImplementationOnce(async () => {
    vi.setSystemTime(180_001);
    return { id: 'daily' };
  });
  expect(await createPortfolioSnapshots()).toMatchObject({ processed: 1, hasMore: true });
});

it('leaves missing days unknown and keeps consecutive DST dates connected', () => {
  const points = [
    { date: '2026-03-28T06:00:00Z', value: 100 },
    { date: '2026-03-30T06:00:00Z', value: 120 },
    { date: '2026-03-31T06:00:00Z', value: null },
  ];
  const chart = snapshotChartPoints(points);
  expect(chart.map((p) => p.value)).toEqual([100, null, 120, null]);
  expect(points).toHaveLength(3);
  expect(
    snapshotChartPoints([
      { date: '2026-10-24T22:30:00Z', value: 100 },
      { date: '2026-10-25T23:30:00Z', value: 120 },
    ]),
  ).toHaveLength(2);
});
