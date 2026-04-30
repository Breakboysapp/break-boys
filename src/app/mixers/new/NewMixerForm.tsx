"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { dollarsToCents, centsToDisplay } from "@/lib/money";

type ProductOpt = {
  id: string;
  name: string;
  sport: string;
  manufacturer: string | null;
  releaseDate: Date | string | null;
  _count: { cards: number };
};

export default function NewMixerForm({ products }: { products: ProductOpt[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [breakerHandle, setBreakerHandle] = useState("");
  const [boxPrice, setBoxPrice] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = products.filter((p) => {
    if (!filter.trim()) return true;
    const q = filter.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      (p.manufacturer ?? "").toLowerCase().includes(q) ||
      p.sport.toLowerCase().includes(q)
    );
  });

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Give the mixer a name.");
      return;
    }
    if (picked.size < 2) {
      setError("Pick at least 2 products.");
      return;
    }
    setSubmitting(true);
    const res = await fetch("/api/mixers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        breakerHandle: breakerHandle.trim() || null,
        boxPriceCents: dollarsToCents(boxPrice),
        productIds: [...picked],
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Failed to create mixer");
      return;
    }
    const mixer = await res.json();
    router.push(`/mixers/${mixer.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Mixer name (required)">
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="KKSPORTSCARDS Topps Black / Bowman Draft / Definitive"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-ink focus:outline-none"
            />
          </Field>
          <Field label="Breaker handle (optional)">
            <input
              value={breakerHandle}
              onChange={(e) => setBreakerHandle(e.target.value)}
              placeholder="KKSPORTSCARDS"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-ink focus:outline-none"
            />
          </Field>
        </div>
        <Field label="Box price (optional, can set later)">
          <div className="relative w-32">
            <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-slate-400">
              $
            </span>
            <input
              inputMode="decimal"
              value={boxPrice}
              onChange={(e) => setBoxPrice(centsToDisplay(dollarsToCents(e.target.value)) || e.target.value)}
              placeholder="0.00"
              className="w-full rounded-md border border-slate-300 py-2 pl-6 pr-2 text-sm focus:border-ink focus:outline-none"
            />
          </div>
        </Field>
      </section>

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-tight-2 text-accent">
              Products
            </div>
            <div className="text-base font-bold tracking-tight-2">
              Pick 2+ products to mix
            </div>
          </div>
          <div className="text-[11px] text-slate-500">
            <span className="font-bold text-ink">{picked.size}</span> selected ·{" "}
            {products.length} available
          </div>
        </div>
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter products…"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm placeholder:text-slate-400 focus:border-ink focus:outline-none"
        />
        <ul className="max-h-[420px] space-y-1 overflow-auto">
          {filtered.map((p) => {
            const checked = picked.has(p.id);
            return (
              <li key={p.id}>
                <label
                  className={`flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 transition ${
                    checked
                      ? "border-ink bg-ink/5"
                      : "border-slate-200 bg-white hover:border-ink"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(p.id)}
                    className="h-4 w-4 accent-ink"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold tracking-tight-2">
                      {p.name}
                    </div>
                    <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-tight-2 text-slate-500">
                      {[p.manufacturer, p.sport, `${p._count.cards} cards`]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                </label>
              </li>
            );
          })}
          {filtered.length === 0 && (
            <li className="rounded-md border border-dashed border-slate-300 bg-bone p-4 text-center text-sm text-slate-500">
              No products match.
            </li>
          )}
        </ul>
      </section>

      {error && <p className="text-sm font-semibold text-accent">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-md bg-ink px-4 py-3 text-sm font-bold uppercase tracking-tight-2 text-white disabled:opacity-50"
      >
        {submitting ? "Creating mixer…" : "Create mixer"}
      </button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-bold uppercase tracking-tight-2 text-slate-500">
        {label}
      </span>
      {children}
    </label>
  );
}
