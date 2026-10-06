import 'dotenv/config';
import { setInterval } from 'node:timers/promises';
import { startSnapshotWorker } from '../src/server/snapshot-worker';
import { startMarketWorker } from '../src/server/market-worker';
import { startWalletWorker } from '../src/server/wallet-worker';

if (process.env.VERCEL === '1')
  throw new Error('Les workers nécessitent un serveur Node permanent.');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL non configurée');

if (process.env.SNAPSHOT_WORKER_DISABLED !== '1') startSnapshotWorker();
if (process.env.MARKET_WORKER_DISABLED !== '1') startMarketWorker();
if (process.env.WALLET_WORKER_DISABLED !== '1') startWalletWorker();

// Existing worker timers are unref'ed because they normally share the Next server.
for await (const tick of setInterval(60_000)) void tick;
