-- Read-only audit BEFORE migration; works with the old and new schema.
BEGIN READ ONLY;
-- Multiple observed captures on the same Paris day, including legacy manual/event captures.
SELECT p."ownerId", (s."capturedAt" AT TIME ZONE 'Europe/Paris')::date AS day,
       count(*) AS captures, count(*) FILTER (WHERE s.kind = 'DAILY') AS automatic,
       count(*) FILTER (WHERE s."totalEur" IS NULL AND s."totalUsd" IS NULL) AS unknown,
       array_agg(s.id ORDER BY s."capturedAt", s.id) AS ids
FROM "PortfolioSnapshot" s JOIN "Portfolio" p ON p.id = s."portfolioId"
GROUP BY p."ownerId", (s."capturedAt" AT TIME ZONE 'Europe/Paris')::date
HAVING count(*) > 1 ORDER BY day;
-- Accounting timezone changes versus historical keys: metadata is preserved, not overwritten.
SELECT s.id, s."dailyKey", (s."capturedAt" AT TIME ZONE 'Europe/Paris')::date AS paris_day
FROM "PortfolioSnapshot" s
WHERE s."dailyKey" IS NOT NULL AND s."dailyKey" <>
  to_char(s."capturedAt" AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD');
COMMIT;
