import { syncMarketData } from './market';

const worker = globalThis as unknown as {
  marketTimer?: ReturnType<typeof setInterval>;
  marketRunning?: boolean;
};

export function startMarketWorker() {
  if (worker.marketTimer) return;
  const tick = async () => {
    if (worker.marketRunning) return;
    worker.marketRunning = true;
    try {
      await syncMarketData();
    } catch {
      console.warn(JSON.stringify({ code: 'MARKET_WORKER_UNAVAILABLE' }));
    } finally {
      worker.marketRunning = false;
    }
  };
  worker.marketTimer = setInterval(() => { void tick(); }, 15 * 60_000);
  worker.marketTimer.unref();
  void tick();
}
