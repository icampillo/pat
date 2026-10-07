import 'dotenv/config';
import { db } from '../src/server/db';
import { syncMarketData } from '../src/server/market';
import { syncDueWallets } from '../src/server/wallets';
import { createPortfolioSnapshots } from '../src/server/jobs/portfolio-snapshot';

const jobs = {
  market: syncMarketData,
  wallets: syncDueWallets,
  snapshot: createPortfolioSnapshots,
};
const name = process.argv[2] ?? 'all';
if (name !== 'all' && !(name in jobs))
  throw new Error('Usage : pnpm workers [market|wallets|snapshot|all]');
try {
  for (const [job, run] of Object.entries(jobs)) {
    if (name !== 'all' && name !== job) continue;
    const started = Date.now();
    const result = await run();
    console.log(JSON.stringify({ job, ...result, durationMs: Date.now() - started }));
    if (result.failed || result.hasMore) process.exitCode = 1;
  }
} finally {
  await db().$disconnect();
}
