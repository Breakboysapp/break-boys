/**
 * Wipe-and-replace refresh of the MilbRoster cache from MLB Stats API.
 *
 * Called from:
 *   - the `/products/[id]/sleepers` page when the cache is stale
 *     (older than ROSTER_FRESH_MS) or empty
 *   - eventually a daily cron, but the inline self-seed path means
 *     the page just works without cron infra being set up first.
 *
 * Wipe is deliberate — players who get released or jump levels
 * shouldn't linger forever as stale rows. Roster shifts daily during
 * the MiLB season.
 */

import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import { normalizeKey } from "@/lib/player-name-normalize";
import { fetchMilbRoster } from "@/lib/sources/stats/milb-roster";

// Consider the roster fresh for 24h. Beyond that the page triggers
// a refresh inline.
export const ROSTER_FRESH_MS = 24 * 60 * 60 * 1000;

export type RosterRefreshResult = {
  fetched: number;
  inserted: number;
  syncedAt: string;
};

export async function refreshMilbRoster(): Promise<RosterRefreshResult> {
  const roster = await fetchMilbRoster();
  if (roster.length === 0) {
    throw new Error("MLB Stats API returned an empty roster");
  }

  const now = new Date();
  const rows = roster.map((r) => ({
    mlbPlayerId: r.mlbPlayerId,
    playerName: r.playerName,
    normalizedName: normalizeKey(r.playerName),
    level: r.level,
    teamId: r.teamId,
    teamName: r.teamName,
    position: r.position,
    age: r.age,
    bats: r.bats,
    throws: r.throws,
    lastSyncedAt: now,
  }));

  await prisma.$transaction([
    prisma.milbRoster.deleteMany({}),
    prisma.milbRoster.createMany({ data: rows }),
  ]);

  // Best-effort cache-bust. When this runs from inside a Server
  // Component render (the /products/[id]/sleepers self-seed path),
  // Next.js throws — that's expected. The DB writes already
  // succeeded; the page's subsequent cached-query read is a cache
  // miss anyway (first hit per productId), so it picks up fresh
  // data without needing this signal.
  try {
    revalidateTag("milb-roster");
  } catch {
    // ignored — see above
  }

  return {
    fetched: roster.length,
    inserted: rows.length,
    syncedAt: now.toISOString(),
  };
}

/**
 * Cheap "do we need to refresh?" check used by the page's self-seed
 * gate. Reads one row, compares its lastSyncedAt to ROSTER_FRESH_MS.
 */
export async function isRosterStale(): Promise<boolean> {
  const any = await prisma.milbRoster.findFirst({
    select: { lastSyncedAt: true },
    orderBy: { lastSyncedAt: "desc" },
  });
  if (!any) return true;
  return Date.now() - any.lastSyncedAt.getTime() > ROSTER_FRESH_MS;
}
