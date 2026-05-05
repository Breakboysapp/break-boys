"use client";

import { useMemo } from "react";
import { formatUsd } from "@/lib/money";

/**
 * Per-card data the Chase view needs. A subset of the full Card row,
 * narrowed at the page-loader level so we don't ship every column to
 * the client.
 */
export type ChaseCard = {
  playerName: string;
  cardNumber: string;
  variation: string | null;
  ungradedCents: number | null;
  psa10Cents: number | null;
  psa9Cents: number | null;
  printRun: number | null;
  popG10: number | null;
  popTotal: number | null;
  imageUrl: string | null;
};

type PlayerRollup = {
  playerName: string;
  cardCount: number;
  /** Highest PSA 10 across this player's cards. The "best chase" number. */
  topPsa10Cents: number;
  /** Same card's variation label (for "Refractor", "Red Sapphire", etc.). */
  topVariation: string | null;
  topCardNumber: string;
  topImageUrl: string | null;
  /** Sum of PSA 10 values across all of this player's cards. The "if you
   *  pulled every parallel, total upside" number. */
  totalPsa10Cents: number;
  /** Combined PSA + CGC pop counts — sum of all of this player's cards. */
  popG10Sum: number;
  popTotalSum: number;
  /** Aggregate gem rate. null when no pop data exists yet (new product
   *  before grading population accumulates). */
  gemRate: number | null;
};

function rollupByPlayer(cards: ChaseCard[]): PlayerRollup[] {
  const m = new Map<string, PlayerRollup>();
  for (const c of cards) {
    const psa10 = c.psa10Cents ?? 0;
    let row = m.get(c.playerName);
    if (!row) {
      row = {
        playerName: c.playerName,
        cardCount: 0,
        topPsa10Cents: 0,
        topVariation: null,
        topCardNumber: "",
        topImageUrl: null,
        totalPsa10Cents: 0,
        popG10Sum: 0,
        popTotalSum: 0,
        gemRate: null,
      };
      m.set(c.playerName, row);
    }
    row.cardCount++;
    row.totalPsa10Cents += psa10;
    if (psa10 > row.topPsa10Cents) {
      row.topPsa10Cents = psa10;
      row.topVariation = c.variation;
      row.topCardNumber = c.cardNumber;
      row.topImageUrl = c.imageUrl;
    }
    if (c.popG10 != null) row.popG10Sum += c.popG10;
    if (c.popTotal != null) row.popTotalSum += c.popTotal;
  }
  for (const row of m.values()) {
    row.gemRate =
      row.popTotalSum > 0 ? row.popG10Sum / row.popTotalSum : null;
  }
  return [...m.values()].sort(
    (a, b) => b.totalPsa10Cents - a.totalPsa10Cents,
  );
}

export default function ChaseScoreboard({ cards }: { cards: ChaseCard[] }) {
  const players = useMemo(() => rollupByPlayer(cards), [cards]);
  const top20 = players.slice(0, 20);
  const hasAnyValue = top20.some((p) => p.totalPsa10Cents > 0);
  const hasAnyPop = top20.some((p) => p.popTotalSum > 0);

  if (!hasAnyValue) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
        <div className="text-[10px] font-bold uppercase tracking-tight-2 text-accent">
          Chase
        </div>
        <div className="mt-1 text-base font-extrabold tracking-tight-3">
          No PSA 10 pricing yet
        </div>
        <p className="mt-2 text-xs text-slate-500">
          The Chase scoreboard ranks players by their highest-grade card values
          (sourced from PriceCharting). This product hasn&apos;t been imported
          yet, or it pre-dates the integration.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-slate-200 bg-bone px-4 py-2.5">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-tight-2 text-accent">
            Chase
          </div>
          <div className="text-sm font-extrabold leading-tight tracking-tight-3 sm:text-base">
            TOP 20 BY VALUE
          </div>
        </div>
        <div className="text-[10px] text-slate-500 sm:text-[11px]">
          PSA 10 prices · pop counts {hasAnyPop ? "" : "(none yet)"}
        </div>
      </div>

      <div className="overflow-x-auto overscroll-none">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead className="bg-ink text-white">
            <tr>
              <th className="w-10 px-3 py-2 text-left text-[10px] font-bold uppercase tracking-tight-2">
                #
              </th>
              <th className="min-w-[160px] px-3 py-2 text-left text-[10px] font-bold uppercase tracking-tight-2">
                Player
              </th>
              <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-tight-2">
                Top card
              </th>
              <th className="w-28 min-w-[112px] px-3 py-2 text-right text-[10px] font-bold uppercase tracking-tight-2">
                Top PSA 10
              </th>
              <th className="w-28 min-w-[112px] px-3 py-2 text-right text-[10px] font-bold uppercase tracking-tight-2">
                Total upside
              </th>
              <th
                className="w-20 min-w-[80px] px-3 py-2 text-right text-[10px] font-bold uppercase tracking-tight-2"
                title="Combined PSA + CGC gem rate across all of this player's cards (Grade 10s ÷ total graded)."
              >
                Gem rate
              </th>
            </tr>
          </thead>
          <tbody>
            {top20.map((p, i) => {
              const isTop10 = i < 10;
              return (
                <tr
                  key={p.playerName}
                  className={`[&>td]:border-b [&>td]:border-slate-100 ${
                    isTop10 ? "bg-accent-tint/30" : "bg-white"
                  }`}
                >
                  <td className="px-3 py-2 text-xs tabular-nums text-slate-400">
                    <span className={isTop10 ? "font-bold text-accent" : ""}>
                      {i + 1}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-semibold tracking-tight-2">
                    {p.playerName}
                    <div className="text-[10px] font-medium text-slate-400">
                      {p.cardCount} {p.cardCount === 1 ? "card" : "parallels"} in set
                    </div>
                  </td>
                  <td className="px-3 py-2 text-[11px] text-slate-600">
                    <div className="flex items-center gap-2">
                      {p.topImageUrl && (
                        // Small thumbnail of the top card. Loaded lazily —
                        // PC's storage.googleapis URLs serve straight to the
                        // browser. No proxying needed.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.topImageUrl}
                          alt=""
                          className="h-9 w-7 shrink-0 rounded border border-slate-200 object-cover"
                          loading="lazy"
                        />
                      )}
                      <div className="min-w-0">
                        <div className="font-medium text-slate-700">
                          #{p.topCardNumber}
                        </div>
                        <div className="truncate text-slate-500">
                          {p.topVariation ?? "Base"}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-extrabold tabular-nums tracking-tight-2 text-ink">
                    {p.topPsa10Cents > 0
                      ? formatUsd(p.topPsa10Cents)
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td
                    className="px-3 py-2 text-right tabular-nums text-slate-700"
                    title={`Sum of PSA 10 prices across all ${p.cardCount} of this player's cards in the set.`}
                  >
                    {p.totalPsa10Cents > 0
                      ? formatUsd(p.totalPsa10Cents)
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {p.gemRate != null ? (
                      <>
                        <div className="font-bold text-ink">
                          {(p.gemRate * 100).toFixed(1)}%
                        </div>
                        <div className="text-[10px] font-medium text-slate-400">
                          {p.popG10Sum.toLocaleString()}/
                          {p.popTotalSum.toLocaleString()}
                        </div>
                      </>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
