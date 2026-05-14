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

  // Per-sport "universe" of players to sweep. Strategy:
  //   1. Always include every player with a priced card (PC data
  //      coverage = strong market activity signal already).
  //   2. Top up with the most-prolific unpriced players per sport
  //      (by card count in our DB), up to PER_SPORT_CAP. Catches
  //      sports we haven't ingested PC pricing for yet (NBA, NFL)
  //      and surfaces meaningful trending data for them too.
  //
  // The card-count proxy is good enough: players who appear on
  // many cards across many products are by definition the names
  // collectors care about, and Card Hedger only has activity data
  // for players who are traded in volume.
  const PER_SPORT_CAP = 500;

  // Step 1: priced players.
  const priced = await prisma.card.findMany({
    where: {
      OR: [{ psa10Cents: { gt: 0 } }, { ungradedCents: { gt: 0 } }],
    },
    select: { playerName: true, product: { select: { sport: true } } },
  });
  const sportPlayers = new Map<string, Set<string>>();
  for (const r of priced) {
    if (!r.playerName || !r.product?.sport) continue;
    let set = sportPlayers.get(r.product.sport);
    if (!set) {
      set = new Set();
      sportPlayers.set(r.product.sport, set);
    }
    set.add(r.playerName);
  }

  // Step 2: top up each sport with the most-prolific players by
  // card count. groupBy on a join needs raw SQL; cheaper to just
  // fetch (playerName, productId) pairs and count in-memory.
  const distinctSports = await prisma.product.findMany({
    select: { sport: true },
    distinct: ["sport"],
  });
  for (const { sport } of distinctSports) {
    const set = sportPlayers.get(sport) ?? new Set<string>();
    if (set.size >= PER_SPORT_CAP) {
      sportPlayers.set(sport, set);
      continue;
    }
    const allCards = await prisma.card.findMany({
      where: { product: { sport } },
      select: { playerName: true },
    });
    const cardCount = new Map<string, number>();
    for (const c of allCards) {
      if (!c.playerName) continue;
      cardCount.set(c.playerName, (cardCount.get(c.playerName) ?? 0) + 1);
    }
    const ranked = [...cardCount.entries()].sort((a, b) => b[1] - a[1]);
    for (const [name] of ranked) {
      if (set.size >= PER_SPORT_CAP) break;
      set.add(name);
    }
    sportPlayers.set(sport, set);
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
