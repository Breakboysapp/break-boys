"use client";

/**
 * Single-facet dropdown selector — same surface as SortSelector but
 * driven by a FacetSpec (label, paramKey, values, selected). Used in
 * SearchFilters when a facet has too many values to fit nicely as
 * inline chips (Year, Manufacturer).
 *
 * Click outside / Escape closes. Each option is a Next.js Link with
 * scroll={false}, so picking a value updates the URL and re-renders
 * the catalog without jumping the user back to the top.
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

export default function FacetDropdown({
  basePath,
  label,
  paramKey,
  values,
  selected,
}: {
  basePath: string;
  label: string;
  paramKey: string;
  values: string[];
  selected: string | null;
}) {
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Click-outside + Escape to close.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function buildHref(value: string | null): string {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(paramKey, value);
    else next.delete(paramKey);
    const qs = next.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  if (values.length === 0) return null;

  return (
    <div ref={ref} className="relative">
      <span className="sr-only">{label} filter</span>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-2 rounded-md border px-3 py-2 text-[11px] font-bold uppercase tracking-tight-2 transition ${
          selected
            ? "border-ink bg-ink text-white"
            : "border-slate-300 bg-white text-ink hover:border-ink"
        }`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={selected ? "text-white/60" : "text-slate-500"}>
          {label}:
        </span>
        <span>{selected ?? "All"}</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className={`h-3 w-3 transition ${open ? "rotate-180" : ""}`}
          aria-hidden
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={label}
          className="absolute right-0 z-30 mt-1 max-h-72 w-44 overflow-auto rounded-md border border-slate-200 bg-white shadow-lg"
        >
          <Link
            href={buildHref(null)}
            scroll={false}
            onClick={() => setOpen(false)}
            className={`block px-3 py-2 text-sm ${
              selected === null
                ? "bg-ink text-white"
                : "text-slate-700 hover:bg-bone"
            }`}
          >
            All
          </Link>
          {values.map((v) => (
            <Link
              key={v}
              href={buildHref(v)}
              scroll={false}
              onClick={() => setOpen(false)}
              className={`block px-3 py-2 text-sm ${
                selected === v
                  ? "bg-ink text-white"
                  : "text-slate-700 hover:bg-bone"
              }`}
            >
              {v}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
