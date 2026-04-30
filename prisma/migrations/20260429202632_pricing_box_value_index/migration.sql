/*
  Warnings:

  - You are about to drop the column `retailCents` on the `TeamPrice` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Product" ADD COLUMN "boxPriceCents" INTEGER;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TeamPrice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "team" TEXT NOT NULL,
    "wholesaleCents" INTEGER,
    "valueIndexCents" INTEGER,
    "retailOverrideCents" INTEGER,
    "lastIndexedAt" DATETIME,
    "indexSampleSize" INTEGER,
    CONSTRAINT "TeamPrice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_TeamPrice" ("id", "productId", "team", "wholesaleCents") SELECT "id", "productId", "team", "wholesaleCents" FROM "TeamPrice";
DROP TABLE "TeamPrice";
ALTER TABLE "new_TeamPrice" RENAME TO "TeamPrice";
CREATE UNIQUE INDEX "TeamPrice_productId_team_key" ON "TeamPrice"("productId", "team");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
