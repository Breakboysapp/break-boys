"use client";

/**
 * Compact format selector for the product page. One native <select>
 * dropdown lists every format the product comes in (pre-seeded by
 * scripts/seed-all-product-formats.ts based on the product name).
 * Selecting one swaps the small detail line + notes below.
 *
 * Native <select> is intentional — gets the system picker on mobile
 * (much better UX than a custom dropdown), zero JS overhead, fully
 * accessible. Whole thing collapses into ~3 vertical lines instead
 * of the 5-card grid the previous editor took.
 *
 * No edit affordance here. Format data is treated as canonical from
 * the seed; if a format needs to change, it changes in the source
 * map (src/lib/product-formats-defaults.ts) and a re-seed updates
 * every affected product.
 */
import { useState } from "react";

type Format = {
  id: string;
  name: string;
  packsPerBox: number | null;
  cardsPerPack: number | null;
  autosPerBox: number | null;
  notes: string | null;
};

export default function ProductFormatsBar({
  formats,
}: {
  formats: Format[];
}) {
  const [selectedId, setSelectedId] = useState(formats[0]?.id ?? "");
  if (formats.length === 0) return null;

  const current =
    formats.find((f) => f.id === selectedId) ?? formats[0];

  // Tiny inline summary — only renders the parts that have data.
  const stats: string[] = [];
  if (current.packsPerBox != null && current.cardsPerPack != null) {
    stats.push(
      `${current.packsPerBox} × ${current.cardsPerPack} = ${current.packsPerBox * current.cardsPerPack} cards/box`,
    );
  } else if (current.packsPerBox != null) {
    stats.push(`${current.packsPerBox} packs/box`);
  } else if (current.cardsPerPack != null) {
    stats.push(`${current.cardsPerPack} cards/pack`);
  }
  if (current.autosPerBox != null) {
    stats.push(`${current.autosPerBox} autos/box`);
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-3">
        <label className="shrink-0 text-[10px] font-bold uppercase tracking-tight-2 text-accent">
          Box format
        </label>
        <select
          value={current.id}
          onChange={(e) => setSelectedId(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-bold text-ink focus:border-ink focus:outline-none"
        >
          {formats.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </div>

      {stats.length > 0 && (
        <div className="mt-2 text-xs tabular-nums text-slate-600">
          {stats.join("  ·  ")}
        </div>
      )}

      {current.notes && (
        <p className="mt-2 text-xs leading-snug text-slate-500">
          {current.notes}
        </p>
      )}
    </section>
  );
}
