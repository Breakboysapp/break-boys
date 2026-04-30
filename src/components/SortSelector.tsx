"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, useRef, useEffect } from "react";

export type SortOption = {
  value: string;
  label: string;
};

export default function SortSelector({
  basePath,
  paramKey = "sort",
  options,
  selected,
}: {
  basePath: string;
  paramKey?: string;
  options: SortOption[];
  selected: string;
}) {
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  function buildHref(value: string): string {
    const next = new URLSearchParams(searchParams.toString());
    next.set(paramKey, value);
    const qs = next.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  const current = options.find((o) => o.value === selected) ?? options[0];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-[11px] font-bold uppercase tracking-tight-2 text-ink hover:border-ink"
      >
        <span className="text-slate-500">Sort:</span>
        <span>{current.label}</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className={`h-3 w-3 transition ${open ? "rotate-180" : ""}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-56 overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg">
          {options.map((o) => {
            const isOn = o.value === selected;
            return (
              <Link
                key={o.value}
                href={buildHref(o.value)}
                onClick={() => setOpen(false)}
                className={`block px-3 py-2 text-sm ${
                  isOn ? "bg-ink text-white" : "text-slate-700 hover:bg-bone"
                }`}
              >
                {o.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
