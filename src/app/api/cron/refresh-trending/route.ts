/**
 * Daily cron: refresh PlayerTrendingSnapshot for every priced
 * player in every sport.
 *
 * Replaces the per-request fetch that used to back /hot/[sport] and
 * /api/products/[id]/trending. Both routes now read this table for
 * instant responses; the external sales tracker is only hit once a
 * day from this job.
 *
 * Auth: same `Authorization: Bearer <CRON_SECRET>` envelope as the
 * other crons. Vercel sets the header automatically when invoking
 * the cron URL on its schedule.
 *
 * Tuning: per-sport sweeps run sequentially so we don't blow the
 * upstream rate limit. Inside a sport, the trending helper batches
 * 25 players at a time at concurrency 3 with a generous deadline
 * (no SSR pressure here). MLB ~540 priced players → ~22 batches →
 * ~5-15s per sport. Total job: well under a minute.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeTrendingMap } from "@/lib/cardhedger-trending";

export const dynamic = "force-dynamic";
// Vercel function timeout — give the sweep room.
export const maxDuration = 300;

function authorized(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return true; // unset → no auth (dev / preview)
  const got = req.headers.get("authorization");
  return got === `Bearer ${expected}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!process.env.CARD_HEDGER_API) {
    return NextResponse.json(
      { error: "CARD_HEDGER_API not set; aborting" },
      { status: 500 },
    );
  }

  const t0 = Date.now();

  // Find every (playerName, sport) where the player has at least one
  // priced card anywhere in our DB. Unpriced players don't have
  // meaningful sales activity to refresh.
  const rows = await prisma.card.findMany({
    where: {
      OR: [
        { psa10Cents: { gt: 0 } },
        { ungradedCents: { gt: 0 } },
      ],
    },
    select: {
      playerName: true,
      product: { select: { sport: true } },
    },
  });
  const sportPlayers = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.playerName || !r.product?.sport) continue;
    let set = sportPlayers.get(r.product.sport);
    if (!set) {
      set = new Set();
      sportPlayers.set(r.product.sport, set);
    }
    set.add(r.playerName);
  }

  const summary: Array<{
    sport: string;
    sweptPlayers: number;
    upserted: number;
    trending: number;
    elapsedMs: number;
    error: string | null;
  }> = [];

  for (const [sport, playerSet] of sportPlayers) {
    const sportT0 = Date.now();
    const players = [...playerSet];
    let upserted = 0;
    let trending = 0;
    let lastError: string | null = null;
    try {
      const { map } = await computeTrendingMap(players, {
        deadlineMs: 60_000,
        perBatchMs: 5000,
      });
      // Upsert each player. Sequential is fine — Postgres handles
      // ~1k upserts in a few seconds, and parallel would just bash
      // the connection pool.
      for (const [playerName, t] of Object.entries(map)) {
        // Persist Infinity as null per the schema comment.
        const spike = Number.isFinite(t.spikeMultiple)
          ? t.spikeMultiple
          : null;
        await prisma.playerTrendingSnapshot.upsert({
          where: {
            playerName_sport: { playerName, sport },
          },
          create: {
            playerName,
            sport,
            isTrending: t.isTrending,
            currentWeekSales: t.currentWeekSales,
            currentWeekCents: t.currentWeekCents,
            last30dSales: t.last30dSales,
            last30dCents: t.last30dCents,
            spikeMultiple: spike,
          },
          update: {
            isTrending: t.isTrending,
            currentWeekSales: t.currentWeekSales,
            currentWeekCents: t.currentWeekCents,
            last30dSales: t.last30dSales,
            last30dCents: t.last30dCents,
            spikeMultiple: spike,
            capturedAt: new Date(),
          },
        });
        upserted++;
        if (t.isTrending) trending++;
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    summary.push({
      sport,
      sweptPlayers: players.length,
      upserted,
      trending,
      elapsedMs: Date.now() - sportT0,
      error: lastError,
    });
  }

  return NextResponse.json({
    ok: true,
    totalElapsedMs: Date.now() - t0,
    summary,
  });
}
