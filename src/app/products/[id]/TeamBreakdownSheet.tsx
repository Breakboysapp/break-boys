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
};

type SortBy = "score" | "value";

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
}: {
  buckets: AlgorithmBucket[];
  teamRows: Row[];
  playerRows: Row[];
  cards: CardLite[];
}) {
  const [view, setView] = useState<View>("team");
  const [sortBy, setSortBy] = useState<SortBy>("score");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // bucket label whose detail popover is currently open, or null.
  const [bucketDetail, setBucketDetail] = useState<string | null>(null);

  const rawRows = view === "team" ? teamRows : playerRows;
  // Re-sort rows in place each render. Score/Value selection drives the
  // ordering; the column data itself is the same.
  // For value sort, rows with no confirmed market data fall to the bottom
  // ordered by score (so the table doesn't just dump them randomly).
  const rows = useMemo(() => {
    const copy = [...rawRows];
    if (sortBy === "value") {
      copy.sort((a, b) => {
        if (b.confirmedMarketCents !== a.confirmedMarketCents) {
          return b.confirmedMarketCents - a.confirmedMarketCents;
        }
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
  const anyValueData = rawRows.some((r) => r.cardsWithMarket > 0);
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
  // # + Subject + ...buckets + Score + (optional Value)
  const totalCols = buckets.length + 3 + (anyValueData ? 1 : 0);

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
          {anyValueData && (
            <SortToggle current={sortBy} onChange={setSortBy} />
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
      <div className="isolate max-h-[640px] overflow-auto overscroll-contain">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-40 bg-ink text-white">
            <tr className="bg-ink">
              {/* shadow-[1px_0_0_0_#0a0a0a] paints a 1px ink-colored
                  extension to the right of the # cell so any subpixel
                  seam between # and TEAM is filled with the same color
                  as the header — no bucket text leaks through. */}
              <th className="sticky left-0 z-40 w-10 bg-ink px-3 py-2 text-left text-[10px] font-bold uppercase tracking-tight-2 shadow-[1px_0_0_0_#0a0a0a]">
                #
              </th>
              <th
                className={`sticky left-10 z-40 ${subjectMinWidth} bg-ink px-3 py-2 text-left text-[10px] font-bold uppercase tracking-tight-2`}
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
                    <td className="sticky left-0 z-20 w-10 bg-white px-3 py-2 text-xs text-slate-400 shadow-[1px_0_0_0_#ffffff]">
                      {i + 1}
                    </td>
                    <td
                      className={`sticky left-10 z-20 ${subjectMinWidth} bg-white px-3 py-2 font-semibold tracking-tight-2`}
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
                      {view === "team" ? <SubjectName name={r.name} /> : r.name}
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
                  {isOpen && (
                    <tr className="border-b border-slate-200 bg-slate-50">
                      <td colSpan={totalCols} className="p-0">
                        <PlayerSubBreakdown
                          buckets={buckets}
                          cards={cardsByTeam.get(r.name) ?? []}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot className="sticky bottom-0 z-30">
            <tr className="bg-bone [&>td]:border-t-2 [&>td]:border-ink text-[11px] font-bold uppercase tracking-tight-2 text-slate-700">
              <td colSpan={2} className="sticky left-0 z-40 bg-bone px-3 py-2">
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
 * Sub-table rendered when a team row is expanded. One row per player on
 * that team, with per-bucket card-number lists. Compact styling so it
 * visually nests under the parent score-card row.
 */
function PlayerSubBreakdown({
  buckets,
  cards,
}: {
  buckets: AlgorithmBucket[];
  cards: CardLite[];
}) {
  if (cards.length === 0) {
    return (
      <div className="px-12 py-3 text-xs text-slate-500">
        No cards on this team.
      </div>
    );
  }

  const players = computePlayerRows(cards, buckets);

  return (
    <div className="px-3 py-2">
      {/*
        Inner scroll container with its own bounds so the player sub-table
        can scroll independently of the parent score card. overscroll-contain
        prevents the gesture from chaining out to the score card or the page.
        max-h caps the sub-table around 9 rows so users can still see the
        next collapsed team row without expanding too far down.
      */}
      <div className="max-h-[360px] overflow-auto overscroll-contain rounded border border-slate-200 bg-slate-50">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-20 bg-bone">
            <tr className="text-[10px] font-bold uppercase tracking-tight-2 text-slate-500">
              <th className="sticky left-0 top-0 z-30 min-w-[140px] bg-bone px-2 py-1.5 text-left">
                Player
              </th>
              {buckets.map((b) => {
                const split = splitVariationLabel(b.label);
                return (
                  <th
                    key={b.label}
                    className="bg-bone px-2 py-1.5 text-left align-bottom"
                    title={split.detail ?? undefined}
                  >
                    <span className="line-clamp-2">{split.name}</span>
                  </th>
                );
              })}
              <th className="sticky right-0 top-0 z-30 w-16 min-w-[64px] bg-bone px-2 py-1.5 text-right">
                Score
              </th>
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <tr
                key={p.playerName}
                className="border-t border-slate-200"
              >
                <td className="sticky left-0 z-10 min-w-[140px] bg-slate-50 px-2 py-1.5 font-semibold tracking-tight-2 text-slate-800">
                  {p.playerName}
                </td>
                {buckets.map((b) => {
                  const nums = p.byBucket.get(b.label) ?? [];
                  return (
                    <td
                      key={b.label}
                      className={`max-w-[180px] px-2 py-1.5 align-top ${
                        nums.length === 0 ? "text-slate-300" : ""
                      }`}
                    >
                      {nums.length === 0 ? (
                        "—"
                      ) : (
                        <div className="flex items-baseline gap-1.5">
                          <span className="shrink-0 text-[11px] font-bold tabular-nums text-ink">
                            {nums.length}
                          </span>
                          <span className="break-all font-mono text-[10px] leading-tight text-slate-500">
                            {nums.join(", ")}
                          </span>
                        </div>
                      )}
                    </td>
                  );
                })}
                <td className="sticky right-0 z-10 w-16 min-w-[64px] bg-slate-50 px-2 py-1.5 text-right font-extrabold tabular-nums text-ink">
                  {p.totalScore}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function computePlayerRows(
  cards: CardLite[],
  buckets: AlgorithmBucket[],
): Array<{
  playerName: string;
  byBucket: Map<string, string[]>;
  totalScore: number;
}> {
  const weightByLabel = new Map(buckets.map((b) => [b.label, b.weight]));
  const m = new Map<
    string,
    { playerName: string; byBucket: Map<string, string[]>; totalScore: number }
  >();
  for (const c of cards) {
    const cls = classifyCard(c.cardNumber, c.variation);
    let row = m.get(c.playerName);
    if (!row) {
      row = { playerName: c.playerName, byBucket: new Map(), totalScore: 0 };
      m.set(c.playerName, row);
    }
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
}: {
  current: SortBy;
  onChange: (v: SortBy) => void;
}) {
  return (
    <div className="inline-flex rounded-md bg-white p-0.5 ring-1 ring-slate-200 text-[11px] font-bold uppercase tracking-tight-2">
      <ToggleButton
        active={current === "score"}
        onClick={() => onChange("score")}
      >
        Score
      </ToggleButton>
      <ToggleButton
        active={current === "value"}
        onClick={() => onChange("value")}
      >
        Value
      </ToggleButton>
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
