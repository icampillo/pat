import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ findMany: vi.fn(), findUnique: vi.fn(), runSnapshot: vi.fn() }));
vi.mock('@/server/db', () => ({
  db: () => ({
    portfolio: { findMany: mocks.findMany },
    portfolioSnapshot: { findUnique: mocks.findUnique },
  }),
}));
vi.mock('@/server/portfolio-query', () => ({ runSnapshot: mocks.runSnapshot }));
import { createPortfolioSnapshots } from '@/server/jobs/portfolio-snapshot';
beforeEach(() => {
  vi.resetAllMocks();
  mocks.findMany.mockResolvedValue([
    { id: 'a', timezone: 'Europe/Paris' },
    { id: 'b', timezone: 'America/New_York' },
  ]);
  mocks.findUnique.mockResolvedValue(null);
  mocks.runSnapshot.mockResolvedValue({ id: 'daily' });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it('uses each portfolio local day and does not backfill', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-07T01:00:00Z'));
  expect(await createPortfolioSnapshots()).toMatchObject({ processed: 2, succeeded: 2, failed: 0 });
  expect(
    mocks.findUnique.mock.calls.map(([arg]) => arg.where.portfolioId_dailyKey.dailyKey),
  ).toEqual(['2026-10-07', '2026-10-06']);
  expect(mocks.runSnapshot).toHaveBeenCalledWith('a', true, new Date());
});
it('skips existing immutable daily captures on repeat execution', async () => {
  const saved = new Set<string>();
  mocks.findUnique.mockImplementation(async ({ where }) =>
    saved.has(where.portfolioId_dailyKey.portfolioId) ? { id: 'daily' } : null,
  );
  mocks.runSnapshot.mockImplementation(async (id) => {
    saved.add(id);
    return { id };
  });
  await createPortfolioSnapshots();
  expect(await createPortfolioSnapshots()).toMatchObject({
    processed: 2,
    succeeded: 0,
    skipped: 2,
  });
  expect(mocks.runSnapshot).toHaveBeenCalledTimes(2);
});
it('isolates capture failures and returns an exploitable result', async () => {
  mocks.runSnapshot.mockRejectedValueOnce(new Error('database secret'));
  expect(await createPortfolioSnapshots()).toMatchObject({ processed: 2, succeeded: 1, failed: 1 });
  expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('secret');
});
it('stops scheduling before the function deadline', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  mocks.runSnapshot.mockImplementationOnce(async () => {
    vi.setSystemTime(180_001);
  });
  expect(await createPortfolioSnapshots()).toMatchObject({ processed: 1, hasMore: true });
});
