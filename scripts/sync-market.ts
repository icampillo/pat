import 'dotenv/config';
import { db } from '../src/server/db';
import { syncMarketData } from '../src/server/market';

try {
  const result = await syncMarketData();
  console.log(JSON.stringify(result, null, 2));
  if (result.failed || result.hasMore) process.exitCode = 1;
} finally {
  await db().$disconnect();
}
