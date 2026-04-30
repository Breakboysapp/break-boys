-- AlterTable
ALTER TABLE "Card" ADD COLUMN "marketObservedAt" DATETIME;
ALTER TABLE "Card" ADD COLUMN "marketSampleSize" INTEGER;
ALTER TABLE "Card" ADD COLUMN "marketValueCents" INTEGER;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "sport" TEXT NOT NULL,
    "manufacturer" TEXT,
    "releaseDate" DATETIME,
    "releaseStatus" TEXT NOT NULL DEFAULT 'announced',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "externalId" TEXT,
    "boxPriceCents" INTEGER,
    "pricingBlend" REAL NOT NULL DEFAULT 1.0,
    "lastMarketRefreshAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Product" ("boxPriceCents", "createdAt", "externalId", "id", "manufacturer", "name", "releaseDate", "releaseStatus", "source", "sport", "updatedAt") SELECT "boxPriceCents", "createdAt", "externalId", "id", "manufacturer", "name", "releaseDate", "releaseStatus", "source", "sport", "updatedAt" FROM "Product";
DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";
CREATE UNIQUE INDEX "Product_source_externalId_key" ON "Product"("source", "externalId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
