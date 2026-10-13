import type { AppState } from '@/shared/types';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createWorkspaceStore } from '@/components/workspace/data-store';
import { startWalletPolling } from '@/components/workspace/wallet-polling';
import type { WalletSyncStatus, WalletView } from '@/shared/wallets';
import { workspaceFixture } from '../fixtures/workspace';

const response = (data: unknown) => Response.json({ data });
function fixture(status = 'PENDING') {
  const state = workspaceFixture();
  state.onchain.config.enabled = true;
  state.onchain.wallets = [
    {
      id: 'wallet',
      enabled: true,
      included: true,
      status,
      lastSuccessAt: null,
      nextSyncAt: new Date().toISOString(),
      errorCode: null,
      data: null,
    } as WalletView,
  ];
  return state;
}
function status(state = fixture()): WalletSyncStatus {
  return {
    enabled: state.onchain.config.enabled,
    wallets: state.onchain.wallets.map(
      ({ id, enabled, status, lastSuccessAt, nextSyncAt, errorCode }) => ({
        id,
        enabled,
        status,
        lastSuccessAt,
        nextSyncAt,
        errorCode,
      }),
    ),
  };
}
let doc: EventTarget & { visibilityState: string };
let stop: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('document', doc);
});
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('polls only lightweight status, deduplicates focus/timer, backs off long syncs and stops', async () => {
  const fetcher = vi.fn(async () => response(status()));
  vi.stubGlobal('fetch', fetcher);
  const store = createWorkspaceStore(fixture());
  stop = startWalletPolling(store);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await Promise.all([store.revalidate(), store.revalidate()]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(55_000);
  expect(fetcher).toHaveBeenCalledTimes(12);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(fetcher).toHaveBeenCalledTimes(14);
  expect(
    fetcher.mock.calls.every((args) => (args as unknown[])[0] === '/api/v1/wallets/status'),
  ).toBe(true);
  stop();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(fetcher).toHaveBeenCalledTimes(14);
});

it.each(['OK', 'PARTIAL', 'ERROR'])(
  'refreshes live data once on %s and stops polling without loading snapshots',
  async (terminal) => {
    const initial = fixture();
    const finished = fixture(terminal);
    finished.totals.valueUsd = '9999';
    finished.onchain.wallets[0].lastSuccessAt =
      terminal === 'ERROR' ? null : new Date().toISOString();
    const live: Partial<typeof finished> = { ...finished };
    delete live.snapshots;
    const fetcher = vi.fn(async (url: string) =>
      response(url.includes('status') ? status(finished) : live),
    );
    vi.stubGlobal('fetch', fetcher);
    const store = createWorkspaceStore(initial);
    stop = startWalletPolling(store);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/wallets/status',
      '/api/v1/state?scope=live',
    ]);
    expect((store.getSnapshot().data as AppState)?.totals.valueUsd).toBe('9999');
    expect((store.getSnapshot().data as AppState)?.snapshots).toBe(initial.snapshots);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  },
);

it('does not reload values on PENDING → SYNCING, and resumes after hiding the tab', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response(status(fixture('SYNCING')))),
  );
  const store = createWorkspaceStore(fixture());
  stop = startWalletPolling(store);
  doc.visibilityState = 'hidden';
  doc.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(55_000);
  expect(fetch).not.toHaveBeenCalled();
  doc.visibilityState = 'visible';
  doc.dispatchEvent(new Event('visibilitychange'));
  await Promise.all([store.revalidate(), store.revalidate()]);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(store.getSnapshot().data?.onchain.wallets[0].status).toBe('SYNCING');
});

it('retries network failures with backoff and keeps values visible', async () => {
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockImplementation(async () => response(status()));
  vi.stubGlobal('fetch', fetcher);
  const initial = fixture();
  const store = createWorkspaceStore(initial);
  stop = startWalletPolling(store);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(store.getSnapshot().data).toBe(initial);
  expect(store.getSnapshot().walletError).toContain('nouvelle tentative');
  await vi.advanceTimersByTimeAsync(5_000);
  expect(fetch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(store.getSnapshot().walletError).toBe('');
});

it('retries a failed post-sync live read before acknowledging the change', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response(status(fixture('OK'))))
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(response(status(fixture('OK'))))
    .mockResolvedValueOnce(response(fixture('OK')));
  vi.stubGlobal('fetch', fetcher);
  const store = createWorkspaceStore(fixture());
  stop = startWalletPolling(store);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(store.syncing()).toBe(true);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(store.syncing()).toBe(false);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fetcher).toHaveBeenCalledTimes(4);
});

it('clears data on status 401 and discards an older state read', async () => {
  let release!: (value: Response) => void;
  const old = new Promise<Response>((resolve) => {
    release = resolve;
  });
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      url.includes('status') ? Promise.resolve(new Response('', { status: 401 })) : old,
    ),
  );
  const store = createWorkspaceStore(fixture());
  const polling = store.pollWallets();
  const reading = store.refresh(true);
  await polling;
  release(response(fixture()));
  await reading;
  expect(store.getSnapshot()).toMatchObject({
    data: undefined,
    unauthorized: true,
    loading: false,
  });
});

it('ignores stale status after a mutation and deduplicates status requests in flight', async () => {
  let release!: (value: Response) => void;
  const old = new Promise<Response>((resolve) => {
    release = resolve;
  });
  const fetcher = vi.fn((url: string) =>
    url.includes('status') ? old : Promise.resolve(response(fixture('OK'))),
  );
  vi.stubGlobal('fetch', fetcher);
  const store = createWorkspaceStore(fixture());
  const polling = store.pollWallets();
  expect(store.pollWallets()).toBe(polling);
  await store.invalidate('live');
  release(response(status(fixture('SYNCING'))));
  await polling;
  expect(store.getSnapshot().data?.onchain.wallets[0].status).toBe('OK');
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it.each(['disabled wallet', 'disabled config', 'completed'])('does not poll %s', async (reason) => {
  vi.stubGlobal('fetch', vi.fn());
  const initial = fixture(reason === 'completed' ? 'OK' : 'PENDING');
  if (reason === 'disabled wallet') initial.onchain.wallets[0].enabled = false;
  if (reason === 'disabled config') initial.onchain.config.enabled = false;
  stop = startWalletPolling(createWorkspaceStore(initial));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fetch).not.toHaveBeenCalled();
});
