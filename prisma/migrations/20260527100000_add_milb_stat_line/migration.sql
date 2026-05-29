-- CreateTable
CREATE TABLE "MilbStatLine" (
    "id" TEXT NOT NULL,
    "mlbPlayerId" INTEGER NOT NULL,
    "season" INTEGER NOT NULL,
    "group" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "teamName" TEXT,
    "gamesPlayed" INTEGER NOT NULL,
    "age" INTEGER,
    "plateAppearances" INTEGER,
    "atBats" INTEGER,
    "hits" INTEGER,
    "homeRuns" INTEGER,
    "baseOnBalls" INTEGER,
    "strikeOuts" INTEGER,
    "avg" DOUBLE PRECISION,
    "obp" DOUBLE PRECISION,
    "slg" DOUBLE PRECISION,
    "ops" DOUBLE PRECISION,
    "inningsPitched" DOUBLE PRECISION,
    "earnedRuns" INTEGER,
    "era" DOUBLE PRECISION,
    "whip" DOUBLE PRECISION,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MilbStatLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MilbStatLine_mlbPlayerId_season_group_key" ON "MilbStatLine"("mlbPlayerId", "season", "group");

-- CreateIndex
CREATE INDEX "MilbStatLine_group_level_idx" ON "MilbStatLine"("group", "level");

-- CreateIndex
CREATE INDEX "MilbStatLine_mlbPlayerId_idx" ON "MilbStatLine"("mlbPlayerId");
