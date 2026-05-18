"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export type GemRateRow = {
  productId: string;
  name: string;
  sport: string;
  manufacturer: string | null;
  releaseDate: Date | null;
  cardsWithPop: number;
  totalCards: number;
  popG10: number;
  popTotal: number;
};

type SortKey =
  | "gemRate"
  | "name"
  | "popTotal"
  | "popG10"
  | "coverage"
  | "releaseDate";

const MIN_SAMPLES = [
  { label: "≥ 100", value: 100 },
  { label: "≥ 500", value: 500 },
  { label: "≥ 1,000", value: 1000 },
  { label: "No min", value: 0 },
];

const SPORT_LABEL: Record<string, string> = {
  MLB: "Baseball",
  NBA: "Basketball",
  NFL: "Football",
  NHL: "Hockey",
};

export default function GemRateTable({ rows }: { rows: GemRateRow[] }) {
  const [sort, setSort] = useState<SortKey>("gemRate");
  const [minSample, setMinSample] = useState(100);
  const [sport, setSport] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // Sport list derived from input — no hard-coding, so soccer / golf
  // / TCG appear when products in those sports have pop data.
  const sportOptions = useMemo(() => {
    const set = new Set(rows.map((r) => r.sport));
    return [...set].sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (r.popTotal < minSample) return false;
      if (sport && r.sport !== sport) return false;
      if (q && !r.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, minSample, sport, query]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const gemRate = (r: GemRateRow) =>
      r.popTotal > 0 ? r.popG10 / r.popTotal : 0;
    const coverage = (r: GemRateRow) =>
      r.totalCards > 0 ? r.cardsWithPop / r.totalCards : 0;
    arr.sort((a, b) => {
      switch (sort) {
        case "gemRate":
          return gemRate(b) - gemRate(a);
        case "popTotal":
          return b.popTotal - a.popTotal;
        case "popG10":
          return b.popG10 - a.popG10;
        case "coverage":
          return coverage(b) - coverage(a);
        case "releaseDate": {
          const ad = a.releaseDate?.getTime() ?? 0;
          const bd = b.releaseDate?.getTime() ?? 0;
          return bd - ad;
        }
        case "name":
          return a.name.localeCompare(b.name);
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
            placeholder="2025 Topps Chrome…"
            className="mt-0.5 block w-64 rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-ink focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-tight-2 text-slate-500">
            Sport
          </span>
          <select
            value={sport ?? ""}
            onChange={(e) => setSport(e.target.value || null)}
            className="mt-0.5 block rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-ink focus:outline-none"
          >
            <option value="">All</option>
            {sportOptions.map((s) => (
              <option key={s} value={s}>
                {SPORT_LABEL[s] ?? s}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-tight-2 text-slate-500">
            Min sample
          </span>
          <select
            value={minSample}
            onChange={(e) => setMinSample(Number(e.target.value))}
            className="mt-0.5 block rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-ink focus:outline-none"
          >
            {MIN_SAMPLES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <div className="ml-auto text-[11px] text-slate-500">
          {sorted.length.toLocaleString()} product
          {sorted.length === 1 ? "" : "s"}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-ink text-white">
              <tr>
                <HeaderCell
                  current={sort}
                  k="name"
                  onClick={setSort}
                  align="left"
                >
                  Product
                </HeaderCell>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-tight-2">
                  Sport
                </th>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-tight-2">
                  Mfr
                </th>
                <HeaderCell
                  current={sort}
                  k="releaseDate"
                  onClick={setSort}
                  align="left"
                >
                  Released
                </HeaderCell>
                <HeaderCell current={sort} k="popTotal" onClick={setSort}>
                  Graded
                </HeaderCell>
                <HeaderCell current={sort} k="popG10" onClick={setSort}>
                  PSA 10
                </HeaderCell>
                <HeaderCell current={sort} k="gemRate" onClick={setSort}>
                  Gem rate
                </HeaderCell>
                <HeaderCell
                  current={sort}
                  k="coverage"
                  onClick={setSort}
                  title="Cards in the product with any pop data ÷ total cards in the product. Higher = more representative gem-rate number."
                >
                  Coverage
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
                    No products match these filters. Try lowering the
                    min-sample threshold or clearing the search.
                  </td>
                </tr>
              ) : (
                sorted.map((r) => {
                  const gemRate =
                    r.popTotal > 0 ? r.popG10 / r.popTotal : 0;
                  const coverage =
                    r.totalCards > 0 ? r.cardsWithPop / r.totalCards : 0;
                  return (
                    <tr
                      key={r.productId}
                      className="[&>td]:border-b [&>td]:border-slate-100 hover:bg-bone/40"
                    >
                      <td className="px-3 py-2">
                        <Link
                          href={`/products/${r.productId}`}
                          className="font-semibold tracking-tight-2 text-slate-800 hover:text-accent"
                        >
                          {r.name}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {SPORT_LABEL[r.sport] ?? r.sport}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {r.manufacturer ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {r.releaseDate
                          ? r.releaseDate.toISOString().slice(0, 10)
                          : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.popTotal.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.popG10.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <span className="font-extrabold text-ink">
                          {(gemRate * 100).toFixed(1)}%
                        </span>
                      </td>
                      <td
                        className="px-3 py-2 text-right tabular-nums text-xs text-slate-500"
                        title={`${r.cardsWithPop.toLocaleString()} of ${r.totalCards.toLocaleString()} cards have pop data`}
                      >
                        {(coverage * 100).toFixed(0)}%
                      </td>
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
  title,
}: {
  current: SortKey;
  k: SortKey;
  onClick: (k: SortKey) => void;
  children: React.ReactNode;
  align?: "left" | "right";
  title?: string;
}) {
  const active = current === k;
  return (
    <th
      className={`px-3 py-2 text-[10px] font-bold uppercase tracking-tight-2 ${
        align === "left" ? "text-left" : "text-right"
      } ${active ? "bg-accent" : "bg-ink"}`}
      title={title}
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
