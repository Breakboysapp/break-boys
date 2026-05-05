"use client";

/**
 * Inline editor for a product's box formats (Hobby / Jumbo / Mega Box /
 * Super Jumbo / Breaker Delight / etc).
 *
 * Each format renders as a card with editable fields:
 *   - Name (top-line)
 *   - Box price
 *   - Packs per box
 *   - Cards per pack
 *   - Autos per box (allows fractional)
 *   - Notes (free-text — exclusives, odds caveats)
 *
 * Auto-saves on blur via PATCH. "+ Add format" appends a new row
 * (POST) which then becomes editable inline. Delete confirms once
 * via a two-stage button (matches the DeleteMixerButton pattern).
 *
 * No real auth yet, so anyone visiting the product page can edit —
 * fine for the single-user MVP. When auth lands the routes will
 * gate to admin or product-creator only.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

type Format = {
  id: string;
  name: string;
  packsPerBox: number | null;
  cardsPerPack: number | null;
  autosPerBox: number | null;
  notes: string | null;
  position: number;
};

const COMMON_FORMAT_SUGGESTIONS = [
  "Hobby",
  "Jumbo",
  "Super Jumbo",
  "Mega Box",
  "Breaker Delight",
  "Hanger Box",
  "Retail",
  "FOTL",
  "Choice Box",
];

export default function ProductFormatsEditor({
  productId,
  initialFormats,
}: {
  productId: string;
  initialFormats: Format[];
}) {
  const router = useRouter();
  const [formats, setFormats] = useState<Format[]>(initialFormats);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function addFormat() {
    const name = newName.trim();
    if (!name) return;
    setError(null);
    const res = await fetch(`/api/products/${productId}/formats`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Add failed");
      return;
    }
    const created = (await res.json()) as Format;
    setFormats((prev) => [...prev, created]);
    setNewName("");
    setAdding(false);
    router.refresh();
  }

  async function patchFormat(id: string, patch: Partial<Format>) {
    const res = await fetch(
      `/api/products/${productId}/formats/${id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      },
    );
    if (!res.ok) return;
    const updated = (await res.json()) as Format;
    setFormats((prev) => prev.map((f) => (f.id === id ? updated : f)));
    router.refresh();
  }

  async function deleteFormat(id: string) {
    await fetch(`/api/products/${productId}/formats/${id}`, {
      method: "DELETE",
    });
    setFormats((prev) => prev.filter((f) => f.id !== id));
    router.refresh();
  }

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-tight-2 text-accent">
            Box formats
          </div>
          <h2 className="mt-1 text-lg font-extrabold tracking-tight-3 sm:text-xl">
            Hobby, Jumbo, Mega &amp; more
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Each format has its own pack configuration and auto count.
            Add the variants this product comes in.
          </p>
        </div>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-md border border-ink bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-tight-2 text-ink hover:bg-ink hover:text-white"
          >
            + Add format
          </button>
        )}
      </div>

      {adding && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-bone p-3">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addFormat();
              if (e.key === "Escape") {
                setAdding(false);
                setNewName("");
                setError(null);
              }
            }}
            list="format-suggestions"
            placeholder="Format name (e.g. Hobby, Mega Box)"
            className="min-w-[180px] flex-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm focus:border-ink focus:outline-none"
          />
          <datalist id="format-suggestions">
            {COMMON_FORMAT_SUGGESTIONS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <button
            type="button"
            onClick={addFormat}
            disabled={!newName.trim()}
            className="rounded-md bg-ink px-3 py-1.5 text-[11px] font-bold uppercase tracking-tight-2 text-white hover:opacity-90 disabled:opacity-40"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setNewName("");
              setError(null);
            }}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-tight-2 text-slate-600 hover:border-ink"
          >
            Cancel
          </button>
          {error && (
            <p className="basis-full text-xs text-accent">{error}</p>
          )}
        </div>
      )}

      {formats.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
          No formats added yet. Tap{" "}
          <span className="font-semibold text-ink">+ Add format</span> to
          start (Hobby is the typical first one).
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {formats.map((f) => (
            <FormatCard
              key={f.id}
              format={f}
              onPatch={(patch) => patchFormat(f.id, patch)}
              onDelete={() => deleteFormat(f.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function FormatCard({
  format,
  onPatch,
  onDelete,
}: {
  format: Format;
  onPatch: (patch: Partial<Format>) => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <input
          defaultValue={format.name}
          onBlur={(e) => {
            const v = e.currentTarget.value.trim();
            if (v && v !== format.name) onPatch({ name: v });
          }}
          className="min-w-0 flex-1 border-0 bg-transparent text-base font-bold tracking-tight-2 text-ink focus:outline-none focus:ring-0"
        />
        <button
          type="button"
          onClick={() => {
            if (!confirming) {
              setConfirming(true);
              setTimeout(() => setConfirming(false), 4000);
              return;
            }
            onDelete();
          }}
          className={`shrink-0 rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-tight-2 transition ${
            confirming
              ? "bg-accent text-white"
              : "border border-slate-200 bg-white text-slate-400 hover:border-accent hover:text-accent"
          }`}
          aria-label="Delete format"
        >
          {confirming ? "Confirm ×" : "×"}
        </button>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-3">
        <Field
          label="Packs / box"
          defaultValue={format.packsPerBox?.toString() ?? ""}
          onCommit={(v) => {
            const n = v.trim() === "" ? null : parseInt(v, 10);
            if (n !== format.packsPerBox && (n == null || !Number.isNaN(n))) {
              onPatch({ packsPerBox: n });
            }
          }}
        />
        <Field
          label="Cards / pack"
          defaultValue={format.cardsPerPack?.toString() ?? ""}
          onCommit={(v) => {
            const n = v.trim() === "" ? null : parseInt(v, 10);
            if (n !== format.cardsPerPack && (n == null || !Number.isNaN(n))) {
              onPatch({ cardsPerPack: n });
            }
          }}
        />
        <Field
          label="Autos / box"
          defaultValue={format.autosPerBox?.toString() ?? ""}
          onCommit={(v) => {
            const n = v.trim() === "" ? null : Number(v);
            if (n !== format.autosPerBox && (n == null || !Number.isNaN(n))) {
              onPatch({ autosPerBox: n });
            }
          }}
        />
      </div>

      <label className="mt-3 block">
        <span className="text-[10px] font-bold uppercase tracking-tight-2 text-slate-500">
          Notes (exclusives, odds)
        </span>
        <textarea
          defaultValue={format.notes ?? ""}
          onBlur={(e) => {
            const v = e.currentTarget.value;
            const next = v.trim() === "" ? null : v;
            if (next !== format.notes) onPatch({ notes: next });
          }}
          rows={2}
          placeholder='e.g. "Mega-only Chrome Prospect Autos, Laser Refractors"'
          className="mt-1 w-full resize-none rounded-md border border-slate-200 bg-bone px-2 py-1.5 text-xs leading-snug text-ink focus:border-ink focus:bg-white focus:outline-none"
        />
      </label>

      {(format.autosPerBox != null ||
        (format.packsPerBox != null && format.cardsPerPack != null)) && (
        <div className="mt-2 text-[11px] text-slate-500">
          {format.packsPerBox != null && format.cardsPerPack != null && (
            <>{format.packsPerBox * format.cardsPerPack} cards/box</>
          )}
          {format.autosPerBox != null &&
            format.packsPerBox != null &&
            format.cardsPerPack != null &&
            " · "}
          {format.autosPerBox != null && (
            <>{format.autosPerBox} autos/box</>
          )}
        </div>
      )}
    </li>
  );
}

function Field({
  label,
  prefix,
  defaultValue,
  onCommit,
}: {
  label: string;
  prefix?: string;
  defaultValue: string;
  onCommit: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-bold uppercase tracking-tight-2 text-slate-500">
        {label}
      </span>
      <div className="mt-0.5 flex items-center gap-1">
        {prefix && (
          <span className="text-sm text-slate-400">{prefix}</span>
        )}
        <input
          inputMode="decimal"
          defaultValue={defaultValue}
          onBlur={(e) => onCommit(e.currentTarget.value)}
          placeholder="—"
          className="w-full rounded border border-transparent bg-bone px-2 py-1 text-sm tabular-nums text-ink focus:border-ink focus:bg-white focus:outline-none"
        />
      </div>
    </label>
  );
}
