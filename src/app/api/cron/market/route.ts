import { runCron } from '@/server/cron';
import { syncMarketData } from '@/server/market';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export function GET(request: Request) {
  return runCron(request, 'market', async () => {
    const result = await syncMarketData();
    return {
      rates: result.rates,
      prices: result.prices + result.securities.prices,
      failed: result.failed,
      hasMore: result.hasMore,
    };
  });
}
