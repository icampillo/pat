-- Additive migration: no wallet, observation, snapshot or legacy setting is changed.
CREATE TABLE "WalletSyncConfig" (
  "portfolioId" UUID NOT NULL PRIMARY KEY,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "WalletSyncConfig_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "WalletSyncConfig" ("portfolioId", "enabled", "revision", "updatedAt")
SELECT "portfolioId", "enabled", 1, CURRENT_TIMESTAMP FROM "DeBankConfig";
CREATE TABLE "ZerionQuota" (
  "id" TEXT NOT NULL PRIMARY KEY, "day" TEXT NOT NULL,
  "requests" INTEGER NOT NULL DEFAULT 0, "advanced" INTEGER NOT NULL DEFAULT 0,
  "nextRequestAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE TABLE "ZerionAddressCache" (
  "address" VARCHAR(42) NOT NULL PRIMARY KEY,
  "leaseToken" TEXT, "leaseUntil" TIMESTAMPTZ(3), "fetchedAt" TIMESTAMPTZ(3), "data" JSONB
);
