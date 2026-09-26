import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const start = vi.hoisted(() => vi.fn());
vi.mock('../../src/server/snapshot-worker', () => ({ startSnapshotWorker: start }));
import { register } from '../../src/instrumentation';

beforeEach(() => {
  start.mockClear();
  vi.stubEnv('NEXT_RUNTIME', 'nodejs');
  vi.stubEnv('NEXT_PHASE', 'phase-production-server');
  vi.stubEnv('SNAPSHOT_WORKER_DISABLED', '');
  vi.stubEnv('WALLET_WORKER_DISABLED', '1');
  vi.stubEnv('MARKET_WORKER_DISABLED', '1');
});
afterEach(() => vi.unstubAllEnvs());

it('enables daily snapshots by default on a Node server', async () => {
  await register();
  expect(start).toHaveBeenCalledOnce();
});

it.each([
  ['NEXT_RUNTIME', 'edge'],
  ['NEXT_PHASE', 'phase-production-build'],
  ['SNAPSHOT_WORKER_DISABLED', '1'],
])('does not start snapshots with %s=%s', async (key, value) => {
  vi.stubEnv(key, value);
  await register();
  expect(start).not.toHaveBeenCalled();
});
