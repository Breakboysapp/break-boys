"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { classifyCard, splitVariationLabel } from "@/lib/scoring";
import { formatUsd } from "@/lib/money";
import { getTeamAbbreviation } from "@/lib/team-abbreviations";

type AlgorithmBucket = {
  label: string;
  weight: number;
  count: number;
  contribution: number;
  /** Original variation strings that collapsed into this bucket. Drives
   * the column-header info popover so users can see per-variation odds
   * after the columns get consolidated. */
  sources?: Array<{ variation: string; count: number }>;
};

type Row = {
  name: string;
  byBucket: Record<string, number>;
  totalCards: number;
  totalScore: number;
  confirmedMarketCents: number;
  totalPotentialCents: number;
  cardsWithMarket: number;
  maxPotentialCents: number;
  /** 0-100 raw Market Score (only populated for the team view).
   * Aggregates per-player marketScore across this team's roster. Used
   * internally for sort tiebreaks and tooltip detail; the displayed
   * primary signal is `marketRank` because the 0-100 scale read as
   * "9/100 = team is worthless" even when that team had real chase
   * value. */
  marketScore?: number;
  /** 1-of-N team market rank — ordinal position among teams in this
   * set with priced players. 1 = top market value. null when team has
   * zero priced players (no aggregate to rank). Hidden in the Player
   * view — players already have their own market signals on the Chase
   * scoreboard. */
  marketRank?: number | null;
};

// "value" was the eBay-confirmed-market sort. Retired in favor of
// Market (PriceCharting-backed). Kept in the type union so the
// always-false anyValueData branches below typecheck cleanly without
// dead-code edits. Setter never produces "value" anymore.
type SortBy = "score" | "market" | "value";

type CardLite = {
  team: string;
  playerName: string;
  cardNumber: string;
  variation: string | null;
  marketValueCents: number | null;
};

type View = "team" | "player";

export default function TeamBreakdownSheet({
  buckets,
  teamRows,
  playerRows,
  cards,
  playerProspectMap,
  playerRookieMap,
  totalRankedTeams,
}: {
  buckets: AlgorithmBucket[];
  teamRows: Row[];
  playerRows: Row[];
  cards: CardLite[];
  /** Total teams with a market rank (denominator for the "rank of N"
   *  display). When undefined, the Market Rank column falls back to
   *  showing just the rank number. */
  totalRankedTeams?: number;
  /** Per-player "is prospect?" flag (Bowman-only). Renders a (P)
   *  marker after the player name on player sub-rows and on the
   *  Player-view top-level rows. Empty for non-Bowman products. */
  playerProspectMap?: Record<string, boolean>;
  /** Per-player "is rookie?" flag. Renders a (R) marker after the
   *  player name on the Player-view top-level rows. Sub-rows derive
   *  isRookie from the underlying cards directly. */
  playerRookieMap?: Record<string, boolean>;
}) {
  const [view, setView] = useState<View>("team");
  const [sortBy, setSortBy] = useState<SortBy>("score");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // bucket label whose detail popover is currently open, or null.
  const [bucketDetail, setBucketDetail] = useState<string | null>(null);

  const rawRows = view === "team" ? teamRows : playerRows;
  // Re-sort rows in place each render. Score / Market selection drives
  // the ordering; the column data itself is the same. Market sort goes
  // by marketRank ASC (1 first). Rows with no rank (zero priced
  // players) fall to the bottom ordered by Break Score — keeps the
  // ordering deterministic when a chunk of teams have no market data.
  const rows = useMemo(() => {
    const copy = [...rawRows];
    if (sortBy === "market") {
      copy.sort((a, b) => {
        const ar = a.marketRank ?? Number.POSITIVE_INFINITY;
        const br = b.marketRank ?? Number.POSITIVE_INFINITY;
        if (ar !== br) return ar - br;
        return b.totalScore - a.totalScore;
      });
    } else {
      copy.sort((a, b) => b.totalScore - a.totalScore);
    }
    return copy;
  }, [rawRows, sortBy]);
  // Hide the Value column entirely when no row has any confirmed market
  // data. We deliberately do NOT use the synthetic class-based estimate
  // here as the displayed number — it's too noisy across player tiers
  // (an Ohtani auto = $2500, a journeyman auto = $50, both class=10).
  // The Value column (eBay confirmed-market sort) is fully retired — the
  // new Market column (PriceCharting-backed market score) covers the
  // same intent better. anyValueData stays defined as `false` so the
  // existing conditional-render call sites below short-circuit cleanly
  // without me having to rip them out everywhere.
  const anyValueData = false;
  // Only show Market Rank column when (a) we're on team view AND (b) at
  // least one row has a rank. Player view hides it because the Chase
  // scoreboard is the dedicated per-player market view.
  const showMarketScore =
    view === "team" && rawRows.some((r) => r.marketRank != null);
  const subjectLabel = view === "team" ? "Team" : "Player";
  // Team names get abbreviated on mobile (NYY, LAD, etc.), so the column
  // only needs ~64px on small screens. Player names don't have a clean
  // abbreviation and stay verbose on both breakpoints.
  const subjectMinWidth =
    view === "team"
      ? "min-w-[64px] sm:min-w-[180px]"
      : "min-w-[180px] sm:min-w-[220px]";
  // Only the team view has expandable rows — clicking a player doesn't
  // give us anywhere meaningful to drill into.
  const expandable = view === "team";

  // Cards grouped by team for fast on-demand player rollups when a team
  // row is expanded. Computed once per render via useMemo.
  const cardsByTeam = useMemo(() => {
    const m = new Map<string, CardLite[]>();
    for (const c of cards) {
      const arr = m.get(c.team) ?? [];
      arr.push(c);
      m.set(c.team, arr);
    }
    return m;
  }, [cards]);

  function toggle(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  if (buckets.length === 0) return null;
  const grandTotalScore = rows.reduce((s, r) => s + r.totalScore, 0);
  const grandTotalConfirmed = rows.reduce(
    (s, r) => s + r.confirmedMarketCents,
    0,
  );
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-slate-200 bg-bone px-4 py-2.5">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-tight-2 text-accent">
            Scorecard
          </div>
          <div className="text-sm font-extrabold leading-tight tracking-tight-3 sm:text-base">
            BREAK BOYS SCORECARD
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
          <ViewToggle current={view} onChange={setView} />
          {(anyValueData || showMarketScore) && (
            <SortToggle
              current={sortBy}
              onChange={setSortBy}
              showMarket={showMarketScore}
            />
          )}
          <div className="text-[10px] text-slate-500 sm:text-[11px]">
            {rows.length} {view === "team" ? "teams" : "players"} ·{" "}
            {buckets.length} types
            {expandable && (
              <span className="ml-1 text-slate-400">· click a team to expand</span>
            )}
          </div>
        </div>
      </div>

      {/*
        overscroll-contain stops horizontal panning on this table from
        chaining into the page (which would otherwise scroll the whole
        score card section out of view on mobile when you swipe past
        the table's edge — the user-reported "the whole cart moves"
        bug). Combined with the sticky-right Break Score + Value
        columns below, the user rarely needs to scroll at all to see
        the data they care about.
      */}
      {/*
        border-separate + border-spacing-0 is intentional. With
        border-collapse, sticky cells can leave hairline subpixel seams
        between them when scrolled — bucket cells slide under those
        seams and their text peeks through ("BASE SET" appearing
        between # and TEAM, etc.). With separate, each cell paints
        its own independent box so the seams disappear, AND the
        per-row bg-ink / bg-white fills behind every cell so the
        rendering stays solid even if a cell ever does have a gap.
      */}
      {/*
        overscroll-x-contain (NOT overscroll-none) — earlier this was
        overscroll-none everywhere to kill iOS rubber-band, but that
        also stopped vertical scroll from chaining to the page when the
        cursor sat over the table on desktop. So a user scrolling
        upward inside the scorecard had to mouse out of it before they
        could keep scrolling the page. x-contain isolates only the
        horizontal axis (to prevent the swipe-past-edge bug from
        earlier), letting vertical scroll-chain back to the page when
        you reach the top or bottom of the inner scrollbox.
      */}
      <div className="isolate max-h-[640px] overflow-auto overscroll-x-contain">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-50 bg-ink text-white">
            <tr className="bg-ink">
              {/* shadow-[1px_0_0_0_#0a0a0a] paints a 1px ink-colored
                  extension to the right of the # cell so any subpixel
                  seam between # and TEAM is filled with the same color
                  as the header — no bucket text leaks through. */}
              {/*
                transform-gpu + will-change-transform fixes the iOS
                Safari bug where sticky-positioned cells briefly
                "unstick" during a fast horizontal swipe — the cells
                drift before snapping back. Forcing them onto their
                own GPU compositor layer keeps them locked.
              */}
              <th className="sticky left-0 z-40 w-10 bg-ink px-3 py-2 text-left text-[10px] font-bold uppercase tracking-tight-2 shadow-[1px_0_0_0_#0a0a0a] transform-gpu will-change-transform">
                #
              </th>
              <th
                className={`sticky left-10 z-40 ${subjectMinWidth} bg-ink px-3 py-2 text-left text-[10px] font-bold uppercase tracking-tight-2 transform-gpu will-change-transform`}
              >
                {subjectLabel}
              </th>
              {buckets.map((b) => {
                // After classifyCard's paren-stripping, b.label is already
                // the canonical short name. The "i" indicator and popover
                // are driven by b.sources — populated whenever multiple
                // raw variation strings (different odds) collapse into
                // this bucket.
                const hasDetail = (b.sources?.length ?? 0) > 0;
                return (
                  <th
                    key={b.label}
                    className="bg-ink px-3 py-2 text-right text-[10px] font-bold uppercase tracking-tight-2"
                  >
                    <button
                      type="button"
                      onClick={() => hasDetail && setBucketDetail(b.label)}
                      className={`flex w-full flex-col items-end gap-0.5 leading-tight ${
                        hasDetail
                          ? "cursor-pointer hover:text-accent"
                          : "cursor-default"
                      }`}
                      title={
                        hasDetail
                          ? `Tap for ${b.sources!.length} variation${b.sources!.length === 1 ? "" : "s"} + odds`
                          : `${b.weight} pts/card`
                      }
                    >
                      <span className="line-clamp-2 text-right">
                        {b.label}
                        {hasDetail && (
                          <span
                            aria-hidden
                            className="ml-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-white/40 align-middle text-[8px] font-bold not-italic text-white/70"
                          >
                            i
                          </span>
                        )}
                      </span>
                      <span className="text-[9px] font-semibold text-white/60">
                        ×{b.weight}
                      </span>
                    </button>
                  </th>
                );
              })}
              {/* Break Score + Value are NOT sticky — pinning four
                  columns left almost no room for the bucket detail on
                  mobile, and the user explicitly preferred more
                  scrolling room to seeing the totals always. */}
              <th
                className={`w-24 min-w-[96px] px-3 py-2 text-right text-[10px] font-bold uppercase tracking-tight-2 ${
                  sortBy === "score" ? "bg-accent" : "bg-ink"
                }`}
              >
                Break Score
              </th>
              {showMarketScore && (
                <th
                  className={`w-24 min-w-[96px] px-3 py-2 text-right text-[10px] font-bold uppercase tracking-tight-2 ${
                    sortBy === "market" ? "bg-accent" : "bg-ink"
                  }`}
                  title="Team Market Rank: ordinal position of this team's roster value among all teams in this set. 1 = highest market value. We use a rank instead of a 0-100 score because the score's exponential gap made 9th place look worthless even when that team had a real chase rookie. Aggregate logic underneath: top-3 stars at full weight + depth, summed across the team's priced players."
                >
                  Market Rank
                </th>
              )}
              {anyValueData && (
                <th
                  className={`w-28 min-w-[112px] px-3 py-2 text-right text-[10px] font-bold uppercase tracking-tight-2 ${
                    sortBy === "value" ? "bg-accent" : "bg-ink"
                  }`}
                >
                  Value
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const isOpen = expandable && expanded.has(r.name);
              return (
                <Fragment key={r.name}>
                  <tr
                    className={`${
                      isOpen ? "bg-bone/40" : "bg-white"
                    } [&>td]:border-b [&>td]:border-slate-100 ${
                      expandable ? "cursor-pointer hover:bg-bone/40" : ""
                    }`}
                    onClick={() => expandable && toggle(r.name)}
                  >
                    <td className="sticky left-0 z-20 w-10 bg-white px-3 py-2 text-xs text-slate-400 shadow-[1px_0_0_0_#ffffff] transform-gpu will-change-transform">
                      {i + 1}
                    </td>
                    <td
                      className={`sticky left-10 z-20 ${subjectMinWidth} bg-white px-3 py-2 font-semibold tracking-tight-2 transform-gpu will-change-transform`}
                      title={view === "team" ? r.name : undefined}
                    >
                      {expandable && (
                        <span
                          aria-hidden
                          className={`mr-1.5 inline-block text-[9px] text-slate-400 transition-transform ${
                            isOpen ? "rotate-90 text-accent" : ""
                          }`}
                        >
                          ▶
                        </span>
                      )}
                      {view === "team" ? (
                        <SubjectName name={r.name} />
                      ) : (
                        <>
                          {r.name}
                          {playerRookieMap?.[r.name] && (
                            <span
                              className="ml-1 text-[10px] font-bold text-accent"
                              title="Rookie card in this set"
                            >
                              (R)
                            </span>
                          )}
                          {playerProspectMap?.[r.name] && (
                            <span
                              className="ml-1 text-[10px] font-bold text-emerald-600"
                              title="Prospect — minor leaguer or draft pick"
                            >
                              (P)
                            </span>
                          )}
                        </>
                      )}
                    </td>
                    {buckets.map((b) => {
                      const n = r.byBucket[b.label] ?? 0;
                      const contribution = n * b.weight;
                      return (
                        <td
                          key={b.label}
                          className={`bg-white px-3 py-2 text-right tabular-nums ${
                            n === 0 ? "text-slate-300" : "text-slate-700"
                          }`}
                          title={
                            n > 0
                              ? `${n} × ${b.weight} = ${contribution} pts`
                              : "no cards"
                          }
                        >
                          {n === 0 ? (
                            "—"
                          ) : (
                            <>
                              <div className="font-semibold leading-tight">{n}</div>
                              <div className="text-[10px] font-medium leading-tight text-slate-400">
                                {contribution} pts
                              </div>
                            </>
                          )}
                        </td>
                      );
                    })}
                    <td
                      className={`w-24 min-w-[96px] px-3 py-2 text-right font-extrabold tabular-nums tracking-tight-2 text-ink ${
                        sortBy === "score" ? "bg-accent-tint" : "bg-white"
                      }`}
                    >
                      {r.totalScore}
                    </td>
                    {showMarketScore && (
                      <td
                        className={`w-24 min-w-[96px] px-3 py-2 text-right tabular-nums ${
                          sortBy === "market" ? "bg-accent-tint" : "bg-white"
                        }`}
                        title={
                          r.marketRank != null
                            ? `Ranked #${r.marketRank}${
                                totalRankedTeams
                                  ? ` of ${totalRankedTeams} teams`
                                  : ""
                              } by aggregate roster market value. Underlying score: ${r.marketScore ?? 0}/100 (top-3 stars + depth, normalized).`
                            : "No market data on this team's roster yet."
                        }
                      >
                        {r.marketRank != null ? (
                          <>
                            <span className="text-base font-extrabold text-ink">
                              {r.marketRank}
                            </span>
                            {totalRankedTeams ? (
                              <span className="text-[10px] font-medium text-slate-400">
                                /{totalRankedTeams}
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                    )}
                    {anyValueData && (
                      <td
                        className={`w-28 min-w-[112px] px-3 py-2 text-right font-extrabold tabular-nums tracking-tight-2 text-ink ${
                          sortBy === "value" ? "bg-accent-tint" : "bg-white"
                        }`}
                        title={
                          r.cardsWithMarket > 0
                            ? `${r.cardsWithMarket} of ${r.totalCards} cards have confirmed market data`
                            : "no confirmed market data — premium card pricing not yet covered"
                        }
                      >
                        {r.cardsWithMarket > 0 ? (
                          <>
                            <div className="leading-tight">
                              {formatUsd(r.confirmedMarketCents)}
                            </div>
                            <div className="text-[10px] font-medium leading-tight text-slate-400">
                              {r.cardsWithMarket}/{r.totalCards}
                            </div>
                          </>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                    )}
                  </tr>
                  {isOpen &&
                    computePlayerRows(
                      cardsByTeam.get(r.name) ?? [],
                      buckets,
                    ).map((p) => (
                      // Player rows are rendered as real <tr> children of
                      // the parent table — NOT a nested table inside a
                      // colspan'd cell. That guarantees column widths line
                      // up perfectly between parent (team) rows and child
                      // (player) rows: the bucket columns, Break Score
                      // column, and Value column are literally the same
                      // table columns. Player name sticks in the same
                      // sticky-left slot as the team name, so the user can
                      // scroll horizontally and see the player on the
                      // left while bucket counts / card numbers slide
                      // past on the right.
                      <tr
                        key={`${r.name}::${p.playerName}`}
                        className="bg-slate-50/70 [&>td]:border-b [&>td]:border-slate-100"
                      >
                        <td className="sticky left-0 z-20 w-10 bg-slate-50 px-3 py-1.5 shadow-[1px_0_0_0_#f8fafc] transform-gpu will-change-transform" />
                        <td
                          className={`sticky left-10 z-20 ${subjectMinWidth} bg-slate-50 px-3 py-1.5 text-[12px] font-medium tracking-tight-2 text-slate-700 transform-gpu will-change-transform`}
                          title={p.playerName}
                        >
                          <span className="mr-1.5 text-slate-300">└</span>
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
                        </td>
                        {buckets.map((b) => {
                          const nums = p.byBucket.get(b.label) ?? [];
                          return (
                            <td
                              key={b.label}
                              className={`bg-slate-50 px-3 py-1.5 text-right align-top tabular-nums ${
                                nums.length === 0
                                  ? "text-slate-300"
                                  : "text-slate-600"
                              }`}
                              title={
                                nums.length > 0
                                  ? `${nums.length} card${nums.length === 1 ? "" : "s"} · ${nums.length * b.weight} pts`
                                  : "no cards"
                              }
                            >
                              {nums.length === 0 ? (
                                "—"
                              ) : (
                                // Single-row summary instead of the
                                // wrapping list. Long ones (Saggese
                                // 50× #87 across every parallel) used
                                // to blow the row to ~50 lines tall.
                                // Now: show count + first card #;
                                // truncate the rest.
                                <div className="text-[10px] leading-tight">
                                  <span className="font-semibold text-slate-700">
                                    {nums.length}×
                                  </span>{" "}
                                  <span className="text-slate-500">
                                    #{nums[0]}
                                    {nums.length > 1 && "+"}
                                  </span>
                                </div>
                              )}
                            </td>
                          );
                        })}
                        <td
                          className={`w-24 min-w-[96px] px-3 py-1.5 text-right text-[13px] font-bold tabular-nums tracking-tight-2 text-slate-700 ${
                            sortBy === "score" ? "bg-accent-tint/50" : "bg-slate-50"
                          }`}
                        >
                          {p.totalScore}
                        </td>
                        {showMarketScore && (
                          // Player sub-rows have no per-player Market
                          // Score in the team view (the Chase
                          // scoreboard is the per-player view). Empty
                          // cell keeps grid widths aligned with parent
                          // team rows.
                          <td className="w-24 min-w-[96px] bg-slate-50 px-3 py-1.5" />
                        )}
                        {anyValueData && (
                          <td
                            className={`w-28 min-w-[112px] px-3 py-1.5 text-right text-[10px] text-slate-300 ${
                              sortBy === "value" ? "bg-accent-tint/50" : "bg-slate-50"
                            }`}
                          >
                            —
                          </td>
                        )}
                      </tr>
                    ))}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot className="sticky bottom-0 z-30">
            <tr className="bg-bone [&>td]:border-t-2 [&>td]:border-ink text-[11px] font-bold uppercase tracking-tight-2 text-slate-700">
              <td
                colSpan={2}
                className="sticky left-0 z-40 bg-bone px-3 py-2 transform-gpu will-change-transform"
              >
                Total
              </td>
              {buckets.map((b) => (
                <td
                  key={b.label}
                  className="bg-bone px-3 py-2 text-right tabular-nums text-slate-700"
                  title={`${b.count} × ${b.weight} = ${b.contribution} pts`}
                >
                  <div className="leading-tight">{b.count}</div>
                  <div className="text-[10px] font-medium leading-tight text-slate-500">
                    {b.contribution} pts
                  </div>
                </td>
              ))}
              <td
                className={`w-24 min-w-[96px] px-3 py-2 text-right tabular-nums text-white ${
                  sortBy === "score" ? "bg-accent" : "bg-ink"
                }`}
              >
                {grandTotalScore}
              </td>
              {showMarketScore && (
                // Market Score is normalized 0-100 per team, so a grand
                // total doesn't carry meaning the way Break Score's
                // sum does. Leave the total cell blank but present so
                // the column stays aligned. Highlight the cell when
                // sorted by Market to keep the column highlight
                // consistent with the rest of the table.
                <td
                  className={`w-24 min-w-[96px] px-3 py-2 ${
                    sortBy === "market" ? "bg-accent" : "bg-ink"
                  }`}
                />
              )}
              {anyValueData && (
                <td
                  className={`w-28 min-w-[112px] px-3 py-2 text-right tabular-nums text-white ${
                    sortBy === "value" ? "bg-accent" : "bg-ink"
                  }`}
                  title="Total of confirmed PriceCharting market values across the catalog"
                >
                  {formatUsd(grandTotalConfirmed)}
                </td>
              )}
            </tr>
          </tfoot>
        </table>
      </div>

      {bucketDetail && (
        <BucketDetailModal
          bucket={buckets.find((b) => b.label === bucketDetail)}
          onClose={() => setBucketDetail(null)}
        />
      )}
    </div>
  );
}

/**
 * Roll up a team's cards into one row per player. Returned shape mirrors
 * the parent score-card row (per-bucket counts → totalScore), so the
 * caller can render player rows as real <tr> children of the parent
 * table and reuse the exact same column widths.
 */
// True when the variation carries the Beckett rookie tag — variation
// ending in "· RC" or containing the word "rookie". Mirrors the
// detection used by ChaseScoreboard so the (R) marker reads
// consistently across both views.
const ROOKIE_RE = /·\s*RC$|\brc\b|rookie/i;
function isRookieVariation(v: string | null | undefined): boolean {
  return v != null && ROOKIE_RE.test(v);
}

function computePlayerRows(
  cards: CardLite[],
  buckets: AlgorithmBucket[],
): Array<{
  playerName: string;
  isRookie: boolean;
  byBucket: Map<string, string[]>;
  totalScore: number;
}> {
  const weightByLabel = new Map(buckets.map((b) => [b.label, b.weight]));
  const m = new Map<
    string,
    {
      playerName: string;
      isRookie: boolean;
      byBucket: Map<string, string[]>;
      totalScore: number;
    }
  >();
  for (const c of cards) {
    const cls = classifyCard(c.cardNumber, c.variation);
    let row = m.get(c.playerName);
    if (!row) {
      row = {
        playerName: c.playerName,
        isRookie: false,
        byBucket: new Map(),
        totalScore: 0,
      };
      m.set(c.playerName, row);
    }
    if (isRookieVariation(c.variation)) row.isRookie = true;
    let nums = row.byBucket.get(cls.label);
    if (!nums) {
      nums = [];
      row.byBucket.set(cls.label, nums);
    }
    nums.push(c.cardNumber);
    row.totalScore += weightByLabel.get(cls.label) ?? cls.weight;
  }
  return [...m.values()].sort((a, b) => b.totalScore - a.totalScore);
}

function ViewToggle({
  current,
  onChange,
}: {
  current: View;
  onChange: (v: View) => void;
}) {
  return (
    <div className="inline-flex rounded-md bg-white p-0.5 ring-1 ring-slate-200 text-[11px] font-bold uppercase tracking-tight-2">
      <ToggleButton active={current === "team"} onClick={() => onChange("team")}>
        Team
      </ToggleButton>
      <ToggleButton active={current === "player"} onClick={() => onChange("player")}>
        Player
      </ToggleButton>
    </div>
  );
}

function SortToggle({
  current,
  onChange,
  showMarket,
}: {
  current: SortBy;
  onChange: (v: SortBy) => void;
  showMarket: boolean;
}) {
  return (
    <div className="inline-flex rounded-md bg-white p-0.5 ring-1 ring-slate-200 text-[11px] font-bold uppercase tracking-tight-2">
      <ToggleButton
        active={current === "score"}
        onClick={() => onChange("score")}
      >
        Score
      </ToggleButton>
      {showMarket && (
        <ToggleButton
          active={current === "market"}
          onClick={() => onChange("market")}
        >
          Market
        </ToggleButton>
      )}
    </div>
  );
}

/**
 * Modal showing the full variation label + odds detail when a user
 * clicks the "i" icon on a column header. The label is split into a
 * short display name and a paren-wrapped detail string by
 * splitVariationLabel; this just presents the detail readably.
 *
 * Closes on backdrop click, Escape key, or the explicit close button.
 * Body scroll is NOT locked because the underlying score card already
 * has overscroll-contain — locking the body would freeze the rest of
 * the page unnecessarily.
 */
function BucketDetailModal({
  bucket,
  onClose,
}: {
  bucket: AlgorithmBucket | undefined;
  onClose: () => void;
}) {
  // Escape closes the modal — common keyboard pattern
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!bucket) return null;
  const sources = bucket.sources ?? [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={bucket.label}
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
              Card type · {bucket.weight} pts/card
            </div>
            <h2 className="mt-1 text-lg font-extrabold leading-tight tracking-tight-3">
              {bucket.label}
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

        {sources.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 text-[10px] font-bold uppercase tracking-tight-2 text-slate-500">
              Variations · {sources.length}
            </div>
            <ul className="space-y-2">
              {sources.map((s) => {
                // The source variation typically looks like
                // "Superfractors - 1/1 (1:6,759 JUMBO, 1:453 SUPER)".
                // Pull the odds out of the parens so the row reads
                // cleanly without repeating the bucket name.
                const split = splitVariationLabel(s.variation);
                return (
                  <li
                    key={s.variation}
                    className="rounded-lg border border-slate-200 bg-bone p-3"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="min-w-0 flex-1 text-[12px] font-semibold leading-tight tracking-tight-2 text-ink">
                        {split.name}
                      </div>
                      <div className="shrink-0 text-[10px] font-bold uppercase tracking-tight-2 text-slate-500">
                        {s.count} {s.count === 1 ? "card" : "cards"}
                      </div>
                    </div>
                    {split.detail && (
                      <p className="mt-1 whitespace-pre-wrap text-[11px] leading-snug text-slate-600">
                        {split.detail}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="text-[10px] font-bold uppercase tracking-tight-2 text-slate-500">
              Cards in product
            </div>
            <div className="mt-1 text-base font-extrabold tabular-nums">
              {bucket.count}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="text-[10px] font-bold uppercase tracking-tight-2 text-slate-500">
              Score contribution
            </div>
            <div className="mt-1 text-base font-extrabold tabular-nums">
              {bucket.contribution} pts
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Team-name display that swaps to a compact abbreviation on mobile so
 * the Team column doesn't eat half the table. Falls back to the full
 * name on either breakpoint when the team doesn't have a known
 * abbreviation (rare — covers all 4 majors + WNBA), and the title
 * attribute on the parent <td> exposes the long form on hover.
 */
function SubjectName({ name }: { name: string }) {
  const abbr = getTeamAbbreviation(name);
  if (!abbr) return <>{name}</>;
  return (
    <>
      <span className="sm:hidden">{abbr}</span>
      <span className="hidden sm:inline">{name}</span>
    </>
  );
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-3 py-1.5 transition ${
        active ? "bg-ink text-white" : "text-slate-600 hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
