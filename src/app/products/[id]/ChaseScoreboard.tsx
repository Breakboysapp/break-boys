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
  /** Highest PSA 10 across this player's cards. The "best chase" number —
   *  this is what you'd actually realize on the trophy pull, vs. the
   *  earlier "total upside" metric which assumed you got every parallel. */
  topPsa10Cents: number;
  /** Same card's variation label (for "Refractor", "Red Sapphire", etc.). */
  topVariation: string | null;
  topCardNumber: string;
  topImageUrl: string | null;
  /** 0-100 desirability score, normalized log-scale on topPsa10Cents
   *  against the max in the set. The top player is pinned at 100; the
   *  rest slide down on a log curve so order-of-magnitude differences
   *  read cleanly without lower ranks getting squashed to single digits.
   *  Log scale because PSA 10 prices in a Topps Chrome set span 4+ orders
   *  of magnitude (top chase $16k, base rookies $5) — linear normalization
   *  gives most players a 1 or 2 / 100 which is useless for comparison. */
  valueScore: number;
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
        valueScore: 0,
        popG10Sum: 0,
        popTotalSum: 0,
        gemRate: null,
      };
      m.set(c.playerName, row);
    }
    row.cardCount++;
    if (psa10 > row.topPsa10Cents) {
      row.topPsa10Cents = psa10;
      row.topVariation = c.variation;
      row.topCardNumber = c.cardNumber;
      row.topImageUrl = c.imageUrl;
    }
    if (c.popG10 != null) row.popG10Sum += c.popG10;
    if (c.popTotal != null) row.popTotalSum += c.popTotal;
  }
  // Compute value scores after the per-player rollup. Top player = 100,
  // floor pinned at 1 to keep low-tier players visible but tiny.
  const players = [...m.values()];
  const maxTop = Math.max(...players.map((p) => p.topPsa10Cents));
  if (maxTop > 0) {
    const logMax = Math.log(maxTop);
    for (const p of players) {
      if (p.topPsa10Cents <= 0) {
        p.valueScore = 0;
      } else {
        const ratio = Math.log(p.topPsa10Cents) / logMax;
        p.valueScore = Math.max(1, Math.round(ratio * 100));
      }
    }
  }
  for (const row of players) {
    row.gemRate =
      row.popTotalSum > 0 ? row.popG10Sum / row.popTotalSum : null;
  }
  return players.sort((a, b) => b.topPsa10Cents - a.topPsa10Cents);
}

export default function ChaseScoreboard({ cards }: { cards: ChaseCard[] }) {
  const players = useMemo(() => rollupByPlayer(cards), [cards]);
  const top20 = players.slice(0, 20);
  const hasAnyValue = top20.some((p) => p.topPsa10Cents > 0);
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

      {/*
        overscroll-x-contain (NOT overscroll-none) — earlier we used
        overscroll-none everywhere to kill iOS rubber-band, but that
        also blocked vertical mouse-wheel events from passing through
        to the page when the cursor sat over the table on desktop.
        x-contain isolates only the horizontal axis, so vertical wheel
        scroll bubbles up to the page like normal.
      */}
      <div className="overflow-x-auto overscroll-x-contain">
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
              <th
                className="w-20 min-w-[80px] px-3 py-2 text-right text-[10px] font-bold uppercase tracking-tight-2"
                title="Value Score: 0-100 desirability rating, log-normalized on this set's top PSA 10 price. The chase player is pinned at 100; everyone else slides relative to them."
              >
                Score
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
                    className="px-3 py-2 text-right tabular-nums"
                    title={`${p.valueScore}/100. Log-normalized against the top player's PSA 10 in this set.`}
                  >
                    {p.valueScore > 0 ? (
                      <>
                        <span className="text-base font-extrabold text-ink">
                          {p.valueScore}
                        </span>
                        <span className="text-[10px] font-medium text-slate-400">
                          /100
                        </span>
                      </>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
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
