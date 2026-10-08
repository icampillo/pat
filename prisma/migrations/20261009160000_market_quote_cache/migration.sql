-- Additive: existing prices, exchange rates and snapshots are untouched.
CREATE TABLE "MarketQuoteCache" (
  "key" TEXT PRIMARY KEY,
  "lastAttemptAt" TIMESTAMPTZ(3) NOT NULL,
  "leaseToken" TEXT,
  "leaseUntil" TIMESTAMPTZ(3),
  "failed" BOOLEAN NOT NULL DEFAULT false,
  "data" JSONB
);
