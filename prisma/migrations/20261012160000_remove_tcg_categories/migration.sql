-- Remove categories, not financial records. Keep every portfolio isolated.
-- A single statement makes the reclassification and deletion atomic.
DO $$
BEGIN
  INSERT INTO "AssetCategory" (id, "portfolioId", key, label, color)
  SELECT gen_random_uuid(), "portfolioId", 'OTHER', 'Autres actifs', '#8190a6'
  FROM "AssetCategory"
  WHERE key IN ('POKEMON', 'ONE_PIECE')
  GROUP BY "portfolioId"
  ON CONFLICT ("portfolioId", key) DO NOTHING;

  UPDATE "Portfolio" SET version = version + 1
  WHERE id IN (
    SELECT "portfolioId" FROM "AssetCategory" WHERE key IN ('POKEMON', 'ONE_PIECE')
  );

  UPDATE "Asset" AS asset
  SET "categoryId" = replacement.id, version = asset.version + 1
  FROM "AssetCategory" AS retired, "AssetCategory" AS replacement
  WHERE asset."categoryId" = retired.id
    AND asset."portfolioId" = retired."portfolioId"
    AND retired.key IN ('POKEMON', 'ONE_PIECE')
    AND replacement."portfolioId" = retired."portfolioId"
    AND replacement.key = 'OTHER';

  DELETE FROM "AssetCategory" WHERE key IN ('POKEMON', 'ONE_PIECE');
END $$;
