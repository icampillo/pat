ALTER TABLE "WalletObservation" ADD COLUMN "invalidatedAt" TIMESTAMPTZ(3);
ALTER TABLE "WalletObservation" ADD COLUMN "invalidReason" TEXT;
