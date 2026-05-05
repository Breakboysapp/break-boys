"use client";

import { useState } from "react";
import type { Format } from "./shared";
import { statsFor } from "./shared";

/** Option C — inline mini cards (no separate details panel).
 *  Each format card shows its own name + stats; active card has
 *  red border + accent name. Notes for the active format land
 *  beneath the row. */
export default function OptionC({ formats }: { formats: Format[] }) {
  const [id, setId] = useState(formats[0]?.id ?? "");
  const current = formats.find((f) => f.id === id) ?? formats[0];

  return (
    <section className="space-y-3">
      <span className="text-[10px] font-bold uppercase tracking-tight-2 text-accent">
        Box format
      </span>
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {formats.map((f) => {
          const active = f.id === current.id;
          const stats = statsFor(f);
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setId(f.id)}
              className={`flex flex-col gap-1 rounded-lg border-2 bg-white p-3 text-left transition hover:border-ink ${
                active
                  ? "border-accent shadow-sm"
                  : "border-slate-200"
              }`}
            >
              <span
                className={`text-[11px] font-bold uppercase tracking-tight-2 ${
                  active ? "text-accent" : "text-ink"
                }`}
              >
                {f.name}
              </span>
              {stats.length > 0 ? (
                <span className="text-[10px] tabular-nums leading-tight text-slate-500">
                  {stats.map((s) => (
                    <div key={s}>{s}</div>
                  ))}
                </span>
              ) : (
                <span className="text-[10px] text-slate-300">—</span>
              )}
            </button>
          );
        })}
      </div>
      {current.notes && (
        <p className="rounded-lg border border-slate-200 bg-bone p-3 text-xs leading-snug text-slate-700">
          <span className="font-bold uppercase tracking-tight-2 text-accent">
            {current.name}:
          </span>{" "}
          {current.notes}
        </p>
      )}
    </section>
  );
}
