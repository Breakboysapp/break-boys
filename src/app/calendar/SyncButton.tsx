"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SyncButton({
  provider,
  label,
}: {
  provider: string;
  label: string;
}) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function onClick() {
    setSyncing(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/sync/${provider}`, { method: "POST" });
      const j = await res.json();
      if (!res.ok) {
        setMessage(j.error ?? `Sync failed (${res.status})`);
      } else {
        setMessage(
          `Fetched ${j.fetched} · ${j.created} new · ${j.updated} updated · ${j.skipped} skipped`,
        );
        router.refresh();
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={onClick}
        disabled={syncing}
        className="rounded-md border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold uppercase tracking-tight-2 hover:border-ink disabled:opacity-50"
      >
        {syncing ? "Syncing…" : `Sync ${label}`}
      </button>
      {message && <span className="text-xs text-slate-500">{message}</span>}
    </div>
  );
}
