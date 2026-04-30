"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export default function MixerTeamPicker({
  mixerId,
  allTeams,
  initialSelected,
}: {
  mixerId: string;
  allTeams: string[];
  initialSelected: string[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(
    new Set(initialSelected),
  );
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");

  function toggle(team: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(team)) next.delete(team);
      else next.add(team);
      return next;
    });
  }

  async function onSave() {
    setSaving(true);
    const res = await fetch(`/api/mixers/${mixerId}/picks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamsOwned: Array.from(selected) }),
    });
    setSaving(false);
    if (res.ok) router.refresh();
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allTeams;
    return allTeams.filter((t) => t.toLowerCase().includes(q));
  }, [allTeams, query]);

  return (
    <div className="space-y-4">
      {allTeams.length > 8 && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Filter ${allTeams.length} teams…`}
              className="w-full rounded-md border border-slate-300 bg-white py-2.5 pl-10 pr-4 text-sm font-medium placeholder:text-slate-400 focus:border-ink focus:outline-none"
            />
          </div>
          <div className="text-[11px] text-slate-500">
            {filtered.length === allTeams.length
              ? `${allTeams.length} teams`
              : `${filtered.length} of ${allTeams.length}`}
            {selected.size > 0 && (
              <>
                {" "}
                · <span className="font-bold text-ink">{selected.size}</span> picked
              </>
            )}
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-md border-2 border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
          No teams match "{query}"
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((team) => {
            const isOn = selected.has(team);
            return (
              <button
                key={team}
                type="button"
                onClick={() => toggle(team)}
                className={`rounded-md border px-3 py-2.5 text-left text-sm font-semibold transition ${
                  isOn
                    ? "border-ink bg-ink text-white"
                    : "border-slate-200 bg-white hover:border-ink"
                }`}
              >
                {team}
              </button>
            );
          })}
        </div>
      )}

      <button
        type="button"
        onClick={onSave}
        disabled={saving || selected.size === 0}
        className="rounded-md bg-ink px-5 py-3 text-xs font-bold uppercase tracking-tight-2 text-white disabled:opacity-50"
      >
        {saving
          ? "Saving…"
          : `Save ${selected.size} team${selected.size === 1 ? "" : "s"}`}
      </button>
    </div>
  );
}
