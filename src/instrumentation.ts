export async function register() {
  // Serverless instances cannot host persistent timers. Run scripts/workers.ts separately.
  if (process.env.VERCEL === '1') return;
  if (
    process.env.NEXT_RUNTIME === 'nodejs' &&
    process.env.NEXT_PHASE !== 'phase-production-build' &&
    process.env.SNAPSHOT_WORKER_DISABLED !== '1'
  ) {
    const { startSnapshotWorker } = await import('./server/snapshot-worker');
    startSnapshotWorker();
  }
  if (
    process.env.NEXT_RUNTIME === 'nodejs' &&
    process.env.NEXT_PHASE !== 'phase-production-build' &&
    process.env.MARKET_WORKER_DISABLED !== '1'
  ) {
    const { startMarketWorker } = await import('./server/market-worker');
    startMarketWorker();
  }
  if (
    process.env.NEXT_RUNTIME === 'nodejs' &&
    process.env.NEXT_PHASE !== 'phase-production-build' &&
    process.env.WALLET_WORKER_DISABLED !== '1'
  ) {
    const { startWalletWorker } = await import('./server/wallet-worker');
    startWalletWorker();
  }
}
