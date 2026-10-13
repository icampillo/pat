import type { createWorkspaceStore } from './data-store';

// One serial timer, paused while hidden. Slow jobs keep being checked, with a bounded backoff.
export function startWalletPolling(store: ReturnType<typeof createWorkspaceStore>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let running = false;
  let startedAt: number | undefined;
  let failures = 0;
  function schedule() {
    if (stopped || running) return;
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (!store.syncing()) {
      startedAt = undefined;
      failures = 0;
      return;
    }
    startedAt ??= Date.now();
    if (document.visibilityState !== 'visible') return;
    const elapsed = Date.now() - startedAt;
    const delay = Math.min(
      60_000,
      failures
        ? 5_000 * 2 ** Math.min(failures, 4)
        : elapsed < 60_000
          ? 5_000
          : elapsed < 300_000
            ? 15_000
            : 30_000,
    );
    timer = setTimeout(async () => {
      timer = undefined;
      if (stopped || document.visibilityState !== 'visible') return;
      running = true;
      try {
        await store.pollWallets();
        failures = store.getSnapshot().walletError || store.getSnapshot().error ? failures + 1 : 0;
      } finally {
        running = false;
        schedule();
      }
    }, delay);
  }
  const unsubscribe = store.subscribe(schedule);
  document.addEventListener('visibilitychange', schedule);
  schedule();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    unsubscribe();
    document.removeEventListener('visibilitychange', schedule);
  };
}
