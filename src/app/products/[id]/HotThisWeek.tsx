"use client";

import Link from "next/link";
import { useState } from "react";
import { formatUsd } from "@/lib/money";
import { playerSlug } from "@/lib/player-slug";
import type { TrendingDiagnostics } from "@/lib/cardhedger-trending";

/**
 * "Hot This Week" — surfaces players whose current-week sales activity
 * has spiked vs their prior 3-week baseline, regardless of whether
 * they show up in the chase view top 50.
 *
 * The chase view ranks by Overall (PriceCharting PSA 10 + raw blend),
 * so players without priced data — Patrick Copen, Eric Hartman, the
 * minor-leaguer wave — never make it to the visible rows. This
 * section catches them.
 *
 * Sorted by current-week dollar volume so the most meaningful spikes
 * float to the top: a $50k volume × 6 spike beats a $300 volume × 80
 * spike for actual market signal.
 */
export type HotPlayer = {
  playerName: string;
  team: string | null;
  currentWeekSales: number;
  currentWeekCents: number;
  spikeMultiple: number;
  isRookie?: boolean;
  isProspect?: boolean;
};

export default function HotThisWeek({
  players,
  diagnostics,
}: {
  players: HotPlayer[];
  diagnostics?: TrendingDiagnostics;
}) {
  // Collapsed by default — single-line header reads as a stripe;
  // user clicks the chevron to expand the rows. State lives on the
  // client so collapse persists during a session of clicks elsewhere
  // on the page.
  const [open, setOpen] = useState(false);

  const headerLabel = "🔥 SEE WHO'S ON FIRE";
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex w-full items-center justify-between bg-bone px-4 py-2.5 text-left transition hover:bg-slate-100 ${
          open ? "border-b border-slate-200" : ""
        }`}
      >
        <span className="text-sm font-extrabold uppercase tracking-tight-2 text-accent sm:text-base">
          {headerLabel}
        </span>
        <span
          aria-hidden
          className={`flex h-7 w-7 items-center justify-center rounded-full bg-accent text-base font-extrabold text-white transition-transform ${
            open ? "rotate-180" : ""
          }`}
        >
          ▾
        </span>
      </button>
      {!open ? null : players.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-slate-400">
          {diagnostics?.apiKeyMissing
            ? "Card Hedger integration disabled (no API key on this deploy)."
            : diagnostics &&
                diagnostics.batchesAttempted > 0 &&
                diagnostics.batchesSucceeded === 0
              ? `Card Hedger fetch failed on every batch (${diagnostics.batchesAttempted} attempted). Last error: ${diagnostics.lastError ?? "unknown"}`
              : "No players spiking ≥5× this week. Quiet market for this product."}
          {diagnostics &&
            diagnostics.playersRequested > 0 && (
              <div className="mt-1 text-[10px] text-slate-300">
                {diagnostics.playersWithData}/
                {diagnostics.playersRequested} players returned data
              </div>
            )}
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {players.map((p, i) => (
          <li
            key={p.playerName}
            className="flex items-center gap-3 px-4 py-2.5 hover:bg-bone/40"
          >
            <span className="w-6 shrink-0 text-xs tabular-nums text-slate-400">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <Link
                href={`/players/${playerSlug(p.playerName)}`}
                className="font-semibold tracking-tight-2 text-slate-800 hover:text-accent"
              >
                {p.playerName}
              </Link>
              {p.isRookie && (
                <span
                  className="ml-1 text-[10px] font-bold text-accent"
                  title="Rookie card in this set"
                >
                  (R)
                </span>
              )}
              {p.isProspect && (
                <span
                  className="ml-1 text-[10px] font-bold text-emerald-600"
                  title="Prospect — minor leaguer or draft pick"
                >
                  (P)
                </span>
              )}
              {p.team && (
                <div className="text-[10px] font-medium text-slate-400">
                  {p.team}
                </div>
              )}
            </div>
            <div className="text-right tabular-nums">
              <div className="text-sm font-extrabold text-ink">
                {formatUsd(p.currentWeekCents)}
              </div>
              <div className="text-[10px] font-medium text-slate-500">
                {p.currentWeekSales.toLocaleString()} sales ·{" "}
                <span className="font-bold text-accent">
                  {Number.isFinite(p.spikeMultiple)
                    ? `×${p.spikeMultiple.toFixed(1)}`
                    : "new"}
                </span>
              </div>
            </div>
          </li>
          ))}
        </ul>
      )}
    </section>
  );
}
