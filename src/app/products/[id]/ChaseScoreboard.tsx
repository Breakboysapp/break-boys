"use client";

import { useEffect, useMemo, useState } from "react";
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
  /** Highest PSA 10 across this player's cards. Drives the score —
   *  Card Ladder's player-index logic: a /1 Superfractor selling for
   *  $50k IS a market signal that lifts the player's whole market,
   *  even if you'll never pull that exact card. The chase prize tells
   *  you what collectors will pay at the top end, which informs what
   *  every other card by that player is worth. */
  topPsa10Cents: number;
  topVariation: string | null;
  topCardNumber: string;
  topImageUrl: string | null;
  /** Median PSA 10 across the player's priced cards. The "typical
   *  card" floor — counterweight to topPsa10Cents so a player with
   *  one high-priced /1 and nothing else doesn't dominate over a
   *  player with depth (multiple solid parallels). */
  medianPsa10Cents: number;
  /** 0-100 market score. Log-normalized against the set's max. Combines
   *  topPsa10 (60% — chase signal) and medianPsa10 (40% — depth) so
   *  both headline value AND breadth contribute. */
  marketScore: number;
  /** Combined PSA + CGC pop counts — sum across player's cards. Pop
   *  volume is its own market signal: collectors only pay grading fees
   *  on cards they think are worth grading. Gem rate is shown in its
   *  own column so users can read both signals independently. */
  popG10Sum: number;
  popTotalSum: number;
  gemRate: number | null;
};

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function rollupByPlayer(cards: ChaseCard[]): PlayerRollup[] {
  const m = new Map<
    string,
    PlayerRollup & { _psa10s: number[] }
  >();
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
        medianPsa10Cents: 0,
        marketScore: 0,
        popG10Sum: 0,
        popTotalSum: 0,
        gemRate: null,
        _psa10s: [],
      };
      m.set(c.playerName, row);
    }
    row.cardCount++;
    if (psa10 > 0) row._psa10s.push(psa10);
    if (psa10 > row.topPsa10Cents) {
      row.topPsa10Cents = psa10;
      row.topVariation = c.variation;
      row.topCardNumber = c.cardNumber;
      row.topImageUrl = c.imageUrl;
    }
    if (c.popG10 != null) row.popG10Sum += c.popG10;
    if (c.popTotal != null) row.popTotalSum += c.popTotal;
  }

  const players = [...m.values()];
  // Compute median across each player's priced cards.
  for (const p of players) p.medianPsa10Cents = median(p._psa10s);

  // Composite market score: 60% top + 40% median, both log-scaled,
  // normalized against the set's max blend. Log because PSA 10 prices
  // span 4+ orders of magnitude — linear normalization squashes the
  // middle to single digits. Floor at 1 to keep dim players visible.
  const blend = (top: number, mid: number) =>
    Math.log(top + 1) * 0.6 + Math.log(mid + 1) * 0.4;
  const maxBlend = Math.max(
    ...players.map((p) => blend(p.topPsa10Cents, p.medianPsa10Cents)),
  );
  if (maxBlend > 0) {
    for (const p of players) {
      const playerBlend = blend(p.topPsa10Cents, p.medianPsa10Cents);
      p.marketScore =
        playerBlend > 0
          ? Math.max(1, Math.round((playerBlend / maxBlend) * 100))
          : 0;
    }
  }
  for (const row of players) {
    row.gemRate =
      row.popTotalSum > 0 ? row.popG10Sum / row.popTotalSum : null;
  }
  return players.sort((a, b) => b.marketScore - a.marketScore);
}

export default function ChaseScoreboard({ cards }: { cards: ChaseCard[] }) {
  const players = useMemo(() => rollupByPlayer(cards), [cards]);
  const top20 = players.slice(0, 20);
  const hasAnyValue = top20.some((p) => p.topPsa10Cents > 0);
  const hasAnyPop = top20.some((p) => p.popTotalSum > 0);
  const [explainerOpen, setExplainerOpen] = useState(false);

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
              <th className="w-24 min-w-[96px] px-3 py-2 text-right text-[10px] font-bold uppercase tracking-tight-2">
                <button
                  type="button"
                  onClick={() => setExplainerOpen(true)}
                  className="inline-flex items-center gap-1 hover:text-accent"
                  title="What is Market Score?"
                >
                  <span>Market Score</span>
                  <span
                    aria-hidden
                    className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-white/40 text-[8px] font-bold text-white/70"
                  >
                    i
                  </span>
                </button>
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
                  <td
                    className="px-3 py-2 text-right tabular-nums"
                    title={`${p.marketScore}/100. Log-normalized against the top player's PSA 10 in this set.`}
                  >
                    {p.marketScore > 0 ? (
                      <>
                        <span className="text-base font-extrabold text-ink">
                          {p.marketScore}
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

      {explainerOpen && (
        <MarketScoreExplainer onClose={() => setExplainerOpen(false)} />
      )}
    </div>
  );
}

/**
 * Tap-the-i explainer for the Market Score column. Same modal pattern
 * as the bucket-detail popover on TeamBreakdownSheet so the chrome
 * stays consistent. Closes on Escape, backdrop click, or the X button.
 */
function MarketScoreExplainer({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Market Score explainer"
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60"
      />
      <div className="relative z-10 m-3 max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold uppercase tracking-tight-2 text-accent">
              Chase view · per-player rating
            </div>
            <h2 className="mt-1 text-lg font-extrabold leading-tight tracking-tight-3">
              Market Score
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-ink"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 space-y-3 text-sm leading-relaxed text-slate-700">
          <p>
            A <strong>0–100 player market index</strong>, modeled after
            the way Card Ladder builds player indexes — the trophy card
            isn&apos;t something you&apos;ll personally pull from a break,
            but its sale price IS a real market signal that lifts the
            player&apos;s whole market.
          </p>
          <div className="rounded-lg border border-slate-200 bg-bone p-3 text-xs">
            <div className="text-[10px] font-bold uppercase tracking-tight-2 text-slate-500">
              Formula
            </div>
            <code className="mt-1 block whitespace-pre-wrap font-mono text-[11px] text-ink">
              blend = log(top PSA 10 + 1) × 0.6
                  + log(median PSA 10 + 1) × 0.4{"\n"}
              score = round(blend / set_max_blend × 100)
            </code>
          </div>
          <ul className="space-y-1.5 text-[13px]">
            <li>
              <strong>60% top PSA 10</strong> — the chase signal. A
              Superfractor /1 selling at $50K tells the market this
              player&apos;s cards are worth more across the board.
            </li>
            <li>
              <strong>40% median PSA 10</strong> — the depth signal.
              Counterweight so a player with one high-priced /1 and
              nothing else doesn&apos;t outrank a player with five solid
              parallels.
            </li>
            <li>
              <strong>Log-normalized</strong> against the set&apos;s top
              player. Top player = 100, others slide on a log curve so
              order-of-magnitude differences read cleanly without lower
              ranks squashed to single digits.
            </li>
          </ul>
          <p className="text-xs text-slate-500">
            The Gem Rate column adds a separate market-validity signal:
            collectors only pay grading fees on cards they think are
            worth grading, so high pop volume = real demand. Both
            columns are designed to be read together.
          </p>
        </div>
      </div>
    </div>
  );
}
