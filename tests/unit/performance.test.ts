import { afterEach, expect, it, vi } from 'vitest';
import { measureHttp, measureRead, sqlMetric } from '@/server/performance';
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
it('is opt-in and cannot log in production even when enabled', async () => {
  const log = vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.stubEnv('PATRIMOINE_PERF', '1');
  vi.stubEnv('NODE_ENV', 'production');
  await measureRead('portfolio.full', async () => 1);
  sqlMetric({ query: 'SELECT private', duration: 500 });
  expect(log).not.toHaveBeenCalled();
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('PATRIMOINE_PERF', '0');
  await measureRead('portfolio.full', async () => 1);
  expect(log).not.toHaveBeenCalled();
});
it('records counts, SQL durations and HTTP bytes without payloads, URLs or SQL', async () => {
  const log = vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.stubEnv('PATRIMOINE_PERF', '1');
  vi.stubEnv('NODE_ENV', 'development');
  await measureRead('portfolio.full', async () => 'private-value');
  await measureRead('portfolio.full', async () => 'private-value');
  sqlMetric({ query: "SELECT 'private-value'", duration: 500 });
  const response = await measureHttp(
    new Request('https://private-host/api/v1/wallets/private-wallet?token=private-token'),
    async () => Response.json({ data: 'private-value' }),
  );
  expect(await response.json()).toEqual({ data: 'private-value' });
  const logs = log.mock.calls.map(([line]) => JSON.parse(line));
  expect(logs[1]).toMatchObject({ perf: 'read', count: 2 });
  expect(logs[2]).toMatchObject({ perf: 'sql', durationMs: 500 });
  expect(logs[3]).toMatchObject({ perf: 'http', name: 'GET /api/v1/other', responseBytes: 24 });
  expect(JSON.stringify(logs)).not.toContain('private-');
  expect(logs[2].name).toMatch(/^Other\.SELECT\.[a-f0-9]{16}$/);
});
