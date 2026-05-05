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
  /** Highest PSA 10 across this player's cards. Shown for context as
   *  "the chase prize," but NOT what drives the rank — a /1 Superfractor
   *  that sold once and lives in someone's safe is unhelpful for ranking
   *  by realistic upside. */
  topPsa10Cents: number;
  topVariation: string | null;
  topCardNumber: string;
  topImageUrl: string | null;
  /**
   * Expected value per single random pull from the set, summed across
   * this player's cards. Each card's contribution is its PSA 10 price
   * scaled by its realistic pull probability:
   *
   *   weight = printRun > 0 ? min(1, printRun / 100) : 1
   *
   * - Unnumbered cards (printRun = 0/null): treated as full-weight base
   *   / refractor variants with reasonable pull rates.
   * - Numbered cards: weight scales with print run, capped at 1.
   *   /1 Superfractor → 1% weight (essentially unpullable, near-zero
   *   contribution). /5 → 5%. /50 → 50%. /100+ → full weight.
   *
   * This stops a single /1 chase card from dominating a player's score
   * when it can never realistically be pulled twice.
   */
  expectedValueCents: number;
  /** 0-100 score, log-normalized expected value against the set max. */
  valueScore: number;
  /** Combined PSA + CGC pop counts — sum of all of this player's cards.
   *  Pop volume is itself a real value signal: cards being graded in
   *  bulk indicates collectors think they're worth the grading fees. */
  popG10Sum: number;
  popTotalSum: number;
  gemRate: number | null;
};

/**
 * Realistic-pull weight for a card given its print run. Returns a value
 * in (0, 1]; anything <= 1 effectively unpullable, anything >= 100
 * weighted fully.
 */
function pullWeight(printRun: number | null): number {
  if (printRun == null || printRun <= 0) return 1; // unnumbered → full
  return Math.min(1, printRun / 100);
}

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
        expectedValueCents: 0,
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
    row.expectedValueCents += psa10 * pullWeight(c.printRun);
    if (c.popG10 != null) row.popG10Sum += c.popG10;
    if (c.popTotal != null) row.popTotalSum += c.popTotal;
  }
  // Score is log-normalized expected value against the set max. Log
  // scale because expected values still span multiple orders of
  // magnitude even after print-run weighting (top tier in the
  // thousands of cents, fringe players in the dozens).
  const players = [...m.values()];
  const maxEV = Math.max(...players.map((p) => p.expectedValueCents));
  if (maxEV > 0) {
    const logMax = Math.log(maxEV);
    for (const p of players) {
      if (p.expectedValueCents <= 0) {
        p.valueScore = 0;
      } else {
        const ratio = Math.log(p.expectedValueCents) / logMax;
        p.valueScore = Math.max(1, Math.round(ratio * 100));
      }
    }
  }
  for (const row of players) {
    row.gemRate =
      row.popTotalSum > 0 ? row.popG10Sum / row.popTotalSum : null;
  }
  // Rank by expected value, NOT by topPsa10. The user's complaint is
  // exactly this: a /1 sold once shouldn't anchor the rank.
  return players.sort(
    (a, b) => b.expectedValueCents - a.expectedValueCents,
  );
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
                title="Value Score: 0-100 expected-value rating. Sums each card's PSA 10 price weighted by realistic pull probability (capped at 1 for printRun ≥ 100, 1% for /1 cards). Log-normalized against the set's top player. A /1 Superfractor doesn't dominate the rank — pullable cards do."
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
