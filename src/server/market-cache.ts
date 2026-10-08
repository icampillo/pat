import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Prisma } from '@/generated/prisma/client';
import { db } from './db';

// Public quotes shared across users and Functions. No SQL transaction held during HTTP.
// providerFetch allows two 10s attempts; the lease leaves room for parsing/writing.
export async function marketQuote<T extends Prisma.InputJsonValue>(
  key: string,
  fetchQuote: () => Promise<T>,
): Promise<T> {
  const token = randomUUID();
  const claimed = await db().$queryRaw<{ key: string }[]>`
    INSERT INTO "MarketQuoteCache" ("key", "lastAttemptAt", "leaseToken", "leaseUntil")
    VALUES (${key}, CURRENT_TIMESTAMP, ${token}, CURRENT_TIMESTAMP + INTERVAL '60 seconds')
    ON CONFLICT ("key") DO UPDATE SET
      "lastAttemptAt" = CURRENT_TIMESTAMP,
      "leaseToken" = ${token},
      "leaseUntil" = CURRENT_TIMESTAMP + INTERVAL '60 seconds'
    WHERE "MarketQuoteCache"."lastAttemptAt" <= CURRENT_TIMESTAMP - INTERVAL '5 minutes'
      AND ("MarketQuoteCache"."leaseUntil" IS NULL
        OR "MarketQuoteCache"."leaseUntil" <= CURRENT_TIMESTAMP)
    RETURNING "key"
  `;
  if (claimed.length) {
    try {
      const data = await fetchQuote();
      // Reject late writes after an expired lease, including a reclaimed lease.
      const saved = await db().marketQuoteCache.updateMany({
        where: { key, leaseToken: token, leaseUntil: { gt: new Date() } },
        data: { data, failed: false, leaseToken: null, leaseUntil: null },
      });
      if (!saved.count) throw new Error('MARKET_LEASE_EXPIRED');
      return data;
    } catch {
      await db().marketQuoteCache.updateMany({
        where: { key, leaseToken: token },
        data: { failed: true, leaseToken: null, leaseUntil: null },
      });
      throw new Error('MARKET_QUOTE_UNAVAILABLE');
    }
  }
  // Wait for the winner so concurrent portfolios receive the same completed quote.
  // Bounded SQL polling only; a killed Function retains its five-minute cooldown.
  for (let attempt = 0; attempt < 60; attempt++) {
    const cached = await db().marketQuoteCache.findUniqueOrThrow({ where: { key } });
    if (!cached.leaseToken) {
      if (cached.failed || cached.data === null) throw new Error('MARKET_QUOTE_UNAVAILABLE');
      return cached.data as T;
    }
    if (!cached.leaseUntil || cached.leaseUntil.getTime() <= Date.now()) break;
    await delay(1_000);
  }
  throw new Error('MARKET_QUOTE_PENDING');
}
