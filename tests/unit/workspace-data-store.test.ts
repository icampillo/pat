import { afterEach, expect, it, vi } from 'vitest';
import { createWorkspaceStore, type WorkspaceData } from '@/components/workspace/data-store';

const data = (version = 1) =>
  ({ asOf: new Date().toISOString(), portfolio: { version } }) as WorkspaceData;
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

it('discards a late pre-mutation read after forced revalidation', async () => {
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
  await store.refresh(true);
  old.resolve(response(data(1)));
  await initial;
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
  const second = store.refresh(true);
  older.resolve(response(data(2)));
  await new Promise((resolve) => setImmediate(resolve));
  expect(completed).toBe(false);
  latest.resolve(response(data(3)));
  await Promise.all([first, second]);
  expect(store.getSnapshot().data?.portfolio.version).toBe(3);
});
