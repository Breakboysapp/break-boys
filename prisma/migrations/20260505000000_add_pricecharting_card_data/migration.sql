-- Add PriceCharting / SportsCardsPro per-card data fields.
-- All columns are nullable so existing rows remain valid; populated by
-- scripts/import-pricecharting-set.ts when a card matches a PC listing.

ALTER TABLE "Card"
  ADD COLUMN IF NOT EXISTS "pricechartingId"  TEXT,
  ADD COLUMN IF NOT EXISTS "ungradedCents"    INTEGER,
  ADD COLUMN IF NOT EXISTS "psa10Cents"       INTEGER,
  ADD COLUMN IF NOT EXISTS "psa9Cents"        INTEGER,
  ADD COLUMN IF NOT EXISTS "printRun"         INTEGER,
  ADD COLUMN IF NOT EXISTS "imageUrl"         TEXT,
  ADD COLUMN IF NOT EXISTS "pricesUpdatedAt"  TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "popG6"            INTEGER,
  ADD COLUMN IF NOT EXISTS "popG7"            INTEGER,
  ADD COLUMN IF NOT EXISTS "popG8"            INTEGER,
  ADD COLUMN IF NOT EXISTS "popG9"            INTEGER,
  ADD COLUMN IF NOT EXISTS "popG10"           INTEGER,
  ADD COLUMN IF NOT EXISTS "popTotal"         INTEGER,
  ADD COLUMN IF NOT EXISTS "popUpdatedAt"     TIMESTAMP(3);

-- Unique index on pricechartingId so re-runs of the importer upsert
-- cleanly without duplicating rows.
CREATE UNIQUE INDEX IF NOT EXISTS "Card_pricechartingId_key"
  ON "Card"("pricechartingId");

-- Sort-by-value support for the Chase view (top N players by PSA 10).
CREATE INDEX IF NOT EXISTS "Card_productId_psa10Cents_idx"
  ON "Card"("productId", "psa10Cents");
