import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { start, market, wallet } = vi.hoisted(() => ({
  start: vi.fn(),
  market: vi.fn(),
  wallet: vi.fn(),
}));
vi.mock('../../src/server/market-worker', () => ({ startMarketWorker: market }));
vi.mock('../../src/server/wallet-worker', () => ({ startWalletWorker: wallet }));
vi.mock('../../src/server/snapshot-worker', () => ({ startSnapshotWorker: start }));
import { register } from '../../src/instrumentation';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VERCEL', '');
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
  ['VERCEL', '1'],
  ['NEXT_RUNTIME', 'edge'],
  ['NEXT_PHASE', 'phase-production-build'],
  ['SNAPSHOT_WORKER_DISABLED', '1'],
])('does not start snapshots with %s=%s', async (key, value) => {
  vi.stubEnv(key, value);
  await register();
  expect(start).not.toHaveBeenCalled();
});

it('does not start any persistent workers on Vercel', async () => {
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('MARKET_WORKER_DISABLED', '');
  vi.stubEnv('WALLET_WORKER_DISABLED', '');
  await register();
  expect(start).not.toHaveBeenCalled();
  expect(market).not.toHaveBeenCalled();
  expect(wallet).not.toHaveBeenCalled();
});
