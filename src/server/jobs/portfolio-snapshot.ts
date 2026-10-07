import { db } from '../db';
import { runSnapshot } from '../portfolio-query';

export async function createPortfolioSnapshots() {
  const started = Date.now();
  const result = { processed: 0, succeeded: 0, failed: 0, skipped: 0, hasMore: false };
  let cursor: string | undefined;
  // Small pages; the daily unique key makes retries cheap and preserves immutable captures.
  do {
    const portfolios = await db().portfolio.findMany({
      where: cursor ? { id: { gt: cursor } } : {},
      orderBy: { id: 'asc' },
      select: { id: true, timezone: true },
      take: 25,
    });
    if (!portfolios.length) break;
    for (const portfolio of portfolios) {
      if (Date.now() - started >= 180_000) return { ...result, hasMore: true };
      cursor = portfolio.id;
      result.processed++;
      try {
        const at = new Date();
        const dailyKey = new Intl.DateTimeFormat('sv-SE', { timeZone: portfolio.timezone }).format(
          at,
        );
        const existing = await db().portfolioSnapshot.findUnique({
          where: { portfolioId_dailyKey: { portfolioId: portfolio.id, dailyKey } },
          select: { id: true },
        });
        if (existing) result.skipped++;
        else {
          await runSnapshot(portfolio.id, true, at);
          result.succeeded++;
        }
      } catch {
        result.failed++;
        console.warn(JSON.stringify({ job: 'snapshot', code: 'SNAPSHOT_FAILED' }));
      }
    }
    if (portfolios.length < 25) break;
  } while (Date.now() - started < 180_000);
  result.hasMore = Date.now() - started >= 180_000;
  return result;
}
