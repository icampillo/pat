export async function register() {
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
