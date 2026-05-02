"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export type FacetSpec = {
  /** Display label, e.g. "Year" */
  label: string;
  /** URL search-param key, e.g. "year" */
  paramKey: string;
  /** Sorted list of options to render as chips */
  values: string[];
  /** Currently-selected value (or null for "All") */
  selected: string | null;
};

/**
 * Generic search bar + chip filters that drive URL search params.
 * Used on the products list and the release calendar — anywhere we want
 * the same Fanatics-styled facet UI.
 */
export default function SearchFilters({
  basePath,
  searchKey = "q",
  searchPlaceholder = "Search…",
  initialQuery = "",
  facets,
}: {
  basePath: string;
  searchKey?: string;
  searchPlaceholder?: string;
  initialQuery?: string;
  facets: FacetSpec[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [q, setQ] = useState(initialQuery);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      const next = new URLSearchParams(searchParams.toString());
      if (q.trim()) next.set(searchKey, q.trim());
      else next.delete(searchKey);
      const qs = next.toString();
      // scroll: false — filter changes update the in-place result list;
      // jumping the user back to the top each keystroke is jarring.
      router.replace(qs ? `${basePath}?${qs}` : basePath, { scroll: false });
    }, 200);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const activeCount =
    (initialQuery ? 1 : 0) + facets.filter((f) => f.selected).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[260px]">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full rounded-md border border-slate-300 bg-white py-3 pl-10 pr-4 text-sm font-medium placeholder:text-slate-400 focus:border-ink focus:outline-none"
          />
        </div>
        {activeCount > 0 && (
          <Link
            href={basePath}
            scroll={false}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-[11px] font-bold uppercase tracking-tight-2 text-slate-600 hover:border-ink"
          >
            Clear all
          </Link>
        )}
      </div>

      {facets.map((facet) => (
        <ChipRow
          key={facet.paramKey}
          basePath={basePath}
          facet={facet}
        />
      ))}
    </div>
  );
}

function ChipRow({
  basePath,
  facet,
}: {
  basePath: string;
  facet: FacetSpec;
}) {
  const searchParams = useSearchParams();
  if (facet.values.length === 0) return null;

  const buildHref = (value: string | null) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(facet.paramKey, value);
    else next.delete(facet.paramKey);
    const qs = next.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-24 shrink-0 text-[11px] font-bold uppercase tracking-tight-2 text-slate-500">
        {facet.label}
      </span>
      <Link
        href={buildHref(null)}
        scroll={false}
        className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
          facet.selected === null
            ? "border-ink bg-ink text-white"
            : "border-slate-200 bg-white text-slate-600 hover:border-ink"
        }`}
      >
        All
      </Link>
      {facet.values.map((v) => (
        <Link
          key={v}
          href={buildHref(v)}
          scroll={false}
          className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
            facet.selected === v
              ? "border-ink bg-ink text-white"
              : "border-slate-200 bg-white text-slate-600 hover:border-ink"
          }`}
        >
          {v}
        </Link>
      ))}
    </div>
  );
}

