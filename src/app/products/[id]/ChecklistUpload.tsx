"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const SAMPLE = `Team,Player,Card #,Parallel
Yankees,Aaron Judge,1,
Yankees,Juan Soto,2,Refractor
Dodgers,Shohei Ohtani,10,
Dodgers,Mookie Betts,11,`;

type Mode = "url" | "csv";

export default function ChecklistUpload({
  productId,
  hasExistingCards,
}: {
  productId: string;
  hasExistingCards: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("url");
  const [csv, setCsv] = useState("");
  const [url, setUrl] = useState("");
  // When the product already has a checklist, default to replacing it on
  // a URL re-import — that's almost always what the user wants and avoids
  // doubling rows from accidental clicks.
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
    await runImport(`/api/products/${productId}/checklist`, { csv, replace });
  }

  async function submitUrl(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) {
      setError("Paste a Beckett checklist URL or Google Sheets URL.");
      return;
    }
    await runImport(`/api/products/${productId}/checklist/from-url`, {
      url: url.trim(),
      replace,
    });
  }

  async function runImport(endpoint: string, body: object) {
    setSubmitting(true);
    setError(null);
    setMessage(null);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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
    setUrl("");
    router.refresh();
  }

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
      <div className="inline-flex rounded-md bg-bone p-1 text-[11px] font-bold uppercase tracking-tight-2">
        <ModeButton current={mode} value="url" onClick={() => setMode("url")} label="From URL" />
        <ModeButton current={mode} value="csv" onClick={() => setMode("csv")} label="From CSV" />
      </div>

      {mode === "url" ? (
        <form onSubmit={submitUrl} className="space-y-3">
          <p className="text-xs text-slate-500">
            Paste a <strong>Beckett article</strong> URL (e.g.{" "}
            <code>beckett.com/news/2026-topps-chrome-black-baseball-cards/</code>) or
            a <strong>Google Sheets</strong> share URL whose first sheet has{" "}
            <code>Team</code>, <code>Player</code>, <code>Card #</code> columns.
          </p>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.beckett.com/news/..."
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          {hasExistingCards && (
            <ReplaceCheckbox value={replace} onChange={setReplace} />
          )}
          {error && <p className="text-xs font-semibold text-accent">{error}</p>}
          {message && <p className="text-xs font-semibold text-emerald-600">{message}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-ink px-5 py-3 text-xs font-bold uppercase tracking-tight-2 text-white disabled:opacity-50"
          >
            {submitting ? "Importing…" : "Import from URL"}
          </button>
        </form>
      ) : (
        <form onSubmit={submitCsv} className="space-y-3">
          <p className="text-xs text-slate-500">
            Required columns: <code>Team</code>, <code>Player</code>, <code>Card #</code>.
            Optional: <code>Parallel</code>.
          </p>
          <input type="file" accept=".csv,text/csv" onChange={onFile} className="block text-sm" />
          <textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            placeholder={SAMPLE}
            rows={8}
            className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
          />
          {hasExistingCards && (
            <ReplaceCheckbox value={replace} onChange={setReplace} />
          )}
          {error && <p className="text-xs font-semibold text-accent">{error}</p>}
          {message && <p className="text-xs font-semibold text-emerald-600">{message}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-ink px-5 py-3 text-xs font-bold uppercase tracking-tight-2 text-white disabled:opacity-50"
          >
            {submitting ? "Uploading…" : hasExistingCards ? "Add to checklist" : "Upload checklist"}
          </button>
        </form>
      )}
    </div>
  );
}

function ModeButton({
  current,
  value,
  onClick,
  label,
}: {
  current: Mode;
  value: Mode;
  onClick: () => void;
  label: string;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-3 py-1.5 transition ${
        active ? "bg-ink text-white" : "text-slate-600 hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

function ReplaceCheckbox({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
      />
      Replace existing checklist (deletes current cards)
    </label>
  );
}
