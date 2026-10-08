import { db } from '../db';
import { runSnapshot } from '../portfolio-query';
import { snapshotDay } from '@/domain/snapshot-day';

export async function createPortfolioSnapshots() {
  const started = Date.now();
  const result = { processed: 0, succeeded: 0, failed: 0, skipped: 0, hasMore: false };
  let cursor: string | undefined;
  // Same primary portfolio as owned(). The DB also enforces uniqueness across portfolios.
  do {
    const users = await db().user.findMany({
      where: {
        ...(cursor ? { id: { gt: cursor } } : {}),
        portfolios: {
          some: {},
          none: { snapshots: { some: { referenceDay: snapshotDay(new Date()) } } },
        },
      },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        portfolios: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: 1,
          select: { id: true },
        },
      },
      take: 25,
    });
    if (!users.length) break;
    for (const user of users) {
      if (Date.now() - started >= 180_000) return { ...result, hasMore: true };
      cursor = user.id;
      result.processed++;
      const portfolioId = user.portfolios[0].id;
      const at = new Date();
      const referenceDay = snapshotDay(at);
      try {
        const existing = await db().portfolioSnapshot.findUnique({
          where: { referenceOwnerId_referenceDay: { referenceOwnerId: user.id, referenceDay } },
          select: { id: true },
        });
        if (existing) result.skipped++;
        else {
          const snapshot = await runSnapshot(portfolioId, at);
          result.succeeded++;
          console.info(
            JSON.stringify({
              job: 'snapshot',
              event: 'captured',
              portfolioId,
              day: referenceDay,
              snapshotId: snapshot.id,
              incomplete: snapshot.totalEur === null || snapshot.totalUsd === null,
            }),
          );
        }
      } catch (error) {
        result.failed++;
        const rawCode = error && typeof error === 'object' && 'code' in error ? error.code : null;
        // Never log exception messages: providers/DB drivers may include credentials or payloads.
        const code =
          typeof rawCode === 'string' && /^P\d{4}$/.test(rawCode) ? rawCode : 'SNAPSHOT_FAILED';
        console.warn(
          JSON.stringify({
            job: 'snapshot',
            event: 'failed',
            portfolioId,
            day: referenceDay,
            code,
          }),
        );
      }
    }
    if (users.length < 25) break;
  } while (Date.now() - started < 180_000);
  result.hasMore = Date.now() - started >= 180_000;
  return result;
}
