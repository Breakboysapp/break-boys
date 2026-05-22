"use client";

import { useEffect, useRef, useState } from "react";

type Result =
  | {
      ok: true;
      parsed: number;
      inserted: number;
      capturedAt: string;
      sample: Array<{ rank: number; playerName: string; org: string | null }>;
    }
  | { ok: false; error: string };

// Browser-only; gated by ADMIN_SECRET still — this just saves the
// admin from retyping it on every visit.
const STORAGE_KEY = "breakboys:adminSecret";

export default function ProspectsRefresh() {
  const [secret, setSecret] = useState("");
  const [remembered, setRemembered] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const hydrated = useRef(false);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      setSecret(saved);
      setRemembered(true);
    }
    hydrated.current = true;
  }, []);

  async function runRefresh(s: string) {
    setResult(null);
    if (!s.trim()) {
      setResult({ ok: false, error: "ADMIN_SECRET is required." });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/prospects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Secret": s.trim(),
        },
      });
      const data = (await res.json()) as Result;
      setResult(data);
      if (data.ok) {
        localStorage.setItem(STORAGE_KEY, s.trim());
        setRemembered(true);
      } else if (res.status === 403) {
        // Wrong secret — clear the stored one so the field is editable
        // again on next visit instead of silently re-using a bad value.
        localStorage.removeItem(STORAGE_KEY);
        setRemembered(false);
      }
    } catch (err) {
      setResult({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSubmitting(false);
    }
  }

  function clearStored() {
    localStorage.removeItem(STORAGE_KEY);
    setSecret("");
    setRemembered(false);
    setResult(null);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    void runRefresh(secret);
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"
    >
      {!remembered && (
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
            autoComplete="off"
          />
          <span className="mt-1 block text-[10px] text-slate-500">
            Saved to this browser after first successful refresh — you
            won&apos;t need to type it again.
          </span>
        </label>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-ink px-5 py-2.5 text-sm font-bold uppercase tracking-tight-2 text-white hover:opacity-90 disabled:opacity-40"
        >
          {submitting ? "Refreshing…" : "Refresh from MLB Pipeline"}
        </button>
        {remembered && (
          <button
            type="button"
            onClick={clearStored}
            className="text-[11px] font-bold uppercase tracking-tight-2 text-slate-500 hover:text-accent"
          >
            Forget secret
          </button>
        )}
        <a
          href="/prospects"
          className="ml-auto text-[11px] font-bold uppercase tracking-tight-2 text-slate-500 hover:text-ink"
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
