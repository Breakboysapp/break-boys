"use client";

import { useState } from "react";

type Result =
  | {
      ok: true;
      parsed: number;
      inserted: number;
      capturedAt: string;
      sample: Array<{ rank: number; playerName: string; org: string | null }>;
    }
  | { ok: false; error: string };

export default function ProspectsRefresh() {
  const [secret, setSecret] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
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
      });
      const data = (await res.json()) as Result;
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
      <label className="block max-w-sm">
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

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-ink px-5 py-2.5 text-sm font-bold uppercase tracking-tight-2 text-white hover:opacity-90 disabled:opacity-40"
        >
          {submitting ? "Refreshing…" : "Refresh from MLB Pipeline"}
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
                Imported {result.inserted} prospects.
              </div>
              <div className="text-xs text-emerald-800">
                Captured {new Date(result.capturedAt).toLocaleString()}
              </div>
              <pre className="mt-2 overflow-x-auto rounded bg-white/60 p-2 text-[10px] text-slate-700">
                {JSON.stringify(result.sample, null, 2)}
              </pre>
            </div>
          ) : (
            <div className="font-bold">{result.error}</div>
          )}
        </div>
      )}
    </form>
  );
}
