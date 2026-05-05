"use client";

import { useState } from "react";
import type { Format } from "./shared";
import { statsFor } from "./shared";

/** Option B — tab strip with red underline (matches Score Card's
 *  active-sort highlight). Horizontal scroll on mobile. */
export default function OptionB({ formats }: { formats: Format[] }) {
  const [id, setId] = useState(formats[0]?.id ?? "");
  const current = formats.find((f) => f.id === id) ?? formats[0];
  const stats = statsFor(current);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <span className="text-[10px] font-bold uppercase tracking-tight-2 text-accent">
        Box format
      </span>
      <div className="mt-2 -mx-4 overflow-x-auto px-4">
        <div className="flex border-b border-slate-200">
          {formats.map((f) => {
            const active = f.id === current.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setId(f.id)}
                className={`-mb-px shrink-0 border-b-2 px-4 py-2 text-xs font-bold uppercase tracking-tight-2 transition ${
                  active
                    ? "border-accent text-ink"
                    : "border-transparent text-slate-500 hover:text-ink"
                }`}
              >
                {f.name}
              </button>
            );
          })}
        </div>
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
