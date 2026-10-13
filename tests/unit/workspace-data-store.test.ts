import { workspaceFixture } from '../fixtures/workspace';
import { afterEach, expect, it, vi } from 'vitest';
import { createWorkspaceStore, type WorkspaceData } from '@/components/workspace/data-store';

const data = (version = 1) =>
  ({
    ...workspaceFixture(),
    asOf: new Date().toISOString(),
    portfolio: { ...workspaceFixture().portfolio, version },
  }) as WorkspaceData;
const response = (value = data()) => new Response(JSON.stringify({ data: value }));
function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('deduplicates concurrent reads, reuses fresh data, then revalidates stale data', async () => {
  vi.useFakeTimers();
  const read = deferred();
  const fetcher = vi
    .fn()
    .mockReturnValueOnce(read.promise)
    .mockResolvedValue(response(data(2)));
  vi.stubGlobal('fetch', fetcher);
  const store = createWorkspaceStore();
  const first = store.refresh();
  expect(store.refresh()).toBe(first);
  read.resolve(response());
  await first;
  await store.refresh();
  expect(fetcher).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(60_001);
  await store.refresh();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(store.getSnapshot().data?.portfolio.version).toBe(2);
});

it('discards a late pre-mutation read and serializes its post-write revalidation', async () => {
  const old = deferred();
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(response(data(2))),
  );
  const store = createWorkspaceStore();
  const initial = store.refresh();
  await new Promise((resolve) => setImmediate(resolve));
  const saved = store.invalidate();
  old.resolve(response(data(1)));
  await Promise.all([initial, saved]);
  expect(store.getSnapshot().data?.portfolio.version).toBe(2);
  expect(store.getSnapshot().loading).toBe(false);
});

it('retains displayed data on failure and allows retry', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockRejectedValueOnce(new Error('Hors ligne'))
      .mockResolvedValueOnce(response(data(2))),
  );
  const store = createWorkspaceStore(data());
  await store.refresh(true);
  expect(store.getSnapshot()).toMatchObject({
    error: 'Hors ligne',
    loading: false,
    data: { portfolio: { version: 1 } },
  });
  await store.refresh(true);
  expect(store.getSnapshot()).toMatchObject({ error: '', data: { portfolio: { version: 2 } } });
});

it('clears private data when the session expires and never shares state across providers', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })));
  const store = createWorkspaceStore(data());
  await store.refresh(true);
  expect(store.getSnapshot()).toMatchObject({
    data: undefined,
    unauthorized: true,
    loading: false,
  });
  expect(createWorkspaceStore().getSnapshot().data).toBeUndefined();
});

it('ignores results after unmount, allowing a clean mount to load again', async () => {
  const old = deferred();
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(response(data(2))),
  );
  const store = createWorkspaceStore();
  const initial = store.refresh();
  await new Promise((resolve) => setImmediate(resolve));
  store.cancel();
  await store.refresh();
  old.resolve(response(data(1)));
  await initial;
  expect(store.getSnapshot().data?.portfolio.version).toBe(2);
});

it('makes concurrent saves wait for the latest revalidation, not an aborted read', async () => {
  const older = deferred();
  const latest = deferred();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockReturnValueOnce(older.promise).mockReturnValueOnce(latest.promise),
  );
  const store = createWorkspaceStore(data());
  let completed = false;
  const first = store.refresh(true).then(() => {
    completed = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  const second = store.invalidate();
  older.resolve(response(data(2)));
  await new Promise((resolve) => setImmediate(resolve));
  expect(completed).toBe(false);
  latest.resolve(response(data(3)));
  await Promise.all([first, second]);
  expect(store.getSnapshot().data?.portfolio.version).toBe(3);
});

it('keeps saved data when revalidation receives a hosting error instead of JSON', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response('An error occurred', { status: 504 })),
  );
  const store = createWorkspaceStore(data(2));
  await store.refresh(true);
  expect(store.getSnapshot()).toMatchObject({
    data: { portfolio: { version: 2 } },
    loading: false,
    error: 'Actualisation indisponible. Réessayez. (HTTP 504)',
  });
});

it('starts market sync only once per opening without blocking the cached state or its reads', async () => {
  const market = deferred();
  const fetcher = vi.fn((url: string) =>
    url.endsWith('market/refresh') ? market.promise : Promise.resolve(response(data(2))),
  );
  vi.stubGlobal('fetch', fetcher);
  const store = createWorkspaceStore(data());
  const sync = store.syncMarketOnOpen();
  expect(store.syncMarketOnOpen()).toBe(sync);
  expect(store.getSnapshot()).toMatchObject({
    loading: false,
    data: { portfolio: { version: 1 } },
  });
  await store.refresh(true);
  expect(store.getSnapshot().data?.portfolio.version).toBe(2);
  market.resolve(Response.json({ data: { failed: 0, hasMore: false } }));
  await sync;
  expect(store.syncMarketOnOpen()).toBe(sync);
  expect(fetcher.mock.calls.filter(([url]) => url.endsWith('market/refresh'))).toHaveLength(1);
});

it('does not retry a failed opening sync on subsequent calls and preserves displayed values', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Unavailable', { status: 504 })));
  const store = createWorkspaceStore(data());
  await expect(store.syncMarketOnOpen()).rejects.toThrow('HTTP 504');
  await expect(store.syncMarketOnOpen()).rejects.toThrow('HTTP 504');
  expect(fetch).toHaveBeenCalledOnce();
  expect(store.getSnapshot().data?.portfolio.version).toBe(1);
});

it('deduplicates even forced concurrent reads and batches concurrent mutation invalidations', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async () => response(data(2))),
  );
  const store = createWorkspaceStore(data());
  const first = store.refresh(true);
  expect(store.refresh(true)).toBe(first);
  await first;
  const saved = store.invalidate('live');
  expect(store.invalidate()).toBe(saved);
  await saved;
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(vi.mocked(fetch).mock.calls[1][0]).toBe('/api/v1/state');
  await store.refresh(); // navigation immediately after save
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('does not refetch on unchanged/failed opening sync, but refreshes live data after actual writes', async () => {
  for (const prices of [0, 1]) {
    const fetcher = vi.fn((url: string) =>
      Promise.resolve(
        Response.json({
          data: url.includes('market')
            ? { rates: 0, prices, failed: 0, hasMore: false, securities: { prices: 0 } }
            : data(2),
        }),
      ),
    );
    vi.stubGlobal('fetch', fetcher);
    const store = createWorkspaceStore(data());
    await store.syncMarketOnOpen();
    expect(fetcher).toHaveBeenCalledTimes(prices ? 2 : 1);
    if (prices) expect(fetcher.mock.calls[1][0]).toBe('/api/v1/state?scope=live');
  }
});

it('can cancel before the deferred read starts without a stuck loader', async () => {
  vi.stubGlobal('fetch', vi.fn());
  const store = createWorkspaceStore();
  const reading = store.refresh();
  store.cancel();
  await reading;
  expect(fetch).not.toHaveBeenCalled();
  expect(store.getSnapshot().loading).toBe(false);
});

it('keeps ordinary stale revalidation independent from long wallet syncs', async () => {
  vi.useFakeTimers();
  const initial = {
    ...data(),
    onchain: { config: { enabled: true }, wallets: [{ enabled: true, status: 'PENDING' }] },
  } as WorkspaceData;
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async () => response(initial)),
  );
  const store = createWorkspaceStore(initial);
  vi.advanceTimersByTime(60_001);
  await store.revalidate();
  expect(fetch).toHaveBeenCalledOnce();
  expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/v1/state');
});

it('loads settings without global data, and waits for full data before financial navigation', async () => {
  const full = data();
  const settings = {
    portfolio: full.portfolio,
    asOf: full.asOf,
    fxRate: full.fxRate,
    accounts: [],
    onchain: { config: full.onchain.config, wallets: [] },
  };
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response(settings as WorkspaceData))
    .mockResolvedValueOnce(response(full));
  vi.stubGlobal('fetch', fetcher);
  const store = createWorkspaceStore();
  await store.selectScope('settings');
  expect(fetcher.mock.calls[0][0]).toBe('/api/v1/state?scope=settings');
  expect(store.getSnapshot().data).not.toHaveProperty('totals');
  await store.selectScope('full');
  expect(fetcher.mock.calls[1][0]).toBe('/api/v1/state');
  await store.selectScope('wallets');
  await store.selectScope('settings');
  await store.selectScope('full');
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('keeps invalidations scoped, then reloads a complete coherent financial state', async () => {
  const full = data();
  const partial = {
    portfolio: full.portfolio,
    asOf: full.asOf,
    fxRate: full.fxRate,
    onchain: full.onchain,
  };
  const fetcher = vi
    .fn()
    .mockImplementation(async (url: string) =>
      response((url.includes('wallets') ? partial : full) as WorkspaceData),
    );
  vi.stubGlobal('fetch', fetcher);
  const store = createWorkspaceStore(full);
  await store.selectScope('wallets');
  await store.invalidate('live');
  expect(fetcher.mock.calls[0][0]).toBe('/api/v1/state?scope=wallets');
  expect(store.getSnapshot().data).not.toHaveProperty('totals');
  await store.selectScope('full');
  expect(fetcher.mock.calls[1][0]).toBe('/api/v1/state');
});
it('serializes a scope switch during an in-flight scoped read', async () => {
  const first = deferred();
  const full = data();
  const fetcher = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce(response(full));
  vi.stubGlobal('fetch', fetcher);
  const store = createWorkspaceStore();
  const loading = store.selectScope('settings');
  await new Promise((resolve) => setImmediate(resolve));
  const navigating = store.selectScope('full');
  first.resolve(
    response({
      portfolio: full.portfolio,
      asOf: full.asOf,
      fxRate: full.fxRate,
      onchain: full.onchain,
      accounts: [],
    } as WorkspaceData),
  );
  await Promise.all([loading, navigating]);
  expect(store.getSnapshot().data).toHaveProperty('rows');
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    '/api/v1/state?scope=settings',
    '/api/v1/state',
  ]);
});

it('does not get stuck when a narrow invalidation completes after returning to cached full data', async () => {
  const full = data();
  const delayed = deferred();
  const fetcher = vi
    .fn()
    .mockReturnValueOnce(delayed.promise)
    .mockResolvedValueOnce(response(data(2)));
  vi.stubGlobal('fetch', fetcher);
  const store = createWorkspaceStore(full);
  await store.selectScope('settings');
  const saving = store.invalidate();
  await new Promise((resolve) => setImmediate(resolve));
  const navigating = store.selectScope('full');
  delayed.resolve(
    response({
      portfolio: full.portfolio,
      asOf: full.asOf,
      accounts: [],
      fxRate: full.fxRate,
      onchain: full.onchain,
    } as WorkspaceData),
  );
  await Promise.all([saving, navigating]);
  expect(store.getSnapshot().data).toHaveProperty('rows');
  expect(store.getSnapshot().data?.portfolio.version).toBe(2);
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    '/api/v1/state?scope=settings',
    '/api/v1/state',
  ]);
});
it('does not duplicate an in-flight full read during financial route navigation', async () => {
  const delayed = deferred();
  const fetcher = vi.fn().mockReturnValue(delayed.promise);
  vi.stubGlobal('fetch', fetcher);
  const store = createWorkspaceStore();
  const first = store.selectScope('full');
  await new Promise((resolve) => setImmediate(resolve));
  const second = store.selectScope('full');
  delayed.resolve(response());
  await Promise.all([first, second]);
  expect(fetcher).toHaveBeenCalledOnce();
});
