/**
 * Wipe-and-replace refresh of the MilbStatLine cache.
 *
 * Two parallel fetches (hitting + pitching) against the MLB Stats
 * API batch endpoint, then upserted into Postgres. Wipe is scoped to
 * (season, group) so an in-flight prior-season backfill wouldn't
 * collide — though in practice we always refresh the current season.
 *
 * Same self-seed pattern as the roster refresh: the page checks
 * staleness via areStatsStale() and refreshes inline if needed.
 */

import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import {
  fetchMilbStatLines,
  type MilbStatLineRecord,
  type StatGroup,
} from "@/lib/sources/stats/milb-stats";

export const STATS_FRESH_MS = 24 * 60 * 60 * 1000;

export type StatsRefreshResult = {
  hittingRows: number;
  pitchingRows: number;
  season: number;
  syncedAt: string;
};

export async function refreshMilbStats(
  season: number = new Date().getUTCFullYear(),
): Promise<StatsRefreshResult> {
  const [hitting, pitching] = await Promise.all([
    fetchMilbStatLines("hitting", season),
    fetchMilbStatLines("pitching", season),
  ]);

  const now = new Date();
  const toRow = (r: MilbStatLineRecord) => ({ ...r, lastSyncedAt: now });

  await prisma.$transaction([
    prisma.milbStatLine.deleteMany({ where: { season } }),
    prisma.milbStatLine.createMany({
      data: [...hitting, ...pitching].map(toRow),
    }),
  ]);

  revalidateTag("milb-stats");

  return {
    hittingRows: hitting.length,
    pitchingRows: pitching.length,
    season,
    syncedAt: now.toISOString(),
  };
}

export async function areStatsStale(
  season: number = new Date().getUTCFullYear(),
): Promise<boolean> {
  const any = await prisma.milbStatLine.findFirst({
    where: { season },
    select: { lastSyncedAt: true },
    orderBy: { lastSyncedAt: "desc" },
  });
  if (!any) return true;
  return Date.now() - any.lastSyncedAt.getTime() > STATS_FRESH_MS;
}

/**
 * Age + level-normalized Production Index, 0-100. Higher = the
 * player is producing above what's expected for someone their age
 * at that level.
 *
 * This is a deliberately simple v1 — OPS for hitters, a blend of
 * ERA + K/BB for pitchers. Both with minimum-sample gates so a
 * 4-AB hot start doesn't dominate the board. We can tune the math
 * once we see what feels right on staging.
 *
 * Returns null when:
 *   - No stat line at all (player hasn't played, or isn't on a
 *     queried level)
 *   - Sample size below the minimum threshold (50 PA hitters,
 *     15 IP pitchers)
 */
export function productionIndex(args: {
  group: "hitting" | "pitching";
  level: string;
  age: number | null;
  // Hitting
  plateAppearances?: number | null;
  ops?: number | null;
  // Pitching
  inningsPitched?: number | null;
  era?: number | null;
  strikeOuts?: number | null;
  baseOnBalls?: number | null;
}): number | null {
  if (args.group === "hitting") {
    const pa = args.plateAppearances ?? 0;
    if (pa < 50) return null;
    if (args.ops == null) return null;

    // OPS expectations by level — these are rough league averages
    // for a typical hitter. Above-average production is anything
    // meaningfully over the level baseline.
    const opsBaseline: Record<string, number> = {
      AAA: 0.74,
      AA: 0.71,
      "A+": 0.7,
      A: 0.7,
      ROK: 0.72,
    };
    const baseline = opsBaseline[args.level] ?? 0.72;
    // Each 0.100 OPS above baseline = ~30 production points. Clamp 0-100.
    const opsScore = 50 + (args.ops - baseline) * 300;
    // Age adjustment: younger-than-expected for a level is a
    // meaningful prospect signal. Expected age by level (rough):
    const expectedAge: Record<string, number> = {
      AAA: 24,
      AA: 23,
      "A+": 22,
      A: 21,
      ROK: 19,
    };
    const ageDelta =
      args.age != null ? expectedAge[args.level] - args.age : 0;
    // Each year younger = +5 points; each year older = -3.
    const ageScore = ageDelta > 0 ? ageDelta * 5 : ageDelta * 3;
    return Math.max(0, Math.min(100, Math.round(opsScore + ageScore)));
  }

  // Pitching
  const ip = args.inningsPitched ?? 0;
  if (ip < 15) return null;
  if (args.era == null) return null;
  const eraBaseline: Record<string, number> = {
    AAA: 4.5,
    AA: 4.2,
    "A+": 4.0,
    A: 4.0,
    ROK: 4.5,
  };
  const baseline = eraBaseline[args.level] ?? 4.2;
  // Each run of ERA below baseline = ~25 points; lower ERA = better
  const eraScore = 50 + (baseline - args.era) * 25;
  // K/BB ratio bonus — a 4+ K/BB is elite for any level
  const k = args.strikeOuts ?? 0;
  const bb = args.baseOnBalls ?? 0;
  const kbb = bb > 0 ? k / bb : k > 0 ? 10 : 0;
  const kbbScore = Math.min(15, (kbb - 2.5) * 5); // +15 max
  // Age — younger at level is good
  const expectedAge: Record<string, number> = {
    AAA: 24,
    AA: 23,
    "A+": 22,
    A: 21,
    ROK: 19,
  };
  const ageDelta = args.age != null ? expectedAge[args.level] - args.age : 0;
  const ageScore = ageDelta > 0 ? ageDelta * 5 : ageDelta * 3;
  return Math.max(0, Math.min(100, Math.round(eraScore + kbbScore + ageScore)));
}
