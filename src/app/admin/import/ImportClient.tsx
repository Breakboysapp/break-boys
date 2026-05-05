"use client";

import { useRef, useState } from "react";

const PRESET_SLUGS = [
  { slug: "baseball-cards-2025-topps-chrome", label: "2025 Topps Chrome Baseball" },
  { slug: "football-cards-2024-topps-chrome", label: "2024 Topps Chrome Football" },
  { slug: "football-cards-2025-topps-chrome", label: "2025 Topps Chrome Football" },
];

export default function ImportClient({ secret }: { secret?: string }) {
  const [slug, setSlug] = useState(PRESET_SLUGS[0].slug);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState("");
  const logRef = useRef<HTMLPreElement>(null);

  async function startImport() {
    setRunning(true);
    setLog("Starting…\n");
    try {
      const res = await fetch(
        `/api/admin/import-pricecharting?secret=${encodeURIComponent(
          secret ?? "",
        )}&slug=${encodeURIComponent(slug)}`,
        { method: "POST" },
      );
      if (!res.ok || !res.body) {
        const text = await res.text();
        setLog((l) => l + `\nrequest failed: ${res.status} ${text}\n`);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      // Stream the response into the log textarea so the user sees
      // progress lines as they land. The route emits a heartbeat every
      // 250 cards so a multi-minute import doesn't look frozen.
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setLog((l) => l + chunk);
        // Auto-scroll to bottom.
        requestAnimationFrame(() => {
          if (logRef.current) {
            logRef.current.scrollTop = logRef.current.scrollHeight;
          }
        });
      }
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
      <label className="block">
        <span className="text-[11px] font-bold uppercase tracking-tight-2 text-slate-600">
          Set
        </span>
        <select
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          disabled={running}
          className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
        >
          {PRESET_SLUGS.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={startImport}
        disabled={running}
        className="w-full rounded-md bg-ink px-4 py-2.5 text-sm font-bold uppercase tracking-tight-2 text-white hover:opacity-90 disabled:opacity-50"
      >
        {running ? "Importing…" : "Run import"}
      </button>
      {log && (
        <pre
          ref={logRef}
          className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-bone p-3 text-[11px] leading-snug text-slate-700"
        >
          {log}
        </pre>
      )}
    </div>
  );
}
