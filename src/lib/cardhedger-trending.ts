/**
 * Per-player "trending hot this week" classifier sourced from Card
 * Hedger's sales-stats-by-player. Drives the 🔥 badge in the chase
 * view + scoreboard.
 *
 * Definition of trending — current week count must beat ALL of:
 *   1. ≥ 5× the prior 3-week average count (the spike test)
 *   2. ≥ 5 absolute sales (filters 0→2 jumps from looking like ×∞)
 *   3. ≥ 5 sales total over the 4-week window (ditto, total-volume floor)
 *
 * Failure mode: CH outage / bad response → empty map. Never throws,
 * never blocks the page render. The chase view degrades cleanly to
 * "no trending badges this load" rather than failing.
 */

import { getPlayerSalesStats } from "@/lib/sources/pricing/cardhedger";

export type TrendingInfo = {
  /** True when this player matches all three trending conditions. */
  isTrending: boolean;
  /** Current week's sales count from CH (for tooltip). 0 when CH had
   *  no data for the player. */
  currentWeekSales: number;
  /** Multiple over prior 3-week avg. Surfaced in the tooltip so users
   *  can see how big the spike is. Infinity when prior was 0. */
  spikeMultiple: number;
  /** Current week's dollar volume in cents — for ranking the Hot
   *  This Week section by money flow, not just sales count. */
  currentWeekCents: number;
};

// Card Hedger's sales-stats-by-player caps the players[] array at 25.
// Sending 50 returns a 422 with "List should have at most 25 items".
const BATCH_SIZE = 25;
const SPIKE_THRESHOLD = 5;
const MIN_CURRENT_SALES = 5;
const MIN_TOTAL_SALES = 5;

/** Window size to look at: 4 weeks total = 1 current + 3 prior baseline. */
const PERIODS = 4;

export type TrendingDiagnostics = {
  /** True when CARD_HEDGER_API was missing — the integration is
   *  effectively disabled, no fetches were attempted. */
  apiKeyMissing: boolean;
  /** Total unique non-empty players we asked CH about. */
  playersRequested: number;
  /** Total batches dispatched to CH. */
  batchesAttempted: number;
  /** Batches where CH returned 200. The remainder failed (non-200,
   *  network, parse). When all batches fail this matches CH outage
   *  vs. genuine zero-spike data. */
  batchesSucceeded: number;
  /** Player rows returned across all successful batches — the
   *  denominator for the trending check. */
  playersWithData: number;
  /** Last error message, if any. Surfaced verbatim in the diagnostic
   *  tooltip so we can debug Vercel deploys without function-log
   *  access. */
  lastError: string | null;
};

export type TrendingResult = {
  map: Record<string, TrendingInfo>;
  diagnostics: TrendingDiagnostics;
};

export async function computeTrendingMap(
  players: string[],
): Promise<TrendingResult> {
  const out: Record<string, TrendingInfo> = {};
  const diag: TrendingDiagnostics = {
    apiKeyMissing: !process.env.CARD_HEDGER_API,
    playersRequested: 0,
    batchesAttempted: 0,
    batchesSucceeded: 0,
    playersWithData: 0,
    lastError: null,
  };
  if (!process.env.CARD_HEDGER_API || players.length === 0) {
    return { map: out, diagnostics: diag };
  }

  // Dedupe + filter falsy. CH happily echoes back any string but we
  // don't want to bloat the request with empty / "—" values.
  const dedup = [...new Set(players.filter(Boolean))];
  diag.playersRequested = dedup.length;

  // Batch through CH; one failed batch doesn't kill the rest.
  for (let i = 0; i < dedup.length; i += BATCH_SIZE) {
    const batch = dedup.slice(i, i + BATCH_SIZE);
    diag.batchesAttempted++;
    try {
      const stats = await getPlayerSalesStats({
        players: batch,
        interval: "week",
        periods: PERIODS,
        includeCurrent: true,
      });
      diag.batchesSucceeded++;
      for (const r of stats) {
        diag.playersWithData++;
        const counts = r.buckets.map((b) => b.count);
        const currentBucket = r.buckets[r.buckets.length - 1];
        out[r.player] = {
          ...classifyTrending(counts),
          currentWeekCents: currentBucket?.totalCents ?? 0,
        };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      diag.lastError = msg;
      console.warn(
        `[trending] CH batch ${i}-${i + BATCH_SIZE} failed:`,
        msg,
      );
      // Continue — partial trending data is better than none.
    }
  }
  return { map: out, diagnostics: diag };
}

function classifyTrending(
  weeklyCounts: number[],
): Omit<TrendingInfo, "currentWeekCents"> {
  if (weeklyCounts.length < PERIODS) {
    return { isTrending: false, currentWeekSales: 0, spikeMultiple: 0 };
  }
  const current = weeklyCounts[weeklyCounts.length - 1];
  const prior = weeklyCounts.slice(-PERIODS, -1);
  const priorAvg =
    prior.length > 0 ? prior.reduce((s, c) => s + c, 0) / prior.length : 0;
  const totalSales = weeklyCounts.reduce((s, c) => s + c, 0);
  const spikeMultiple =
    priorAvg > 0 ? current / priorAvg : current > 0 ? Infinity : 0;
  const isTrending =
    totalSales >= MIN_TOTAL_SALES &&
    current >= MIN_CURRENT_SALES &&
    spikeMultiple >= SPIKE_THRESHOLD;
  return { isTrending, currentWeekSales: current, spikeMultiple };
}
