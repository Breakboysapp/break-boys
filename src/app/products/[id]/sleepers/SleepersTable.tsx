"use client";

import { useMemo, useState } from "react";

export type SleeperBoardRow = {
  playerName: string;
  normalizedName: string;
  cardCount: number;
  topPriceCents: number | null;
  medianPriceCents: number | null;
  market: number | null;
  matched: boolean;
  matchType: "exact" | "loose" | "prefix" | null;
  statStatus: "scored" | "below-sample" | "no-stats" | "unmatched";
  level: string | null;
  teamName: string | null;
  position: string | null;
  age: number | null;
  mlbPlayerId: number | null;
  pipelineRank: number | null;
  production: number | null;
  productionParts: Array<{ label: string; value: number }> | null;
  sleeper: number | null;
  statLine: string | null;
  statGroup: "hitting" | "pitching" | null;
  gamesPlayed: number | null;
};

type SortKey =
  | "sleeper"
  | "production"
  | "topPrice"
  | "medianPrice"
  | "market"
  | "cardCount"
  | "name"
  | "rank";

type View =
  | "all"
  | "sleepers"
  | "unranked"
  | "ranked"
  | "thin"
  | "unmatched";
type GroupFilter = "all" | "batters" | "pitchers";

// Position regex used to classify a row when we don't have a stat
// line yet to confirm group. UTL/INF/IF/OF fall into the hitter
// bucket; SP/RP/P/TWP into the pitcher bucket.
const HITTER_POS = /^(C|1B|2B|3B|SS|LF|CF|RF|OF|DH|UTL|INF|IF)$/i;
const PITCHER_POS = /^(RHP|LHP|SP|RP|P|TWP)$/i;

const GROUP_TABS: Array<{
  key: GroupFilter;
  label: string;
  filter: (r: SleeperBoardRow) => boolean;
}> = [
  { key: "all", label: "Both", filter: () => true },
  {
    key: "batters",
    label: "Batters",
    filter: (r) =>
      r.statGroup === "hitting" ||
      (r.statGroup == null && !!r.position && HITTER_POS.test(r.position)),
  },
  {
    key: "pitchers",
    label: "Pitchers",
    filter: (r) =>
      r.statGroup === "pitching" ||
      (r.statGroup == null && !!r.position && PITCHER_POS.test(r.position)),
  },
];

const LEVEL_GROUPS: Array<{ label: string; matches: string[] | null }> = [
  { label: "All levels", matches: null },
  { label: "MLB", matches: ["MLB"] },
  { label: "AAA / AA", matches: ["AAA", "AA"] },
  { label: "A+ / A", matches: ["A+", "A"] },
  { label: "ROK / DSL", matches: ["ROK", "DSL"] },
];

const VIEW_TABS: Array<{
  key: View;
  label: string;
  filter: (r: SleeperBoardRow) => boolean;
  defaultSort: SortKey;
}> = [
  { key: "all", label: "All", filter: () => true, defaultSort: "sleeper" },
  {
    // The headline view — what you came here to find. Production-driven
    // sleepers = playing well at level but card market hasn't priced
    // them in. Tuned floors: ≥65 production, ≤40 market, real market
    // exists (so we exclude "no priced cards = artificially infinite
    // sleeper score").
    key: "sleepers",
    label: "💎 Sleepers",
    filter: (r) =>
      r.production != null &&
      r.production >= 65 &&
      (r.market ?? 0) <= 40 &&
      (r.topPriceCents ?? 0) > 0,
    defaultSort: "sleeper",
  },
  {
    key: "unranked",
    label: "Unranked",
    filter: (r) =>
      r.pipelineRank == null && (r.topPriceCents ?? 0) > 0,
    defaultSort: "topPrice",
  },
  {
    key: "ranked",
    label: "Top 100",
    filter: (r) => r.pipelineRank != null,
    defaultSort: "rank",
  },
  {
    // Matched a roster (MLB or MiLB) but the season sample is still
    // too thin to score — distinct from "No roster" below, which is
    // the player we couldn't match at all. Lets the user tell "on a
    // roster, just early" from "we have nothing on him."
    key: "thin",
    label: "Thin sample",
    filter: (r) => r.statStatus === "below-sample",
    defaultSort: "topPrice",
  },
  {
    key: "unmatched",
    label: "No roster",
    filter: (r) => r.statStatus === "unmatched",
    defaultSort: "topPrice",
  },
];

function formatUsd(cents: number | null): string {
  if (cents == null || cents === 0) return "—";
  const dollars = cents / 100;
  if (dollars >= 1000) return `$${Math.round(dollars).toLocaleString()}`;
  return `$${dollars.toFixed(0)}`;
}

export default function SleepersTable({ rows }: { rows: SleeperBoardRow[] }) {
  const [view, setView] = useState<View>("all");
  const [group, setGroup] = useState<GroupFilter>("all");
  const [sort, setSort] = useState<SortKey>("sleeper");
  const [query, setQuery] = useState("");
  const [levelGroup, setLevelGroup] = useState<string>("All levels");
  const [pypRate, setPypRate] = useState<string>("");

  const activeTab = VIEW_TABS.find((t) => t.key === view) ?? VIEW_TABS[0];
  const activeGroup =
    GROUP_TABS.find((g) => g.key === group) ?? GROUP_TABS[0];
  const pypCents = (() => {
    const n = Number(pypRate);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.round(n * 100);
  })();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const lvlGrp = LEVEL_GROUPS.find((g) => g.label === levelGroup);
    return rows.filter((r) => {
      if (!activeTab.filter(r)) return false;
      if (!activeGroup.filter(r)) return false;
      if (q && !r.playerName.toLowerCase().includes(q)) return false;
      if (lvlGrp?.matches && (r.level == null || !lvlGrp.matches.includes(r.level))) {
        return false;
      }
      return true;
    });
  }, [rows, query, levelGroup, activeTab, activeGroup]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      switch (sort) {
        case "sleeper": {
          const av = a.sleeper ?? -Infinity;
          const bv = b.sleeper ?? -Infinity;
          if (av !== bv) return bv - av;
          return (b.topPriceCents ?? 0) - (a.topPriceCents ?? 0);
        }
        case "production": {
          const av = a.production ?? -Infinity;
          const bv = b.production ?? -Infinity;
          return bv - av;
        }
        case "topPrice":
          return (b.topPriceCents ?? 0) - (a.topPriceCents ?? 0);
        case "medianPrice":
          return (b.medianPriceCents ?? 0) - (a.medianPriceCents ?? 0);
        case "market":
          return (b.market ?? 0) - (a.market ?? 0);
        case "cardCount":
          return b.cardCount - a.cardCount;
        case "rank": {
          const ar = a.pipelineRank ?? Infinity;
          const br = b.pipelineRank ?? Infinity;
          return ar - br;
        }
        case "name":
          return a.playerName.localeCompare(b.playerName);
        default:
          return 0;
      }
    });
    return arr;
  }, [filtered, sort]);

  function switchView(v: View) {
    setView(v);
    const tab = VIEW_TABS.find((t) => t.key === v);
    if (tab) setSort(tab.defaultSort);
  }

  return (
    <section className="space-y-3">
      {/* View tabs (All / 💎 Sleepers / Unranked / Top 100 / No roster).
          Counts reflect both the view filter AND the active group, so
          switching to Pitchers makes "💎 Sleepers" mean "💎 pitcher
          sleepers." */}
      <div className="flex flex-wrap gap-2">
        {VIEW_TABS.map((tab) => {
          const count = rows.filter(
            (r) => tab.filter(r) && activeGroup.filter(r),
          ).length;
          const active = tab.key === view;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => switchView(tab.key)}
              className={`rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-tight-2 ${
                active
                  ? "bg-ink text-white"
                  : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
              }`}
            >
              {tab.label}
              <span
                className={`ml-1.5 inline-block tabular-nums ${
                  active ? "text-white/70" : "text-slate-400"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Group tabs (Both / Batters / Pitchers). Stacked under the
          view tabs because mixing them in one row gets unwieldy on
          mobile and the dimensions are conceptually distinct: the
          view tabs filter "what kind of opportunity," the group tabs
          filter "what kind of player." */}
      <div className="flex flex-wrap gap-2">
        {GROUP_TABS.map((tab) => {
          const count = rows.filter(
            (r) => tab.filter(r) && activeTab.filter(r),
          ).length;
          const active = tab.key === group;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setGroup(tab.key)}
              className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-tight-2 ${
                active
                  ? "bg-accent text-white"
                  : "bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50"
              }`}
            >
              {tab.label}
              <span
                className={`ml-1.5 inline-block tabular-nums ${
                  active ? "text-white/70" : "text-slate-400"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-tight-2 text-slate-500">
            Search
          </span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Made…"
            className="mt-0.5 block w-56 rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-ink focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-tight-2 text-slate-500">
            Level
          </span>
          <select
            value={levelGroup}
            onChange={(e) => setLevelGroup(e.target.value)}
            className="mt-0.5 block rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-ink focus:outline-none"
          >
            {LEVEL_GROUPS.map((g) => (
              <option key={g.label} value={g.label}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-tight-2 text-slate-500">
            PYP rate ($/slot)
          </span>
          <input
            type="number"
            value={pypRate}
            onChange={(e) => setPypRate(e.target.value)}
            placeholder="40"
            min={0}
            step={1}
            className="mt-0.5 block w-28 rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-ink focus:outline-none"
          />
        </label>
        <div className="ml-auto text-[11px] text-slate-500">
          {sorted.length.toLocaleString()} player
          {sorted.length === 1 ? "" : "s"}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-ink text-white">
              <tr>
                <HeaderCell current={sort} k="name" onClick={setSort} align="left">
                  Player
                </HeaderCell>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-tight-2">
                  Pos
                </th>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-tight-2">
                  Level · Team
                </th>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-tight-2">
                  Stat line
                </th>
                <HeaderCell current={sort} k="rank" onClick={setSort} align="left">
                  Pipeline
                </HeaderCell>
                <HeaderCell current={sort} k="topPrice" onClick={setSort}>
                  Top
                </HeaderCell>
                <HeaderCell current={sort} k="market" onClick={setSort}>
                  Market
                </HeaderCell>
                <HeaderCell current={sort} k="production" onClick={setSort}>
                  Prod
                </HeaderCell>
                <HeaderCell current={sort} k="sleeper" onClick={setSort}>
                  Sleeper
                </HeaderCell>
                {pypCents != null && (
                  <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-tight-2">
                    vs ${pypRate}
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td
                    colSpan={pypCents != null ? 10 : 9}
                    className="px-4 py-8 text-center text-xs text-slate-400"
                  >
                    No players match these filters. Try the All tab or
                    clear search.
                  </td>
                </tr>
              ) : (
                sorted.map((r) => {
                  const vsPyp =
                    pypCents != null && r.topPriceCents != null
                      ? r.topPriceCents - pypCents
                      : null;
                  return (
                    <tr
                      key={r.normalizedName}
                      className="[&>td]:border-b [&>td]:border-slate-100 hover:bg-bone/40"
                    >
                      <td className="px-3 py-2">
                        <div className="font-semibold tracking-tight-2 text-slate-800">
                          {r.playerName}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {r.position ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {r.matched ? (
                          <div>
                            <div className="text-slate-700">
                              <span className="font-bold">{r.level}</span>
                              {r.teamName ? (
                                <span className="text-slate-500">
                                  {" "}
                                  · {r.teamName}
                                </span>
                              ) : null}
                              {r.matchType && r.matchType !== "exact" && (
                                <span
                                  className="ml-1 text-[10px] font-bold text-amber-500"
                                  title={`Fuzzy roster match (${r.matchType}) — name spelling differs from MLB's. Verify it's the right player.`}
                                >
                                  ≈
                                </span>
                              )}
                            </div>
                            {r.age != null && (
                              <div className="text-[10px] text-slate-400">
                                age {r.age}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-300">no roster match</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {r.statLine ? (
                          <div>
                            <div className="font-semibold tabular-nums text-slate-700">
                              {r.statLine}
                            </div>
                            <div className="text-[10px] text-slate-400">
                              {r.gamesPlayed ?? "—"}{" "}
                              {r.statGroup === "pitching" ? "G" : "GP"}
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {r.pipelineRank != null ? (
                          <span className="font-bold tabular-nums text-ink">
                            #{r.pipelineRank}
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-sm tabular-nums font-bold text-ink">
                        {formatUsd(r.topPriceCents)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.market != null ? (
                          <span className="text-xs font-bold text-ink">
                            {r.market}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-300">—</span>
                        )}
                      </td>
                      <td
                        className="px-3 py-2 text-right tabular-nums"
                        title={
                          r.productionParts
                            ? r.productionParts
                                .map(
                                  (p) =>
                                    `${p.label}: ${p.value >= 0 ? "+" : ""}${p.value}`,
                                )
                                .join("\n") + `\n= ${r.production}`
                            : r.statStatus === "below-sample"
                              ? "Matched a roster and has a stat line, but the season sample is below the threshold to score (75 PA hitter / 15 IP pitcher)."
                              : r.statStatus === "no-stats"
                                ? "On a roster, but no season stat line yet."
                                : r.statStatus === "unmatched"
                                  ? "No roster match — couldn't tie this name to an MLB/MiLB player."
                                  : undefined
                        }
                      >
                        {r.production != null ? (
                          <span
                            className={
                              r.production >= 75
                                ? "text-sm font-extrabold text-emerald-600"
                                : r.production >= 50
                                  ? "text-sm font-bold text-ink"
                                  : "text-sm font-bold text-slate-400"
                            }
                          >
                            {r.production}
                          </span>
                        ) : r.statStatus === "below-sample" ? (
                          <span className="text-[10px] font-bold uppercase tracking-tight-2 text-amber-500">
                            thin
                          </span>
                        ) : (
                          <span className="text-xs text-slate-300">—</span>
                        )}
                      </td>
                      <td
                        className="px-3 py-2 text-right tabular-nums"
                        title={
                          r.sleeper != null
                            ? `Production ${r.production} ÷ Market ${r.market}`
                            : "Need both production and market signal"
                        }
                      >
                        {r.sleeper != null ? (
                          <span
                            className={
                              r.sleeper >= 2
                                ? "text-sm font-extrabold text-emerald-600"
                                : r.sleeper >= 1
                                  ? "text-sm font-bold text-ink"
                                  : "text-sm font-bold text-slate-400"
                            }
                          >
                            {r.sleeper.toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-300">—</span>
                        )}
                      </td>
                      {pypCents != null && (
                        <td className="px-3 py-2 text-right tabular-nums">
                          {vsPyp == null ? (
                            <span className="text-xs text-slate-300">—</span>
                          ) : vsPyp > 0 ? (
                            <span
                              className="text-xs font-extrabold text-emerald-600"
                              title="Top auto > PYP rate"
                            >
                              +{formatUsd(vsPyp)}
                            </span>
                          ) : (
                            <span
                              className="text-xs font-bold text-rose-600"
                              title="Top auto < PYP rate"
                            >
                              {formatUsd(vsPyp)}
                            </span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function HeaderCell({
  current,
  k,
  onClick,
  children,
  align,
}: {
  current: SortKey;
  k: SortKey;
  onClick: (k: SortKey) => void;
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  const active = current === k;
  return (
    <th
      className={`px-3 py-2 text-[10px] font-bold uppercase tracking-tight-2 ${
        align === "left" ? "text-left" : "text-right"
      } ${active ? "bg-accent" : "bg-ink"}`}
    >
      <button
        type="button"
        onClick={() => onClick(k)}
        className="inline-flex items-center gap-1 hover:opacity-80"
      >
        <span>{children}</span>
        {active && <span aria-hidden>↓</span>}
      </button>
    </th>
  );
}
