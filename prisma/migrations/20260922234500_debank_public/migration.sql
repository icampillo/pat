ALTER TABLE "DeBankConfig" ALTER COLUMN "encryptedKey" DROP NOT NULL;
ALTER TABLE "DeBankConfig" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'PUBLIC';
UPDATE "DeBankConfig" SET "mode" = 'API' WHERE "encryptedKey" IS NOT NULL;
INSERT INTO "DeBankConfig" ("portfolioId", "enabled", "mode", "updatedAt")
SELECT DISTINCT "portfolioId", true, 'PUBLIC', NOW() FROM "WalletConnection"
ON CONFLICT ("portfolioId") DO NOTHING;
ALTER TABLE "DeBankConfig" ADD CONSTRAINT "DeBankConfig_mode_check" CHECK ("mode" IN ('PUBLIC', 'API'));
ALTER TABLE "DeBankConfig" ADD CONSTRAINT "DeBankConfig_interval_check" CHECK ("intervalMinutes" IN (15, 60, 240));
