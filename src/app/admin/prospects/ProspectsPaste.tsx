"use client";

import { useState } from "react";

const SAMPLE = `1. Roki Sasaki, RHP, Dodgers, 23
2. Walker Jenkins, OF, Twins, 21, AA
3. Konnor Griffin, SS, Pirates, 19, A
4. Sebastian Walcott, SS, Rangers, 19, AA
5. Bryce Eldridge, 1B, Giants, 21, AAA`;

export default function ProspectsPaste() {
  const [source, setSource] = useState("mlb-pipeline");
  const [sport, setSport] = useState("MLB");
  const [raw, setRaw] = useState("");
  const [secret, setSecret] = useState("");
  const [replace, setReplace] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    parsed?: number;
    created?: number;
    updated?: number;
    sample?: unknown;
    error?: string;
  } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    if (!raw.trim()) {
      setResult({ ok: false, error: "Paste a list first." });
      return;
    }
    if (!secret.trim()) {
      setResult({ ok: false, error: "ADMIN_SECRET is required." });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/prospects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Secret": secret.trim(),
        },
        body: JSON.stringify({ source, sport, raw, replace }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        parsed?: number;
        created?: number;
        updated?: number;
        sample?: unknown;
        error?: string;
      };
      setResult(data);
    } catch (err) {
      setResult({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-tight-2 text-slate-500">
            Source
          </span>
          <input
            type="text"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="mlb-pipeline"
            className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-ink focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-tight-2 text-slate-500">
            Sport
          </span>
          <input
            type="text"
            value={sport}
            onChange={(e) => setSport(e.target.value)}
            placeholder="MLB"
            className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-ink focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-tight-2 text-slate-500">
            Admin secret
          </span>
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="ADMIN_SECRET"
            className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-ink focus:outline-none"
          />
        </label>
      </div>

      <label className="block">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-tight-2 text-slate-500">
            Paste list — one prospect per line
          </span>
          <button
            type="button"
            onClick={() => setRaw(SAMPLE)}
            className="text-[11px] text-accent hover:underline"
          >
            Fill sample
          </button>
        </div>
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          rows={14}
          placeholder={SAMPLE}
          className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs focus:border-ink focus:outline-none"
        />
      </label>

      <label className="flex items-center gap-2 text-xs text-slate-600">
        <input
          type="checkbox"
          checked={replace}
          onChange={(e) => setReplace(e.target.checked)}
          className="h-4 w-4"
        />
        Replace existing rows for this source + sport (deletes any not in
        the paste — recommended when ingesting a refreshed list)
      </label>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-ink px-5 py-2.5 text-sm font-bold uppercase tracking-tight-2 text-white hover:opacity-90 disabled:opacity-40"
        >
          {submitting ? "Importing…" : "Import list"}
        </button>
        <a
          href="/prospects"
          className="text-[11px] font-bold uppercase tracking-tight-2 text-slate-500 hover:text-ink"
        >
          View Sleeper Index →
        </a>
      </div>

      {result && (
        <div
          className={`rounded-md border px-4 py-3 text-sm ${
            result.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-accent/30 bg-accent/5 text-accent"
          }`}
        >
          {result.ok ? (
            <div className="space-y-1">
              <div className="font-bold">
                Imported {result.parsed} prospects.
              </div>
              <div className="text-xs">
                {result.created} new · {result.updated} updated
              </div>
              {result.sample !== undefined && (
                <pre className="mt-2 overflow-x-auto rounded bg-white/60 p-2 text-[10px] text-slate-700">
                  {JSON.stringify(result.sample, null, 2)}
                </pre>
              )}
            </div>
          ) : (
            <div className="font-bold">{result.error ?? "Failed."}</div>
          )}
        </div>
      )}
    </form>
  );
}
