-- Preserve every historical row, amount, payload, kind, timestamp and legacy dailyKey.
ALTER TABLE "PortfolioSnapshot" ADD COLUMN "referenceOwnerId" TEXT,
                                ADD COLUMN "referenceDay" TEXT;
-- Prefer usable values, then automatic captures, then latest observation with a stable tie-break.
WITH ranked AS (
  SELECT s.id, p."ownerId", to_char(s."capturedAt" AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS day,
         row_number() OVER (
           PARTITION BY p."ownerId", (s."capturedAt" AT TIME ZONE 'Europe/Paris')::date
           ORDER BY (s."totalEur" IS NOT NULL OR s."totalUsd" IS NOT NULL) DESC,
                    (s.kind = 'DAILY') DESC, s."capturedAt" DESC, s.id ASC
         ) AS position
  FROM "PortfolioSnapshot" s JOIN "Portfolio" p ON p.id = s."portfolioId"
  WHERE s.kind <> 'INVALIDATED'
)
UPDATE "PortfolioSnapshot" s SET "referenceOwnerId" = r."ownerId", "referenceDay" = r.day
FROM ranked r WHERE s.id = r.id AND r.position = 1;
CREATE UNIQUE INDEX "PortfolioSnapshot_referenceOwnerId_referenceDay_key"
  ON "PortfolioSnapshot" ("referenceOwnerId", "referenceDay");
ALTER TABLE "PortfolioSnapshot" ADD CONSTRAINT "snapshot_reference_pair"
  CHECK (("referenceOwnerId" IS NULL) = ("referenceDay" IS NULL));
-- Legacy duplicate DAILY rows remain archived; future daily inserts must carry a key.
ALTER TABLE "PortfolioSnapshot" ADD CONSTRAINT "snapshot_daily_reference_required"
  CHECK (kind <> 'DAILY' OR "referenceDay" IS NOT NULL) NOT VALID;

ALTER TABLE "PortfolioSnapshot" ADD CONSTRAINT "snapshot_reference_date"
  CHECK ("referenceDay" IS NULL OR "referenceDay" =
    to_char("capturedAt" AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD'));
