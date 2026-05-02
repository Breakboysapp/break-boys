"use client";

import { Fragment, useMemo, useState } from "react";
import { classifyCard } from "@/lib/scoring";
import { formatUsd } from "@/lib/money";

type AlgorithmBucket = {
  label: string;
  weight: number;
  count: number;
  contribution: number;
};

type Row = {
  name: string;
  byBucket: Record<string, number>;
  totalCards: number;
  totalScore: number;
  totalMarketCents: number;
  cardsWithMarket: number;
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

  const rawRows = view === "team" ? teamRows : playerRows;
  // Re-sort rows in place each render. Score/Value selection drives the
  // ordering; the column data itself is the same.
  const rows = useMemo(() => {
    const copy = [...rawRows];
    if (sortBy === "value") {
      copy.sort((a, b) => b.totalMarketCents - a.totalMarketCents);
    } else {
      copy.sort((a, b) => b.totalScore - a.totalScore);
    }
    return copy;
  }, [rawRows, sortBy]);
  // Hide the Value column entirely when no row has any market data —
  // showing a column of "—" adds noise without value.
  const anyMarketData = rawRows.some((r) => r.cardsWithMarket > 0);
  const subjectLabel = view === "team" ? "Team" : "Player";
  const subjectMinWidth = view === "team" ? "min-w-[180px]" : "min-w-[220px]";
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
  const grandTotalMarket = rows.reduce((s, r) => s + r.totalMarketCents, 0);
  // # + Subject + ...buckets + Score + (optional Value)
  const totalCols = buckets.length + 3 + (anyMarketData ? 1 : 0);

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-slate-200 bg-bone px-4 py-2.5">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-tight-2 text-accent">
            Score Card
          </div>
          <div className="text-sm font-extrabold leading-tight tracking-tight-3 sm:text-base">
            BREAK BOYS SCORE CARD
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
          <ViewToggle current={view} onChange={setView} />
          {anyMarketData && (
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

      <div className="max-h-[640px] overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-30 bg-ink text-white">
            <tr>
              <th className="sticky left-0 z-40 w-10 bg-ink px-3 py-2 text-left text-[10px] font-bold uppercase tracking-tight-2">
                #
              </th>
              <th
                className={`sticky left-10 z-40 ${subjectMinWidth} bg-ink px-3 py-2 text-left text-[10px] font-bold uppercase tracking-tight-2`}
              >
                {subjectLabel}
              </th>
              {buckets.map((b) => (
                <th
                  key={b.label}
                  className="bg-ink px-3 py-2 text-right text-[10px] font-bold uppercase tracking-tight-2"
                  title={`${b.weight} pts/card`}
                >
                  <div className="leading-tight">{b.label}</div>
                  <div className="text-[9px] font-semibold text-white/60">
                    ×{b.weight}
                  </div>
                </th>
              ))}
              <th
                className={`px-3 py-2 text-right text-[10px] font-bold uppercase tracking-tight-2 ${
                  sortBy === "score" ? "bg-accent" : "bg-ink"
                }`}
              >
                Break Score
              </th>
              {anyMarketData && (
                <th
                  className={`px-3 py-2 text-right text-[10px] font-bold uppercase tracking-tight-2 ${
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
                    className={`border-b border-slate-100 last:border-0 ${
                      expandable ? "cursor-pointer hover:bg-bone/40" : ""
                    } ${isOpen ? "bg-bone/40" : ""}`}
                    onClick={() => expandable && toggle(r.name)}
                  >
                    <td className="sticky left-0 z-20 w-10 bg-white px-3 py-2 text-xs text-slate-400">
                      {i + 1}
                    </td>
                    <td
                      className={`sticky left-10 z-20 ${subjectMinWidth} bg-white px-3 py-2 font-semibold tracking-tight-2`}
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
                      {r.name}
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
                      className={`px-3 py-2 text-right font-extrabold tabular-nums tracking-tight-2 text-ink ${
                        sortBy === "score" ? "bg-accent/10" : "bg-white"
                      }`}
                    >
                      {r.totalScore}
                    </td>
                    {anyMarketData && (
                      <td
                        className={`px-3 py-2 text-right font-extrabold tabular-nums tracking-tight-2 text-ink ${
                          sortBy === "value" ? "bg-accent/10" : "bg-white"
                        }`}
                        title={
                          r.cardsWithMarket > 0
                            ? `${r.cardsWithMarket} of ${r.totalCards} cards priced`
                            : "no market data"
                        }
                      >
                        {r.cardsWithMarket > 0 ? (
                          <>
                            <div className="leading-tight">
                              {formatUsd(r.totalMarketCents)}
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
            <tr className="border-t-2 border-ink text-[11px] font-bold uppercase tracking-tight-2 text-slate-700">
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
                className={`px-3 py-2 text-right tabular-nums text-white ${
                  sortBy === "score" ? "bg-accent" : "bg-ink"
                }`}
              >
                {grandTotalScore}
              </td>
              {anyMarketData && (
                <td
                  className={`px-3 py-2 text-right tabular-nums text-white ${
                    sortBy === "value" ? "bg-accent" : "bg-ink"
                  }`}
                >
                  {formatUsd(grandTotalMarket)}
                </td>
              )}
            </tr>
          </tfoot>
        </table>
      </div>
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
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="text-[10px] font-bold uppercase tracking-tight-2 text-slate-500">
            <th className="px-2 py-1.5 text-left">Player</th>
            {buckets.map((b) => (
              <th key={b.label} className="px-2 py-1.5 text-left">
                {b.label}
              </th>
            ))}
            <th className="px-2 py-1.5 text-right">Score</th>
          </tr>
        </thead>
        <tbody>
          {players.map((p) => (
            <tr key={p.playerName} className="border-t border-slate-200">
              <td className="px-2 py-1.5 font-semibold tracking-tight-2 text-slate-800">
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
              <td className="px-2 py-1.5 text-right font-extrabold tabular-nums text-ink">
                {p.totalScore}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
