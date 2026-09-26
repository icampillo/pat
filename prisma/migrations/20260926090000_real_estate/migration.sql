-- Additive and idempotent: preserve every existing category and snapshot.
INSERT INTO "AssetCategory" ("id", "portfolioId", "key", "label", "color")
SELECT gen_random_uuid(), "id", 'REAL_ESTATE', 'Immobilier', '#b7791f'
FROM "Portfolio"
ON CONFLICT ("portfolioId", "key") DO NOTHING;
