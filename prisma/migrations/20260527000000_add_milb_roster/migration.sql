-- CreateTable
CREATE TABLE "MilbRoster" (
    "id" TEXT NOT NULL,
    "mlbPlayerId" INTEGER NOT NULL,
    "playerName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "teamId" INTEGER,
    "teamName" TEXT,
    "position" TEXT,
    "age" INTEGER,
    "bats" TEXT,
    "throws" TEXT,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MilbRoster_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MilbRoster_mlbPlayerId_key" ON "MilbRoster"("mlbPlayerId");

-- CreateIndex
CREATE INDEX "MilbRoster_normalizedName_idx" ON "MilbRoster"("normalizedName");

-- CreateIndex
CREATE INDEX "MilbRoster_level_idx" ON "MilbRoster"("level");
