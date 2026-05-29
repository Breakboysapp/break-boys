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

  // Best-effort cache-bust. Throws when called from inside a render —
  // the immediate-next cache miss picks up fresh data anyway.
  try {
    revalidateTag("milb-stats");
  } catch {
    // ignored
  }

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

// ───────────────────────────────────────────────────────────────
// Production Index — v2 weights
// ───────────────────────────────────────────────────────────────
//
// v1 was OPS-only, which blew out guys with empty plate discipline
// (Blake Mitchell in A+ at age 21 with a 30%+ K rate landed at 100
// because the OPS came from his slug component alone). v2 layers in:
//
//   - K% penalty       (strikeouts / PA — the headline plate discipline tell)
//   - BB% bonus        (walks / PA — the other side of the same coin)
//   - Stricter age math (older-than-expected hits harder than younger-than helps)
//   - Lower OPS slope  (was each .100 OPS = +30; now +20)
//
// Each weight below is a knob you can tune in isolation — change one
// number, restart, see the table re-rank. Tune toward the rows that
// look obviously right/wrong by eye.

const EXPECTED_AGE: Record<string, number> = {
  AAA: 24,
  AA: 23,
  "A+": 22,
  A: 21,
  ROK: 19,
};

const HITTING_WEIGHTS = {
  // Minimum sample size before we trust the line at all
  minPA: 75,
  // OPS — keep as the dominant contributor. Each .100 OPS above
  // baseline = +30. Typical range ±60.
  opsBaseline: { AAA: 0.74, AA: 0.71, "A+": 0.7, A: 0.7, ROK: 0.72 },
  opsPerPointOps: 300,
  // K% (strikeout rate). 23% is roughly league-average for MiLB; a
  // 33% K guy maxes the -25 penalty. Mitchell-type lands ~63 — OPS
  // still leads contribution but K% drags him back honestly.
  kRateBaseline: 0.23,
  kRatePenaltyPerPct: 2.5,
  kRatePenaltyCap: 25,
  // BB% (walk rate). 8% floor; 15% BB rate maxes the +10 bonus.
  bbRateFloor: 0.08,
  bbRateBonusPerPct: 1.5,
  bbRateBonusCap: 10,
  // Age vs level expectation. Each year younger = +5, each year
  // older = -5 (symmetric, was -3 in v1).
  agePerYearYounger: 5,
  agePerYearOlder: -5,
  // Stagnation: flat -12 when the player is "too old at low level"
  // — triggers below at 23+ A+, 22+ A, 21+ ROK.
  stagnationPenalty: -12,
};

const PITCHING_WEIGHTS = {
  minIP: 15,
  // ERA — headline metric. Each 1.00 ERA below baseline = +25.
  eraBaseline: { AAA: 4.5, AA: 4.2, "A+": 4.0, A: 4.0, ROK: 4.5 },
  eraPerRun: 25,
  // K/BB — asymmetric: +15 max on the good side, -25 on the bad
  // side. Reflects scouting reality where control is a floor; a
  // pitcher who walks the world doesn't profile no matter the K rate.
  kbbExpected: 2.5,
  kbbBonusPerUnit: 5,
  kbbBonusCap: 15,
  kbbPenaltyCap: 25,
  // BB/9 wildness penalty (4.0+ is a major red flag). Caps at -18
  // when BB/9 hits 7.0.
  bb9Threshold: 4.0,
  bb9PenaltyPerUnit: 6,
  bb9PenaltyCap: 18,
  // Age — same as hitters
  agePerYearYounger: 5,
  agePerYearOlder: -5,
};

export type ProductionBreakdown = {
  score: number;
  parts: Array<{ label: string; value: number }>;
};

function pct(num: number | null | undefined, denom: number | null | undefined) {
  if (num == null || denom == null || denom <= 0) return null;
  return num / denom;
}

/**
 * Returns the score AND the per-component breakdown so the UI can
 * render a tooltip explaining "why is this 62? OPS +30 · K% -18 ..."
 *
 * Returns null when the sample-size gate isn't met.
 */
export function productionBreakdown(args: {
  group: "hitting" | "pitching";
  level: string;
  age: number | null;
  // Hitting
  plateAppearances?: number | null;
  ops?: number | null;
  strikeOuts?: number | null;
  baseOnBalls?: number | null;
  // Pitching
  inningsPitched?: number | null;
  era?: number | null;
}): ProductionBreakdown | null {
  if (args.group === "hitting") {
    const pa = args.plateAppearances ?? 0;
    if (pa < HITTING_WEIGHTS.minPA) return null;
    if (args.ops == null) return null;
    const w = HITTING_WEIGHTS;

    const baseline =
      w.opsBaseline[args.level as keyof typeof w.opsBaseline] ?? 0.72;
    const opsDelta = args.ops - baseline;
    const opsScore = 50 + opsDelta * w.opsPerPointOps;

    const kRate = pct(args.strikeOuts, pa) ?? 0;
    const kDelta = kRate - w.kRateBaseline; // positive = worse
    const kPenalty =
      kDelta > 0
        ? Math.min(w.kRatePenaltyCap, kDelta * 100 * w.kRatePenaltyPerPct)
        : 0;

    const bbRate = pct(args.baseOnBalls, pa) ?? 0;
    const bbDelta = bbRate - w.bbRateFloor;
    const bbBonus =
      bbDelta > 0
        ? Math.min(w.bbRateBonusCap, bbDelta * 100 * w.bbRateBonusPerPct)
        : 0;

    const expected = EXPECTED_AGE[args.level] ?? 21;
    const ageDelta = args.age != null ? expected - args.age : 0;
    const ageScore =
      ageDelta >= 0
        ? ageDelta * w.agePerYearYounger
        : ageDelta * Math.abs(w.agePerYearOlder);

    // Stagnation: 23+ at A+, 22+ at A, 21+ at ROK = systemic flag
    let stagnation = 0;
    if (args.age != null) {
      if (
        (args.level === "A+" && args.age >= 23) ||
        (args.level === "A" && args.age >= 22) ||
        (args.level === "ROK" && args.age >= 21)
      ) {
        stagnation = w.stagnationPenalty;
      }
    }

    const raw =
      opsScore - kPenalty + bbBonus + ageScore + stagnation;
    const clamped = Math.max(0, Math.min(100, Math.round(raw)));

    return {
      score: clamped,
      parts: [
        { label: "Base", value: 50 },
        {
          label: `OPS ${formatOpsTip(args.ops)}`,
          value: Math.round(opsDelta * w.opsPerPointOps),
        },
        kPenalty > 0
          ? { label: `K% ${(kRate * 100).toFixed(0)}%`, value: -Math.round(kPenalty) }
          : null,
        bbBonus > 0
          ? { label: `BB% ${(bbRate * 100).toFixed(0)}%`, value: Math.round(bbBonus) }
          : null,
        args.age != null
          ? {
              label: `Age ${args.age} (exp ${expected})`,
              value: Math.round(ageScore),
            }
          : null,
        stagnation < 0
          ? { label: `Stuck at ${args.level}`, value: stagnation }
          : null,
      ].filter(Boolean) as Array<{ label: string; value: number }>,
    };
  }

  // Pitching
  const ip = args.inningsPitched ?? 0;
  if (ip < PITCHING_WEIGHTS.minIP) return null;
  if (args.era == null) return null;
  const w = PITCHING_WEIGHTS;

  const baseline =
    w.eraBaseline[args.level as keyof typeof w.eraBaseline] ?? 4.2;
  const eraDelta = baseline - args.era; // positive = better
  const eraScore = 50 + eraDelta * w.eraPerRun;

  const k = args.strikeOuts ?? 0;
  const bb = args.baseOnBalls ?? 0;
  const kbb = bb > 0 ? k / bb : k > 0 ? 10 : 0;
  const kbbDelta = kbb - w.kbbExpected;
  // Asymmetric: +15 max on the good side, -25 max on the bad side.
  // Lopsided because wildness is a fundamental flaw — high K rate
  // doesn't save you from giving up free bases at every turn.
  const kbbBonus =
    kbbDelta > 0
      ? Math.min(w.kbbBonusCap, kbbDelta * w.kbbBonusPerUnit)
      : Math.max(-w.kbbPenaltyCap, kbbDelta * w.kbbBonusPerUnit);

  const bb9 = ip > 0 ? (bb / ip) * 9 : 0;
  const bb9Delta = bb9 - w.bb9Threshold;
  const bb9Penalty =
    bb9Delta > 0
      ? Math.min(w.bb9PenaltyCap, bb9Delta * w.bb9PenaltyPerUnit)
      : 0;

  const expected = EXPECTED_AGE[args.level] ?? 21;
  const ageDelta = args.age != null ? expected - args.age : 0;
  const ageScore =
    ageDelta >= 0
      ? ageDelta * w.agePerYearYounger
      : ageDelta * Math.abs(w.agePerYearOlder);

  const raw = eraScore + kbbBonus - bb9Penalty + ageScore;
  const clamped = Math.max(0, Math.min(100, Math.round(raw)));

  return {
    score: clamped,
    parts: [
      { label: "Base", value: 50 },
      {
        label: `ERA ${args.era.toFixed(2)}`,
        value: Math.round(eraDelta * w.eraPerRun),
      },
      kbbBonus !== 0
        ? { label: `K/BB ${kbb.toFixed(2)}`, value: Math.round(kbbBonus) }
        : null,
      bb9Penalty > 0
        ? { label: `BB/9 ${bb9.toFixed(2)}`, value: -Math.round(bb9Penalty) }
        : null,
      args.age != null
        ? {
            label: `Age ${args.age} (exp ${expected})`,
            value: Math.round(ageScore),
          }
        : null,
    ].filter(Boolean) as Array<{ label: string; value: number }>,
  };
}

/**
 * Convenience wrapper that returns just the score. The cached query
 * uses productionBreakdown() directly when it wants the breakdown
 * surfaced in the UI tooltip.
 */
export function productionIndex(args: Parameters<typeof productionBreakdown>[0]): number | null {
  return productionBreakdown(args)?.score ?? null;
}

function formatOpsTip(ops: number): string {
  const s = ops.toFixed(3);
  return s.startsWith("0") ? s.slice(1) : s;
}
