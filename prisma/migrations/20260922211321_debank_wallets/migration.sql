-- CreateTable
CREATE TABLE "DeBankConfig" (
    "portfolioId" UUID NOT NULL,
    "encryptedKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "intervalMinutes" INTEGER NOT NULL DEFAULT 60,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DeBankConfig_pkey" PRIMARY KEY ("portfolioId")
);

-- CreateTable
CREATE TABLE "WalletConnection" (
    "id" UUID NOT NULL,
    "portfolioId" UUID NOT NULL,
    "address" VARCHAR(42) NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "referenceUsd" DECIMAL(38,18),
    "referenceAt" TIMESTAMPTZ(3),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "included" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "errorCode" TEXT,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMPTZ(3),
    "lastSuccessAt" TIMESTAMPTZ(3),
    "nextSyncAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "WalletConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletObservation" (
    "id" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "fetchedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalUsd" DECIMAL(38,18) NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "WalletObservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WalletConnection_enabled_nextSyncAt_idx" ON "WalletConnection"("enabled", "nextSyncAt");

-- CreateIndex
CREATE UNIQUE INDEX "WalletConnection_portfolioId_address_key" ON "WalletConnection"("portfolioId", "address");

-- CreateIndex
CREATE INDEX "WalletObservation_walletId_fetchedAt_idx" ON "WalletObservation"("walletId", "fetchedAt" DESC);

-- AddForeignKey
ALTER TABLE "DeBankConfig" ADD CONSTRAINT "DeBankConfig_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletConnection" ADD CONSTRAINT "WalletConnection_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletObservation" ADD CONSTRAINT "WalletObservation_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "WalletConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
