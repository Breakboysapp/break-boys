"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  centsToDisplay,
  dollarsToCents,
  formatRelativeTime,
} from "@/lib/money";
import TeamBreakdownSheet from "./TeamBreakdownSheet";

type AlgorithmBucket = {
  label: string;
  weight: number;
  count: number;
  contribution: number;
};

type BreakdownRow = {
  name: string;
  byBucket: Record<string, number>;
  totalCards: number;
  totalScore: number;
  confirmedMarketCents: number;
  totalPotentialCents: number;
  cardsWithMarket: number;
  maxPotentialCents: number;
};

type CardLite = {
  team: string;
  playerName: string;
  cardNumber: string;
  variation: string | null;
  marketValueCents: number | null;
};

export default function TeamPriceEditor({
  productId,
  initialBoxPriceCents,
  totalContentScore,
  cardsWithMarket,
  cardCount,
  lastMarketRefreshAt,
  algorithm,
  teamBreakdownRows,
  playerBreakdownRows,
  cards,
}: {
  productId: string;
  initialBoxPriceCents: number | null;
  blendAlpha: number;
  totalContentScore: number;
  cardsWithMarket: number;
  cardCount: number;
  lastMarketRefreshAt: string | null;
  algorithm: AlgorithmBucket[];
  teamBreakdownRows: BreakdownRow[];
  playerBreakdownRows: BreakdownRow[];
  cards: CardLite[];
}) {
  const router = useRouter();
  const [boxPrice, setBoxPrice] = useState(centsToDisplay(initialBoxPriceCents));
  const [savingBox, setSavingBox] = useState(false);

  const showMarketBadge = cardsWithMarket > 0;

  async function saveBoxPrice() {
    setSavingBox(true);
    const res = await fetch(`/api/products/${productId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ boxPriceCents: dollarsToCents(boxPrice) }),
    });
    setSavingBox(false);
    if (res.ok) router.refresh();
  }

  const lastRefresh = lastMarketRefreshAt
    ? formatRelativeTime(new Date(lastMarketRefreshAt))
    : null;

  return (
    <div className="space-y-3">
      {/* Start a break — quick access at the very top so the primary action
          is always one tap away. */}
      <Link
        href={`/products/${productId}/break`}
        className="flex items-center justify-between gap-3 rounded-2xl border border-ink bg-ink px-4 py-3 text-white transition hover:opacity-90 sm:px-5 sm:py-4"
      >
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-tight-2 text-white/60 sm:text-[11px]">
            Ready to track?
          </div>
          <div className="text-base font-extrabold tracking-tight-3 sm:text-lg">
            START A BREAK
          </div>
        </div>
        <span
          aria-hidden
          className="shrink-0 rounded-md bg-accent px-3 py-2 text-[11px] font-bold uppercase tracking-tight-2"
        >
          Begin →
        </span>
      </Link>

      {/* BREAK BOYS SCORE CARD — primary visualization, leads the section */}
      <TeamBreakdownSheet
        buckets={algorithm}
        teamRows={teamBreakdownRows}
        playerRows={playerBreakdownRows}
        cards={cards}
      />

      {/* Pricing controls — box price + a passive market-freshness label.
          Market values are refreshed in the background on a schedule
          (PriceCharting cron), not on demand. Showing how stale the data
          is — without making the user wait for a refresh — was the
          intentional product call. */}
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-slate-200 bg-white px-4 py-3">
        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-slate-500">
            Box price
          </span>
          <div className="mt-0.5 flex items-center gap-2">
            <div className="relative">
              <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                $
              </span>
              <input
                inputMode="decimal"
                value={boxPrice}
                onChange={(e) => setBoxPrice(e.target.value)}
                onBlur={saveBoxPrice}
                placeholder="0.00"
                className="w-28 rounded-md border border-slate-300 py-1.5 pl-6 pr-2 text-sm focus:border-slate-500 focus:outline-none"
              />
            </div>
            {savingBox && <span className="text-[11px] text-slate-400">saving…</span>}
          </div>
        </label>

        <div className="text-right text-[11px] text-slate-500">
          {showMarketBadge ? (
            <>
              <div>
                Market values · {cardsWithMarket}/{cardCount} cards
              </div>
              {lastRefresh && (
                <div className="text-slate-400">
                  Updated {lastRefresh} · refreshes weekly
                </div>
              )}
            </>
          ) : (
            <div className="text-slate-400">
              Market values populate within a week of release
            </div>
          )}
        </div>
      </div>

      {/* Weight program — how the algorithm scores each card type. Sits at
          the bottom as reference material for anyone curious about the math
          behind the score card numbers above. */}
      {algorithm.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-tight-2 text-accent">
                Weight Program
              </div>
              <div className="text-base font-bold tracking-tight-2">
                How we score this break
              </div>
            </div>
            <div className="text-[11px] text-slate-500">
              <span className="font-semibold text-ink">{totalContentScore}</span>{" "}
              total Break Score
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {algorithm.map((b) => {
              const pct =
                totalContentScore > 0
                  ? (b.contribution / totalContentScore) * 100
                  : 0;
              return (
                <div
                  key={b.label}
                  className="rounded-lg border border-slate-200 bg-bone p-3"
                >
                  <div className="text-[11px] font-bold uppercase tracking-tight-2 text-slate-500">
                    {b.label}
                  </div>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="text-2xl font-extrabold tracking-tight-3">
                      {b.weight}
                    </span>
                    <span className="text-[10px] font-bold uppercase tracking-tight-2 text-slate-400">
                      pts/card
                    </span>
                  </div>
                  <div className="mt-2 text-[11px] text-slate-500">
                    {b.count} {b.count === 1 ? "card" : "cards"} ·{" "}
                    <span className="font-semibold text-ink">
                      {b.contribution}
                    </span>{" "}
                    pts ({pct.toFixed(0)}%)
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
