import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), runSnapshot: vi.fn() }));
vi.mock('../../src/server/db', () => ({
  db: () => ({ portfolio: { findMany: mocks.findMany } }),
}));
vi.mock('../../src/server/portfolio', () => ({ runSnapshot: mocks.runSnapshot }));
import { startSnapshotWorker } from '../../src/server/snapshot-worker';

const worker = globalThis as unknown as {
  snapshotTimer?: ReturnType<typeof setInterval>;
  snapshotRunning?: boolean;
};

beforeEach(() => {
  vi.useFakeTimers();
  mocks.findMany.mockReset().mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
  mocks.runSnapshot.mockReset().mockResolvedValue({ id: 'daily' });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  clearInterval(worker.snapshotTimer);
  delete worker.snapshotTimer;
  delete worker.snapshotRunning;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('captures all portfolios on startup and checks again each minute with daily idempotence', async () => {
  startSnapshotWorker();
  startSnapshotWorker();
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.runSnapshot.mock.calls).toEqual([
    ['a', true],
    ['b', true],
  ]);
  await vi.advanceTimersByTimeAsync(59_999);
  expect(mocks.findMany).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(mocks.findMany).toHaveBeenCalledTimes(2);
  expect(mocks.runSnapshot).toHaveBeenCalledTimes(4);
});

it('continues with other portfolios on failure and retries the failed portfolio next minute', async () => {
  mocks.runSnapshot.mockRejectedValueOnce(new Error('temporary failure'));
  startSnapshotWorker();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(mocks.runSnapshot.mock.calls).toEqual([
    ['a', true],
    ['b', true],
    ['a', true],
    ['b', true],
  ]);
  expect(console.warn).toHaveBeenCalledTimes(1);
});

it('recovers when PostgreSQL becomes available after startup', async () => {
  mocks.findMany.mockRejectedValueOnce(new Error('offline'));
  startSnapshotWorker();
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.runSnapshot).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(mocks.runSnapshot).toHaveBeenCalledTimes(2);
});

it('does not overlap a slow capture with subsequent ticks', async () => {
  let release!: () => void;
  mocks.runSnapshot.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  startSnapshotWorker();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(mocks.findMany).toHaveBeenCalledTimes(1);
  expect(mocks.runSnapshot).toHaveBeenCalledTimes(1);
  release();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(mocks.findMany).toHaveBeenCalledTimes(2);
  expect(mocks.runSnapshot).toHaveBeenCalledTimes(4);
});
