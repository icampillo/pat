import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ upsert: vi.fn(), read: vi.fn(), update: vi.fn() }));
vi.mock('@/server/db', () => ({
  db: () => ({
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({ zerionQuota: { upsert: mocks.upsert, update: mocks.update }, $queryRaw: mocks.read }),
  }),
}));
import { reserveZerionRequest } from '@/server/zerion-budget';
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-08T00:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});
it('reserves standard and advanced counts under a row lock, spacing instances by 400ms', async () => {
  mocks.read.mockResolvedValue([
    { day: '2026-10-08', requests: 4, advanced: 2, nextRequestAt: new Date(Date.now() + 400) },
  ]);
  const result = reserveZerionRequest(true);
  await vi.runAllTimersAsync();
  await result;
  expect(mocks.update).toHaveBeenCalledWith({
    where: { id: 'developer' },
    data: {
      day: '2026-10-08',
      requests: 5,
      advanced: 3,
      nextRequestAt: new Date('2026-10-08T00:00:00.800Z'),
    },
  });
  expect(mocks.read.mock.calls[0][0].join('')).toContain('FOR UPDATE');
});
it.each([
  [1900, 0],
  [100, 450],
])('stops before exceeding the free budget (%i / %i)', async (requests, advanced) => {
  mocks.read.mockResolvedValue([
    { day: '2026-10-08', requests, advanced, nextRequestAt: new Date() },
  ]);
  await expect(reserveZerionRequest(true)).rejects.toThrow('QUOTA');
  expect(mocks.update).not.toHaveBeenCalled();
});
it('resets counts at the UTC date boundary and refuses an excessive queue', async () => {
  mocks.read.mockResolvedValue([
    { day: '2026-10-07', requests: 1900, advanced: 450, nextRequestAt: new Date() },
  ]);
  await reserveZerionRequest(false);
  expect(mocks.update.mock.calls[0][0].data).toMatchObject({ requests: 1, advanced: 0 });
  mocks.read.mockResolvedValue([
    { day: '2026-10-08', requests: 0, advanced: 0, nextRequestAt: new Date(Date.now() + 6000) },
  ]);
  await expect(reserveZerionRequest(true)).rejects.toThrow('RATE_LIMIT');
});
