import 'dotenv/config';
import { db } from '../src/server/db';
import { syncMarketData } from '../src/server/market';

try {
  console.log(JSON.stringify(await syncMarketData(), null, 2));
} finally {
  await db().$disconnect();
}
