import { afterEach, expect, it, vi } from 'vitest';
import { providerFetch } from '@/server/provider-fetch';
afterEach(() => {
  vi.unstubAllGlobals();
});
it.each([400, 401, 403, 404])('does not retry definitive HTTP %s', async (status) => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status }));
  vi.stubGlobal('fetch', fetch);
  expect((await providerFetch('https://provider.test')).status).toBe(status);
  expect(fetch).toHaveBeenCalledOnce();
});
it('retries a transient failure once and uses bounded abort signals', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ ok: true }));
  vi.stubGlobal('fetch', fetch);
  expect((await providerFetch('https://provider.test')).ok).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[0][1]).toMatchObject({
    cache: 'no-store',
    redirect: 'error',
    signal: expect.any(AbortSignal),
  });
});
it('honors a long Retry-After by deferring instead of retrying early', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(new Response(null, { status: 429, headers: { 'Retry-After': '60' } }));
  vi.stubGlobal('fetch', fetch);
  expect((await providerFetch('https://provider.test')).status).toBe(429);
  expect(fetch).toHaveBeenCalledOnce();
});
it('bounds network retries and never leaks the raw error', async () => {
  const fetch = vi.fn().mockRejectedValue(new Error('private-key'));
  vi.stubGlobal('fetch', fetch);
  await expect(providerFetch('https://provider.test')).rejects.toThrow('PROVIDER_NETWORK');
  expect(fetch).toHaveBeenCalledTimes(2);
});
