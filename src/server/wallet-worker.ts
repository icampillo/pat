import { syncDueWallets } from './wallets';
const globalWorker = globalThis as unknown as {
  walletTimer?: ReturnType<typeof setInterval>;
  walletRunning?: boolean;
};
export function startWalletWorker() {
  if (globalWorker.walletTimer) return;
  const tick = async () => {
    if (globalWorker.walletRunning) return;
    globalWorker.walletRunning = true;
    try {
      await syncDueWallets();
    } catch {
      console.warn(JSON.stringify({ code: 'WALLET_WORKER_UNAVAILABLE' }));
    } finally {
      globalWorker.walletRunning = false;
    }
  };
  globalWorker.walletTimer = setInterval(() => {
    void tick();
  }, 15_000);
  globalWorker.walletTimer.unref();
  void tick();
}
