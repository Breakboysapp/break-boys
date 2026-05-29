"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const SAMPLE = `Team,Player,Card #,Parallel
Yankees,Aaron Judge,1,
Yankees,Juan Soto,2,Refractor
Dodgers,Shohei Ohtani,10,
Dodgers,Mookie Betts,11,`;

export default function ChecklistUpload({
  productId,
  hasExistingCards,
}: {
  productId: string;
  hasExistingCards: boolean;
}) {
  const router = useRouter();
  const [csv, setCsv] = useState("");
  // When the product already has a checklist, default to replacing it on
  // a re-import — almost always what the user wants and avoids doubling
  // rows from accidental clicks.
  const [replace, setReplace] = useState(hasExistingCards);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setCsv(text);
  }

  async function submitCsv(e: React.FormEvent) {
    e.preventDefault();
    if (!csv.trim()) {
      setError("Paste CSV text or pick a file first.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/products/${productId}/checklist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csv, replace }),
    });
    const j = await res.json().catch(() => ({}));
    setSubmitting(false);
    if (!res.ok) {
      setError(j.error ?? "Import failed");
      return;
    }
    const teamLabel = j.teams ? ` across ${j.teams} teams` : "";
    setMessage(`Added ${j.added} cards${teamLabel}.`);
    setCsv("");
    router.refresh();
  }

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
      <form onSubmit={submitCsv} className="space-y-3">
        <p className="text-xs text-slate-500">
          Upload a CSV. Required columns: <code>Team</code>,{" "}
          <code>Player</code>, <code>Card #</code>. Optional:{" "}
          <code>Parallel</code>.
        </p>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={onFile}
          className="block text-sm"
        />
        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          placeholder={SAMPLE}
          rows={8}
          className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
        />
        {hasExistingCards && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={replace}
              onChange={(e) => setReplace(e.target.checked)}
            />
            Replace existing checklist (deletes current cards)
          </label>
        )}
        {error && <p className="text-xs font-semibold text-accent">{error}</p>}
        {message && (
          <p className="text-xs font-semibold text-emerald-600">{message}</p>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-ink px-5 py-3 text-xs font-bold uppercase tracking-tight-2 text-white disabled:opacity-50"
        >
          {submitting
            ? "Uploading…"
            : hasExistingCards
              ? "Add to checklist"
              : "Upload checklist"}
        </button>
      </form>
    </div>
  );
}
