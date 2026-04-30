"use client";

import { useState } from "react";

type AlgorithmBucket = {
  label: string;
  weight: number;
  count: number;
  contribution: number;
};

type Row = {
  name: string;
  byBucket: Record<string, number>;
  totalCards: number;
  totalScore: number;
};

type View = "team" | "player";

export default function TeamBreakdownSheet({
  buckets,
  teamRows,
  playerRows,
}: {
  buckets: AlgorithmBucket[];
  teamRows: Row[];
  playerRows: Row[];
}) {
  const [view, setView] = useState<View>("team");

  const rows = view === "team" ? teamRows : playerRows;
  const subjectLabel = view === "team" ? "Team" : "Player";
  const subjectMinWidth = view === "team" ? "min-w-[180px]" : "min-w-[220px]";

  if (buckets.length === 0) return null;

  const grandTotalScore = rows.reduce((s, r) => s + r.totalScore, 0);

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-slate-200 bg-bone px-4 py-2.5">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-tight-2 text-accent">
            Score Card
          </div>
          <div className="text-sm font-extrabold leading-tight tracking-tight-3 sm:text-base">
            BREAK BOYS SCORE CARD
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
          <ViewToggle current={view} onChange={setView} />
          <div className="text-[10px] text-slate-500 sm:text-[11px]">
            {rows.length} {view === "team" ? "teams" : "players"} · {buckets.length} types
          </div>
        </div>
      </div>

      {/*
        Sticky cell layering:
          thead corner cells:       z-40  (top + left, must beat everything)
          thead other cells:        z-30
          tbody sticky-left cells:  z-20
          tfoot total cells:        z-30
          regular cells:            z-0
        Every sticky cell uses an OPAQUE background — bg-inherit caused
        opacity bleed-through.
      */}
      <div className="max-h-[640px] overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-30 bg-ink text-white">
            <tr>
              <th className="sticky left-0 z-40 w-10 bg-ink px-3 py-2 text-left text-[10px] font-bold uppercase tracking-tight-2">
                #
              </th>
              <th
                className={`sticky left-10 z-40 ${subjectMinWidth} bg-ink px-3 py-2 text-left text-[10px] font-bold uppercase tracking-tight-2`}
              >
                {subjectLabel}
              </th>
              {buckets.map((b) => (
                <th
                  key={b.label}
                  className="bg-ink px-3 py-2 text-right text-[10px] font-bold uppercase tracking-tight-2"
                  title={`${b.weight} pts/card`}
                >
                  <div className="leading-tight">{b.label}</div>
                  <div className="text-[9px] font-semibold text-white/60">
                    ×{b.weight}
                  </div>
                </th>
              ))}
              <th className="bg-accent px-3 py-2 text-right text-[10px] font-bold uppercase tracking-tight-2">
                Break Score
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.name} className="border-b border-slate-100 last:border-0">
                <td className="sticky left-0 z-20 w-10 bg-white px-3 py-2 text-xs text-slate-400">
                  {i + 1}
                </td>
                <td
                  className={`sticky left-10 z-20 ${subjectMinWidth} bg-white px-3 py-2 font-semibold tracking-tight-2`}
                >
                  {r.name}
                </td>
                {buckets.map((b) => {
                  const n = r.byBucket[b.label] ?? 0;
                  const contribution = n * b.weight;
                  return (
                    <td
                      key={b.label}
                      className={`bg-white px-3 py-2 text-right tabular-nums ${
                        n === 0 ? "text-slate-300" : "text-slate-700"
                      }`}
                      title={
                        n > 0
                          ? `${n} × ${b.weight} = ${contribution} pts`
                          : "no cards"
                      }
                    >
                      {n === 0 ? (
                        "—"
                      ) : (
                        <>
                          <div className="font-semibold leading-tight">{n}</div>
                          <div className="text-[10px] font-medium leading-tight text-slate-400">
                            {contribution} pts
                          </div>
                        </>
                      )}
                    </td>
                  );
                })}
                <td className="bg-accent/5 px-3 py-2 text-right font-extrabold tabular-nums tracking-tight-2 text-ink">
                  {r.totalScore}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="sticky bottom-0 z-30">
            <tr className="border-t-2 border-ink text-[11px] font-bold uppercase tracking-tight-2 text-slate-700">
              <td colSpan={2} className="sticky left-0 z-40 bg-bone px-3 py-2">
                Total
              </td>
              {buckets.map((b) => (
                <td
                  key={b.label}
                  className="bg-bone px-3 py-2 text-right tabular-nums text-slate-700"
                  title={`${b.count} × ${b.weight} = ${b.contribution} pts`}
                >
                  <div className="leading-tight">{b.count}</div>
                  <div className="text-[10px] font-medium leading-tight text-slate-500">
                    {b.contribution} pts
                  </div>
                </td>
              ))}
              <td className="bg-accent px-3 py-2 text-right tabular-nums text-white">
                {grandTotalScore}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function ViewToggle({
  current,
  onChange,
}: {
  current: View;
  onChange: (v: View) => void;
}) {
  return (
    <div className="inline-flex rounded-md bg-white p-0.5 ring-1 ring-slate-200 text-[11px] font-bold uppercase tracking-tight-2">
      <ToggleButton active={current === "team"} onClick={() => onChange("team")}>
        Team
      </ToggleButton>
      <ToggleButton active={current === "player"} onClick={() => onChange("player")}>
        Player
      </ToggleButton>
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-3 py-1.5 transition ${
        active ? "bg-ink text-white" : "text-slate-600 hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
