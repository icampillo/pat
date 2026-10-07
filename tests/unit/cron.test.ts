import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const jobs = vi.hoisted(() => ({ market: vi.fn(), wallets: vi.fn(), snapshot: vi.fn() }));
vi.mock('@/server/market', () => ({ syncMarketData: jobs.market }));
vi.mock('@/server/wallets', () => ({ syncDueWallets: jobs.wallets }));
vi.mock('@/server/jobs/portfolio-snapshot', () => ({ createPortfolioSnapshots: jobs.snapshot }));
import { GET as market } from '@/app/api/cron/market/route';
import { GET as wallets } from '@/app/api/cron/wallets/route';
import { GET as snapshot } from '@/app/api/cron/snapshot/route';
const routes = [
  { name: 'market', route: market },
  { name: 'wallets', route: wallets },
  { name: 'snapshot', route: snapshot },
] as const;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('CRON_SECRET', 'unit-test-secret');
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  jobs.market.mockResolvedValue({
    rates: 1,
    prices: 2,
    securities: { prices: 3 },
    failed: 0,
    hasMore: false,
  });
  for (const job of [jobs.wallets, jobs.snapshot])
    job.mockResolvedValue({ processed: 2, succeeded: 2, failed: 0, skipped: 0, hasMore: false });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
const request = (authorization?: string) =>
  new Request('https://app.test/api/cron/test', {
    headers: authorization ? { authorization } : {},
  });
it.each(routes)(
  '$name refuses missing/wrong auth and missing configuration without executing a job',
  async ({ route, name }) => {
    for (const header of [
      undefined,
      'Bearer invalid',
      'Bearer unit-test-secreu',
      'unit-test-secret',
    ])
      expect((await route(request(header))).status).toBe(401);
    vi.stubEnv('CRON_SECRET', '');
    expect((await route(request('Bearer unit-test-secret'))).status).toBe(401);
    expect(jobs[name]).not.toHaveBeenCalled();
  },
);
it.each(routes)(
  '$name runs only its job with correct auth, without caching',
  async ({ route, name }) => {
    const result = await route(request('Bearer unit-test-secret'));
    expect(result.status).toBe(200);
    expect(result.headers.get('cache-control')).toBe('private, no-store');
    expect(await result.json()).toMatchObject({ data: { ok: true, job: name } });
    expect(jobs[name]).toHaveBeenCalledOnce();
    for (const other of Object.keys(jobs).filter((key) => key !== name))
      expect(jobs[other as keyof typeof jobs]).not.toHaveBeenCalled();
  },
);
it.each(routes)(
  '$name masks DB/provider failures in responses and logs',
  async ({ route, name }) => {
    jobs[name].mockRejectedValue(new Error('private-token user@example.test'));
    const result = await route(request('Bearer unit-test-secret'));
    expect(result.status).toBe(503);
    expect(JSON.stringify(await result.json())).not.toContain('private-token');
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('user@example.test');
  },
);
it('reports partial failure and unfinished batches rather than success', async () => {
  for (const partial of [
    { failed: 1, hasMore: false },
    { failed: 0, hasMore: true },
  ]) {
    jobs.wallets.mockResolvedValue(partial);
    const result = await wallets(request('Bearer unit-test-secret'));
    expect(result.status).toBe(503);
    expect(await result.json()).toMatchObject({ data: { ok: false, event: 'partial' } });
  }
});
