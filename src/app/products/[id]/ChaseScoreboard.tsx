"use client";

import { useEffect, useMemo, useState } from "react";
import { formatUsd } from "@/lib/money";

/**
 * Per-card data the Chase view needs. A subset of the full Card row,
 * narrowed at the page-loader level so we don't ship every column to
 * the client.
 */
export type ChaseCard = {
  playerName: string;
  /** Real team when available ("Los Angeles Dodgers"), or "—" placeholder
   * for cards the importer couldn't team-infer. Surfaced as part of the
   * Player column subtitle so users see who the player rolls up under. */
  team: string;
  /** True when this card carries the Beckett rookie tag — variation
   * ending in "· RC" (the convention from the xlsx upload) or
   * containing the word "rookie". Aggregated up to player level by
   * the rollup so any-rookie-card-in-set tags the player with (R). */
  isRookie: boolean;
  cardNumber: string;
  variation: string | null;
  ungradedCents: number | null;
  psa10Cents: number | null;
  psa9Cents: number | null;
  printRun: number | null;
  popG10: number | null;
  popTotal: number | null;
  imageUrl: string | null;
};

type PlayerRollup = {
  playerName: string;
  /** First non-placeholder team encountered for this player. "—" only
   * if every one of their cards has the placeholder; in practice that's
   * rare since manual checklist uploads carry real teams. */
  team: string;
  /** True if ANY of the player's cards in this set is rookie-tagged.
   * Drives the "(R)" suffix shown after the player name. */
  isRookie: boolean;
  cardCount: number;
  /** % change of the player's overall market basket over the snapshot
   * window — not just the top card. Card-Ladder-index style:
   * aggregates all of the player's priced cards' movements into a
   * single market-direction number. Filled in from the playerTrends
   * map after rollup. */
  marketTrendPct: number | null;
  /** Highest PSA 10 across this player's cards. Drives the score —
   *  Card Ladder's player-index logic: a /1 Superfractor selling for
   *  $50k IS a market signal that lifts the player's whole market,
   *  even if you'll never pull that exact card. The chase prize tells
   *  you what collectors will pay at the top end, which informs what
   *  every other card by that player is worth. */
  topPsa10Cents: number;
  topVariation: string | null;
  topCardNumber: string;
  topImageUrl: string | null;
  /** Median PSA 10 across the player's priced cards. The "typical
   *  card" floor — counterweight to topPsa10Cents so a player with
   *  one high-priced /1 and nothing else doesn't dominate over a
   *  player with depth (multiple solid parallels). */
  medianPsa10Cents: number;
  /** 0-100 player market score — Card-Ladder-style index. Sourced
   *  from the player's priced cards across ALL products in the DB
   *  (cross-product / hobby-wide footprint). Stable across product
   *  pages: a player's "Overall" reads the same on every product
   *  they appear in. Drives the rank order. */
  marketScore: number;
  /** 0-100 set-specific market score — same blend math, but sourced
   *  ONLY from this product's priced cards. Drops to 0 on day-of-
   *  release when nothing's traded yet. Useful contrast: a player
   *  whose Overall is high but whose In-Set is low signals "the
   *  market knows them, but their cards in THIS set aren't trading
   *  yet" — and vice versa for set-specific heat. */
  inSetMarketScore: number;
  /** Combined PSA + CGC pop counts — sum across player's cards. Pop
   *  volume is its own market signal: collectors only pay grading fees
   *  on cards they think are worth grading. Gem rate is shown in its
   *  own column so users can read both signals independently. */
  popG10Sum: number;
  popTotalSum: number;
  gemRate: number | null;
};

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Per-card effective value: PSA 10 if PC has the comp, otherwise
// raw × 6. Lets cards with raw-only comps (Arnold's BD-30 Black /1
// at $3K raw, no graded comp yet) still feed the player's blend. 6
// is conservative — high-end auto chase often sells at 10-15× raw
// graded, but underestimating beats over-inflating un-traded cards.
const RAW_TO_GRADED_MULT = 6;
function effectiveValue(c: ChaseCard): number {
  const psa = c.psa10Cents ?? 0;
  const raw = (c.ungradedCents ?? 0) * RAW_TO_GRADED_MULT;
  return Math.max(psa, raw);
}

function rollupByPlayer(cards: ChaseCard[]): PlayerRollup[] {
  const m = new Map<
    string,
    PlayerRollup & { _psa10s: number[] }
  >();
  for (const c of cards) {
    const psa10 = effectiveValue(c);
    let row = m.get(c.playerName);
    if (!row) {
      row = {
        playerName: c.playerName,
        team: "—",
        isRookie: false,
        cardCount: 0,
        topPsa10Cents: 0,
        topVariation: null,
        topCardNumber: "",
        topImageUrl: null,
        marketTrendPct: null,
        medianPsa10Cents: 0,
        marketScore: 0,
        inSetMarketScore: 0,
        popG10Sum: 0,
        popTotalSum: 0,
        gemRate: null,
        _psa10s: [],
      };
      m.set(c.playerName, row);
    }
    row.cardCount++;
    // Take the first real team value we encounter — usually the same
    // for all of a player's cards in a single set unless they were
    // traded mid-season.
    if (row.team === "—" && c.team && c.team !== "—") row.team = c.team;
    if (c.isRookie) row.isRookie = true;
    if (psa10 > 0) row._psa10s.push(psa10);
    if (psa10 > row.topPsa10Cents) {
      row.topPsa10Cents = psa10;
      row.topVariation = c.variation;
      row.topCardNumber = c.cardNumber;
      row.topImageUrl = c.imageUrl;
    }
    if (c.popG10 != null) row.popG10Sum += c.popG10;
    if (c.popTotal != null) row.popTotalSum += c.popTotal;
  }

  const players = [...m.values()];
  // Compute median across each player's priced cards.
  for (const p of players) p.medianPsa10Cents = median(p._psa10s);

  // Composite market score: 60% top + 40% median, both log-scaled,
  // normalized against the set's max blend. Log because PSA 10 prices
  // span 4+ orders of magnitude — linear normalization squashes the
  // middle to single digits. Floor at 1 to keep dim players visible.
  const blend = (top: number, mid: number) =>
    Math.log(top + 1) * 0.6 + Math.log(mid + 1) * 0.4;
  const maxBlend = Math.max(
    ...players.map((p) => blend(p.topPsa10Cents, p.medianPsa10Cents)),
  );
  if (maxBlend > 0) {
    for (const p of players) {
      const playerBlend = blend(p.topPsa10Cents, p.medianPsa10Cents);
      const score =
        playerBlend > 0
          ? Math.max(1, Math.round((playerBlend / maxBlend) * 100))
          : 0;
      // Both fields seeded with the in-set score initially. The page
      // overrides marketScore with the cross-product (Overall) score
      // afterward; inSetMarketScore stays as the set-specific snapshot.
      p.marketScore = score;
      p.inSetMarketScore = score;
    }
  }
  for (const row of players) {
    row.gemRate =
      row.popTotalSum > 0 ? row.popG10Sum / row.popTotalSum : null;
  }
  return players.sort((a, b) => b.marketScore - a.marketScore);
}

export default function ChaseScoreboard({
  cards,
  playerGlobalScores,
  playerProspectMap,
  playerTrends,
  trendDays,
}: {
  cards: ChaseCard[];
  playerGlobalScores?: Record<string, number>;
  /** Per-player "is prospect?" flag (Bowman-only). Renders a (P)
   *  marker after the player name. Empty / undefined for non-Bowman
   *  products. */
  playerProspectMap?: Record<string, boolean>;
  playerTrends?: Record<string, number | null>;
  trendDays?: number;
}) {
  const players = useMemo(() => {
    const rollup = rollupByPlayer(cards);
    // Override marketScore with the cross-product (global) player
    // index when available. The in-set rollup gives us all the
    // metadata (top card, parallel count, gem rate) but the SCORE
    // itself is sourced from each player's hobby-wide priced data
    // so that new products without in-set trades still show real
    // rankings on day 1. When global data is missing for a player
    // (rare — only true rookies with zero traded cards anywhere),
    // we keep the in-set rollup score as fallback.
    if (playerGlobalScores) {
      for (const r of rollup) {
        const g = playerGlobalScores[r.playerName];
        if (g != null && g > 0) {
          r.marketScore = g;
        }
      }
    }
    if (playerTrends) {
      for (const r of rollup) {
        const pct = playerTrends[r.playerName];
        if (pct != null && Number.isFinite(pct)) {
          r.marketTrendPct = pct;
        }
      }
    }
    // Re-sort after overriding scores so the displayed top-20 reflects
    // the global player market, not the in-set rollup default order.
    rollup.sort((a, b) => b.marketScore - a.marketScore);
    return rollup;
  }, [cards, playerGlobalScores, playerTrends]);
  const top20 = players.slice(0, 20);
  // "Has data" = any in-set price OR any global player score. The
  // global score keeps the Chase view useful for brand-new products
  // (Bowman 2026 etc.) where no cards in this set have traded but
  // the players already have hobby-wide market footprint.
  const hasAnyValue =
    top20.some((p) => p.topPsa10Cents > 0) ||
    top20.some((p) => p.marketScore > 0);
  const hasAnyPop = top20.some((p) => p.popTotalSum > 0);
  // Only show Trend column when at least one player has trend data
  // (i.e. ≥2 snapshots on at least one of their priced cards). Day-1
  // of tracking nothing shows; column fills in as the cron runs each
  // morning.
  const hasAnyTrend = top20.some((p) => p.marketTrendPct != null);
  const trendLabel =
    trendDays != null && trendDays >= 1
      ? `${Math.round(trendDays)}D Trend`
      : "Trend";
  const [explainerOpen, setExplainerOpen] = useState(false);

  if (!hasAnyValue) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
        <div className="text-[10px] font-bold uppercase tracking-tight-2 text-accent">
          Chase
        </div>
        <div className="mt-1 text-base font-extrabold tracking-tight-3">
          No PSA 10 pricing yet
        </div>
        <p className="mt-2 text-xs text-slate-500">
          The Chase scoreboard ranks players by their highest-grade card values
          (sourced from PriceCharting). This product hasn&apos;t been imported
          yet, or it pre-dates the integration.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-slate-200 bg-bone px-4 py-2.5">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-tight-2 text-accent">
            Chase
          </div>
          <div className="text-sm font-extrabold leading-tight tracking-tight-3 sm:text-base">
            TOP 20 BY VALUE
          </div>
        </div>
        <div className="text-[10px] text-slate-500 sm:text-[11px]">
          PSA 10 prices · pop counts {hasAnyPop ? "" : "(none yet)"}
        </div>
      </div>

      {/*
        overscroll-x-contain (NOT overscroll-none) — earlier we used
        overscroll-none everywhere to kill iOS rubber-band, but that
        also blocked vertical mouse-wheel events from passing through
        to the page when the cursor sat over the table on desktop.
        x-contain isolates only the horizontal axis, so vertical wheel
        scroll bubbles up to the page like normal.
      */}
      <div className="overflow-x-auto overscroll-x-contain">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead className="bg-ink text-white">
            <tr>
              <th className="w-10 px-3 py-2 text-left text-[10px] font-bold uppercase tracking-tight-2">
                #
              </th>
              <th className="min-w-[160px] px-3 py-2 text-left text-[10px] font-bold uppercase tracking-tight-2">
                Player
              </th>
              <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-tight-2">
                Top card
              </th>
              {hasAnyTrend && (
                <th
                  className="w-20 min-w-[80px] bg-ink px-3 py-2 text-right text-[10px] font-bold uppercase tracking-tight-2"
                  title={`% change in the player's top card effective value over the snapshot window (${trendDays != null ? Math.round(trendDays) + " days" : "current"}). Calculated against the earliest CardPriceSnapshot on each player's top card. Fills in as the daily cron accumulates more history.`}
                >
                  {trendLabel}
                </th>
              )}
              <th className="w-20 min-w-[80px] px-3 py-2 text-right text-[10px] font-bold uppercase tracking-tight-2">
                <button
                  type="button"
                  onClick={() => setExplainerOpen(true)}
                  className="inline-flex items-center gap-1 hover:text-accent"
                  title="What is Market Score?"
                >
                  <span>Overall</span>
                  <span
                    aria-hidden
                    className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-white/40 text-[8px] font-bold text-white/70"
                  >
                    i
                  </span>
                </button>
              </th>
              <th
                className="w-20 min-w-[80px] px-3 py-2 text-right text-[10px] font-bold uppercase tracking-tight-2"
                title="Set-specific market score — same blend math but sourced ONLY from cards priced in this product. Drops to '—' on day-of-release before any in-set sales accumulate. Useful contrast against Overall: a player whose Overall is high but In-Set is low signals 'the market knows them, but their cards in THIS set haven't traded yet'; high In-Set with lower Overall flags set-specific heat."
              >
                In Set
              </th>
              <th
                className="w-20 min-w-[80px] px-3 py-2 text-right text-[10px] font-bold uppercase tracking-tight-2"
                title="Combined PSA + CGC gem rate across all of this player's cards (Grade 10s ÷ total graded)."
              >
                Gem rate
              </th>
            </tr>
          </thead>
          <tbody>
            {top20.map((p, i) => {
              const isTop10 = i < 10;
              return (
                <tr
                  key={p.playerName}
                  className={`[&>td]:border-b [&>td]:border-slate-100 ${
                    isTop10 ? "bg-accent-tint/30" : "bg-white"
                  }`}
                >
                  <td className="px-3 py-2 text-xs tabular-nums text-slate-400">
                    <span className={isTop10 ? "font-bold text-accent" : ""}>
                      {i + 1}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-semibold tracking-tight-2">
                    {p.playerName}
                    {p.isRookie && (
                      <span
                        className="ml-1 text-[10px] font-bold text-accent"
                        title="Rookie card in this set"
                      >
                        (R)
                      </span>
                    )}
                    {playerProspectMap?.[p.playerName] && (
                      <span
                        className="ml-1 text-[10px] font-bold text-emerald-600"
                        title="Prospect — minor leaguer or draft pick"
                      >
                        (P)
                      </span>
                    )}
                    <div className="text-[10px] font-medium text-slate-400">
                      {p.team !== "—" && (
                        <>
                          <span className="text-slate-500">{p.team}</span>
                          <span aria-hidden> · </span>
                        </>
                      )}
                      {p.cardCount}{" "}
                      {p.cardCount === 1 ? "card" : "parallels"} in set
                    </div>
                  </td>
                  <td className="px-3 py-2 text-[11px] text-slate-600">
                    <div className="flex items-center gap-2">
                      {p.topImageUrl && (
                        // Small thumbnail of the top card. Loaded lazily —
                        // PC's storage.googleapis URLs serve straight to the
                        // browser. No proxying needed.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.topImageUrl}
                          alt=""
                          className="h-9 w-7 shrink-0 rounded border border-slate-200 object-cover"
                          loading="lazy"
                        />
                      )}
                      <div className="min-w-0">
                        <div className="font-medium text-slate-700">
                          #{p.topCardNumber}
                        </div>
                        <div className="truncate text-slate-500">
                          {p.topVariation ?? "Base"}
                        </div>
                      </div>
                    </div>
                  </td>
                  {hasAnyTrend && (
                    <td
                      className="w-20 min-w-[80px] px-3 py-2 text-right tabular-nums"
                      title={
                        p.marketTrendPct != null
                          ? `${p.marketTrendPct.toFixed(1)}% change in this player's overall market basket over the snapshot window`
                          : "No trend data yet for this player's basket."
                      }
                    >
                      {p.marketTrendPct != null ? (
                        <span
                          className={`text-[12px] font-bold ${
                            p.marketTrendPct > 0
                              ? "text-emerald-600"
                              : p.marketTrendPct < 0
                                ? "text-accent"
                                : "text-slate-400"
                          }`}
                        >
                          {p.marketTrendPct > 0 ? "↑" : p.marketTrendPct < 0 ? "↓" : "="}
                          {Math.abs(p.marketTrendPct).toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  )}
                  <td
                    className="px-3 py-2 text-right tabular-nums"
                    title={`Overall: ${p.marketScore}/100. Cross-product player index — sourced from this player's priced cards across every product in the DB.`}
                  >
                    {p.marketScore > 0 ? (
                      <>
                        <span className="text-base font-extrabold text-ink">
                          {p.marketScore}
                        </span>
                        <span className="text-[10px] font-medium text-slate-400">
                          /100
                        </span>
                      </>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td
                    className="px-3 py-2 text-right tabular-nums"
                    title={
                      p.inSetMarketScore > 0
                        ? `In-Set: ${p.inSetMarketScore}/100. Same blend math but only this product's priced cards.`
                        : "No in-set price data yet for this player."
                    }
                  >
                    {p.inSetMarketScore > 0 ? (
                      <>
                        <span className="text-sm font-bold text-slate-700">
                          {p.inSetMarketScore}
                        </span>
                        <span className="text-[10px] font-medium text-slate-400">
                          /100
                        </span>
                      </>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {p.gemRate != null ? (
                      <>
                        <div className="font-bold text-ink">
                          {(p.gemRate * 100).toFixed(1)}%
                        </div>
                        <div className="text-[10px] font-medium text-slate-400">
                          {p.popG10Sum.toLocaleString()}/
                          {p.popTotalSum.toLocaleString()}
                        </div>
                      </>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {explainerOpen && (
        <MarketScoreExplainer onClose={() => setExplainerOpen(false)} />
      )}
    </div>
  );
}

/**
 * Tap-the-i explainer for the Market Score column. Same modal pattern
 * as the bucket-detail popover on TeamBreakdownSheet so the chrome
 * stays consistent. Closes on Escape, backdrop click, or the X button.
 */
function MarketScoreExplainer({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Market Score explainer"
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60"
      />
      <div className="relative z-10 m-3 max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold uppercase tracking-tight-2 text-accent">
              Chase view · per-player rating
            </div>
            <h2 className="mt-1 text-lg font-extrabold leading-tight tracking-tight-3">
              Market Score
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-ink"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 space-y-3 text-sm leading-relaxed text-slate-700">
          <p>
            A <strong>0–100 player market index</strong> — like a stock
            index for each player&apos;s card market in this set. Top
            player in the set is pinned at 100; everyone else slides
            relative to them.
          </p>
          <ul className="space-y-1.5 text-[13px]">
            <li>
              <strong>Chase signal weighs heaviest.</strong> The
              trophy card isn&apos;t something you&apos;ll personally
              pull, but its sale price IS the strongest signal of where
              the player&apos;s market sits — and lifts the value of
              their other cards across the board.
            </li>
            <li>
              <strong>Depth matters too.</strong> A player with a few
              solid parallels selling consistently shouldn&apos;t lose
              to one whose only data point is a single anomalous /1
              sale. We weight median sale data alongside the top.
            </li>
            <li>
              <strong>Both graded and raw comps count.</strong> Many
              ultra-rare parallels (/1s, /5 Refractors) trade actively
              on the secondary market without ever being graded — we
              factor those in instead of pretending they don&apos;t
              exist.
            </li>
            <li>
              <strong>Read alongside Gem Rate.</strong> Pop volume is a
              separate market-validity signal: collectors only pay
              grading fees on cards they think are worth grading.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
