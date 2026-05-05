"use client";

/**
 * Box-format selector — pill row + stats strip (Option A from
 * /mock-format-selector review).
 *
 * Each format is a small clickable pill (Hobby / Jumbo / Mega Box /
 * etc); the active one is filled black, others are outline. Tapping
 * a pill swaps the inline stats line underneath. Pills wrap to a
 * second line on narrow screens so even products with 5-6 formats
 * fit without horizontal scroll.
 *
 * Notes (per-format exclusivity caveats stored in the DB) are
 * intentionally NOT rendered — the user wants the bar visually
 * minimal, just the pill row + the stats line. Notes still live on
 * the row in case we want to surface them elsewhere later.
 *
 * Pattern matches the Active / Coming Soon tab pills already on the
 * home page — same visual language, same interaction model.
 */
import { useState } from "react";

type Format = {
  id: string;
  name: string;
  packsPerBox: number | null;
  cardsPerPack: number | null;
  autosPerBox: number | null;
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

  // Build a one-line summary from whichever fields are populated.
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
              onClick={() => setSelectedId(f.id)}
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
      {stats.length > 0 && (
        <div className="mt-3 border-t border-slate-100 pt-3 text-xs tabular-nums text-slate-700">
          {stats.join("  ·  ")}
        </div>
      )}
    </section>
  );
}
