/**
 * Per-product trending data — Hot This Week + per-player activity.
 *
 * Reads from PlayerTrendingSnapshot (populated by the daily
 * refresh-trending cron). No external API calls in the request
 * path; this route resolves in tens of ms.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  remapInternationalAnime,
} from "@/lib/international-anime";
import { isRookieVariation, isProspectCard } from "@/lib/scoring";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const product = await prisma.product.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      sport: true,
      cards: {
        select: {
          team: true,
          playerName: true,
          variation: true,
          cardNumber: true,
        },
      },
    },
  });
  if (!product) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Mirror the page's anime remap so player names + teams line up.
  const remapped = remapInternationalAnime(
    product.cards.map((c) => ({
      team: c.team,
      playerName: c.playerName,
      variation: c.variation,
      cardNumber: c.cardNumber,
    })),
  );
  const players = [...new Set(remapped.map((c) => c.playerName))];

  // Read pre-computed trending snapshots for this player set + sport.
  const snapshots = await prisma.playerTrendingSnapshot.findMany({
    where: {
      sport: product.sport,
      playerName: { in: players },
    },
  });
  const map: Record<
    string,
    {
      isTrending: boolean;
      currentWeekSales: number;
      spikeMultiple: number;
      currentWeekCents: number;
      last30dCents: number;
      last30dSales: number;
    }
  > = {};
  for (const s of snapshots) {
    map[s.playerName] = {
      isTrending: s.isTrending,
      currentWeekSales: s.currentWeekSales,
      currentWeekCents: s.currentWeekCents,
      spikeMultiple: s.spikeMultiple ?? Infinity,
      last30dCents: s.last30dCents,
      last30dSales: s.last30dSales,
    };
  }
  const diagnostics = {
    apiKeyMissing: false,
    playersRequested: players.length,
    batchesAttempted: 1,
    batchesSucceeded: 1,
    playersWithData: snapshots.length,
    lastError: null,
  };

  // Derive Hot This Week list (top 8 by current-week dollar volume).
  // Mirrors the build in page.tsx so the UI stays consistent.
  const teamCountByPlayer = new Map<string, Map<string, number>>();
  for (const c of remapped) {
    if (!c.team || c.team === "—") continue;
    let inner = teamCountByPlayer.get(c.playerName);
    if (!inner) {
      inner = new Map();
      teamCountByPlayer.set(c.playerName, inner);
    }
    inner.set(c.team, (inner.get(c.team) ?? 0) + 1);
  }
  const primaryTeamFor = (name: string): string | null => {
    const inner = teamCountByPlayer.get(name);
    if (!inner) return null;
    return [...inner.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };

  const playerRookieMap: Record<string, boolean> = {};
  for (const c of remapped) {
    if (isRookieVariation(c.variation)) playerRookieMap[c.playerName] = true;
  }
  const isBowman = /bowman/i.test(product.name);
  const playerProspectMap: Record<string, boolean> = {};
  if (isBowman) {
    const totalsByPlayer = new Map<
      string,
      { total: number; prospect: number }
    >();
    for (const c of remapped) {
      const t = totalsByPlayer.get(c.playerName) ?? {
        total: 0,
        prospect: 0,
      };
      t.total++;
      if (isProspectCard(c.cardNumber, c.variation)) t.prospect++;
      totalsByPlayer.set(c.playerName, t);
    }
    for (const [name, { total, prospect }] of totalsByPlayer) {
      if (total > 0 && prospect === total) playerProspectMap[name] = true;
    }
  }

  const hotThisWeek = Object.entries(map)
    .filter(([, t]) => t.isTrending)
    .map(([name, t]) => ({
      playerName: name,
      team: primaryTeamFor(name),
      currentWeekSales: t.currentWeekSales,
      currentWeekCents: t.currentWeekCents,
      spikeMultiple: t.spikeMultiple,
      isRookie: playerRookieMap[name] ?? false,
      isProspect: playerProspectMap[name] ?? false,
    }))
    .sort((a, b) => b.currentWeekCents - a.currentWeekCents)
    .slice(0, 8);

  // Pre-compute the activity score map (0-100, log-normalized against
  // the top mover in this product) so the client can blend without
  // re-running the math.
  const playerActivityScores: Record<string, number> = {};
  let maxActivityLog = 0;
  for (const t of Object.values(map)) {
    if (t.last30dCents > 0) {
      const v = Math.log(t.last30dCents + 1);
      if (v > maxActivityLog) maxActivityLog = v;
    }
  }
  if (maxActivityLog > 0) {
    for (const [name, t] of Object.entries(map)) {
      if (t.last30dCents <= 0) continue;
      const v = Math.log(t.last30dCents + 1);
      playerActivityScores[name] = Math.max(
        1,
        Math.round((v / maxActivityLog) * 100),
      );
    }
  }

  return NextResponse.json(
    {
      hotThisWeek,
      playerTrendingMap: map,
      playerActivityScores,
      diagnostics,
    },
    {
      headers: {
        // Page-level cache: 60s edge cache so a refreshed view + a
        // direct API hit don't double-fetch CH within a minute. CH
        // sales-stats granularity is week-buckets, so 60s of staleness
        // is fine.
        "Cache-Control":
          "public, s-maxage=60, stale-while-revalidate=300",
      },
    },
  );
}
