"use client";

import { useMemo, useState } from "react";

export type SleeperRow = {
  rank: number;
  playerName: string;
  normalizedName: string;
  position: string | null;
  org: string | null;
  level: string | null;
  age: number | null;
  source: string;
  capturedAt: Date | string | null;
  quality: number;
  market: number | null;
  sleeper: number | null;
  pricedCardCount: number;
};

type SortKey = "sleeper" | "rank" | "quality" | "market" | "name";

const POSITION_GROUPS: Array<{ label: string; matches: RegExp | null }> = [
  { label: "All", matches: null },
  { label: "Hitters", matches: /^(C|1B|2B|3B|SS|LF|CF|RF|OF|DH|UTL|INF|IF)$/i },
  { label: "Pitchers", matches: /^(RHP|LHP|SP|RP|P)$/i },
];

export default function SleeperTable({ rows }: { rows: SleeperRow[] }) {
  const [sort, setSort] = useState<SortKey>("sleeper");
  const [query, setQuery] = useState("");
  const [positionGroup, setPositionGroup] = useState<string>("All");
  const [hideNoMarket, setHideNoMarket] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const grp = POSITION_GROUPS.find((g) => g.label === positionGroup);
    return rows.filter((r) => {
      if (q && !r.playerName.toLowerCase().includes(q)) return false;
      if (grp?.matches && (!r.position || !grp.matches.test(r.position))) {
        return false;
      }
      if (hideNoMarket && r.market == null) return false;
      return true;
    });
  }, [rows, query, positionGroup, hideNoMarket]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      switch (sort) {
        case "sleeper": {
          const av = a.sleeper ?? -Infinity;
          const bv = b.sleeper ?? -Infinity;
          if (av !== bv) return bv - av;
          return a.rank - b.rank;
        }
        case "rank":
          return a.rank - b.rank;
        case "quality":
          return b.quality - a.quality;
        case "market": {
          const av = a.market ?? -1;
          const bv = b.market ?? -1;
          if (av !== bv) return bv - av;
          return a.rank - b.rank;
        }
        case "name":
          return a.playerName.localeCompare(b.playerName);
        default:
          return 0;
      }
    });
    return arr;
  }, [filtered, sort]);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-tight-2 text-slate-500">
            Search
          </span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Roki…"
            className="mt-0.5 block w-56 rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-ink focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-tight-2 text-slate-500">
            Position
          </span>
          <select
            value={positionGroup}
            onChange={(e) => setPositionGroup(e.target.value)}
            className="mt-0.5 block rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-ink focus:outline-none"
          >
            {POSITION_GROUPS.map((g) => (
              <option key={g.label} value={g.label}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 self-end pb-1 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={hideNoMarket}
            onChange={(e) => setHideNoMarket(e.target.checked)}
            className="h-4 w-4"
          />
          Has card market only
        </label>
        <div className="ml-auto text-[11px] text-slate-500">
          {sorted.length.toLocaleString()} prospect
          {sorted.length === 1 ? "" : "s"}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-ink text-white">
              <tr>
                <HeaderCell current={sort} k="rank" onClick={setSort} align="left">
                  Rank
                </HeaderCell>
                <HeaderCell current={sort} k="name" onClick={setSort} align="left">
                  Player
                </HeaderCell>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-tight-2">
                  Pos
                </th>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-tight-2">
                  Org
                </th>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-tight-2">
                  Age / Lvl
                </th>
                <HeaderCell current={sort} k="quality" onClick={setSort}>
                  Quality
                </HeaderCell>
                <HeaderCell current={sort} k="market" onClick={setSort}>
                  Market
                </HeaderCell>
                <HeaderCell current={sort} k="sleeper" onClick={setSort}>
                  Sleeper
                </HeaderCell>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-8 text-center text-xs text-slate-400"
                  >
                    No prospects match these filters. Try clearing the
                    search or position chip.
                  </td>
                </tr>
              ) : (
                sorted.map((r) => (
                  <tr
                    key={`${r.source}-${r.normalizedName}`}
                    className="[&>td]:border-b [&>td]:border-slate-100 hover:bg-bone/40"
                  >
                    <td className="px-3 py-2 text-xs tabular-nums text-slate-500">
                      #{r.rank}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-semibold tracking-tight-2 text-slate-800">
                        {r.playerName}
                      </div>
                      {r.pricedCardCount > 0 && (
                        <div className="text-[10px] text-slate-400">
                          {r.pricedCardCount} priced card
                          {r.pricedCardCount === 1 ? "" : "s"} in DB
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {r.position ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {r.org ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {[r.age, r.level].filter(Boolean).join(" / ") || "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <span className="font-bold text-ink">{r.quality}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                      {r.market != null ? (
                        <span className="font-bold text-ink">{r.market}</span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td
                      className="px-3 py-2 text-right tabular-nums"
                      title={
                        r.sleeper != null
                          ? `Quality ${r.quality} ÷ Market ${r.market}`
                          : "No card market yet — Sleeper Score not computable"
                      }
                    >
                      {r.sleeper != null ? (
                        <span
                          className={
                            r.sleeper >= 3
                              ? "font-extrabold text-emerald-600"
                              : r.sleeper >= 1.5
                                ? "font-bold text-ink"
                                : "font-bold text-slate-400"
                          }
                        >
                          {r.sleeper.toFixed(1)}
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                ))
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
