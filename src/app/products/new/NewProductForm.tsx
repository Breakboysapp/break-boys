"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { KNOWN_MANUFACTURERS, detectManufacturer } from "@/lib/manufacturer";

const SPORTS = ["MLB", "NBA", "NFL", "NHL", "Soccer", "Other"];
const MANUFACTURERS = [...KNOWN_MANUFACTURERS, "Other"];

export default function NewProductForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [sport, setSport] = useState("MLB");
  const [manufacturer, setManufacturer] = useState("");
  // Track whether the user has manually overridden the auto-detected
  // manufacturer. If they have, we stop touching it as they keep typing.
  const [manuallyEdited, setManuallyEdited] = useState(false);
  const [releaseDate, setReleaseDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-detect manufacturer from the name as the user types.
  useEffect(() => {
    if (manuallyEdited) return;
    const detected = detectManufacturer(name);
    setManufacturer(detected ?? "");
  }, [name, manuallyEdited]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        sport,
        manufacturer: manufacturer || null,
        releaseDate: releaseDate || null,
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Failed to create product");
      setSubmitting(false);
      return;
    }
    const product = await res.json();
    router.push(`/products/${product.id}`);
    router.refresh();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6"
    >
      <Field label="Product name">
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="2025 Bowman Chrome Baseball"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-ink focus:outline-none"
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Manufacturer">
          <select
            value={manufacturer}
            onChange={(e) => {
              setManufacturer(e.target.value);
              setManuallyEdited(true);
            }}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">— Select —</option>
            {MANUFACTURERS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Sport">
          <select
            value={sport}
            onChange={(e) => setSport(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            {SPORTS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Release date (optional)">
        <input
          type="date"
          value={releaseDate}
          onChange={(e) => setReleaseDate(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </Field>
      {error && <p className="text-sm text-accent">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-md bg-ink px-4 py-3 text-sm font-bold uppercase tracking-tight-2 text-white disabled:opacity-50"
      >
        {submitting ? "Creating…" : "Create product"}
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
