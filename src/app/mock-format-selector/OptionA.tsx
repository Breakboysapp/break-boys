"use client";

import { useState } from "react";
import type { Format } from "./shared";
import { statsFor } from "./shared";

/** Option A — pill row + details strip below. */
export default function OptionA({ formats }: { formats: Format[] }) {
  const [id, setId] = useState(formats[0]?.id ?? "");
  const current = formats.find((f) => f.id === id) ?? formats[0];
  const stats = statsFor(current);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <span className="text-[10px] font-bold uppercase tracking-tight-2 text-accent">
        Box format
      </span>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {formats.map((f) => {
          const active = f.id === current.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setId(f.id)}
              className={`rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-tight-2 transition ${
                active
                  ? "border-ink bg-ink text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-ink"
              }`}
            >
              {f.name}
            </button>
          );
        })}
      </div>
      {(stats.length > 0 || current.notes) && (
        <div className="mt-3 border-t border-slate-100 pt-3">
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
