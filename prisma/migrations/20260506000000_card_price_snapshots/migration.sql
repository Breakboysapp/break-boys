-- Daily snapshot log for card prices. Written by the PriceCharting
-- importer when prices diverge from the last snapshot. Powers the
-- player growth/decline trend (7d / 30d Δ%) shown on the Chase view
-- and used to drive market-aware team weights.

CREATE TABLE IF NOT EXISTS "CardPriceSnapshot" (
  "id" TEXT NOT NULL,
  "cardId" TEXT NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ungradedCents" INTEGER,
  "psa10Cents" INTEGER,
  "psa9Cents" INTEGER,
  CONSTRAINT "CardPriceSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CardPriceSnapshot_cardId_fkey"
    FOREIGN KEY ("cardId") REFERENCES "Card"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "CardPriceSnapshot_cardId_capturedAt_idx"
  ON "CardPriceSnapshot"("cardId", "capturedAt");
