"use client";

import { useEffect, useRef, useState } from "react";
import type { Format } from "./shared";
import { statsFor } from "./shared";

/** Option D — custom dropdown trigger. Same pattern as Sort / Year /
 *  Manufacturer dropdowns, scoped to format selection. Fully
 *  collapsed when not interacting; click to expand the menu. */
export default function OptionD({ formats }: { formats: Format[] }) {
  const [id, setId] = useState(formats[0]?.id ?? "");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = formats.find((f) => f.id === id) ?? formats[0];
  const stats = statsFor(current);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
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

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div ref={ref} className="relative">
        <span className="text-[10px] font-bold uppercase tracking-tight-2 text-accent">
          Box format
        </span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="mt-1 flex w-full items-center justify-between gap-2 rounded-md bg-ink px-3 py-2 text-sm font-bold uppercase tracking-tight-2 text-white hover:opacity-90"
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span>{current.name}</span>
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
            className="absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-auto rounded-md border border-slate-200 bg-white shadow-lg"
          >
            {formats.map((f) => {
              const active = f.id === current.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    setId(f.id);
                    setOpen(false);
                  }}
                  className={`block w-full px-3 py-2 text-left text-sm ${
                    active
                      ? "bg-ink text-white"
                      : "text-slate-700 hover:bg-bone"
                  }`}
                >
                  {f.name}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {(stats.length > 0 || current.notes) && (
        <div className="mt-3">
          {stats.length > 0 && (
            <div className="text-xs tabular-nums text-slate-700">
              {stats.join("  ·  ")}
            </div>
          )}
          {current.notes && (
            <p className="mt-1 text-xs leading-snug text-slate-500">
              {current.notes}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
