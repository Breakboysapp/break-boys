"use client";

import { classifyCard } from "@/lib/scoring";

type CardRow = {
  id: string;
  playerName: string;
  cardNumber: string;
  variation: string | null;
  marketValueCents: number | null;
};

type Group = {
  team: string;
  cards: CardRow[];
};

type PlayerRow = {
  playerName: string;
  byBucket: Map<string, string[]>; // bucket label → card numbers
  totalCards: number;
  totalScore: number;
  marketCents: number; // sum of marketValueCents for this player's cards
  marketSamples: number; // # of cards w/ market data — for transparency
};

type BucketMeta = { label: string; weight: number; count: number };

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Per-team checklist tracker. One row per player; columns are the algorithm
 * buckets (Auto / Ivory Auto / Damascus / Base / etc.) that exist on the
 * team. Each cell lists the actual card numbers that player has in that
 * bucket — so a buyer can tick them off as they pull cards from the break.
 *
 * Same sticky-header pattern as the BREAK BOYS SCORE CARD: sticky player
 * column on the left, opaque cells, horizontal scroll for narrow screens.
 */
export default function CardListBoard({ groups }: { groups: Group[] }) {
  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <PlayerSheet key={g.team} team={g.team} cards={g.cards} />
      ))}
    </div>
  );
}

function PlayerSheet({ team, cards }: { team: string; cards: CardRow[] }) {
  const { buckets, players, totalMarketCents, hasMarket } = computePlayerSheet(cards);
  if (cards.length === 0) {
    return (
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <header className="border-b border-slate-200 bg-ink px-5 py-3 text-white">
          <h3 className="text-base font-bold tracking-tight-2">{team}</h3>
        </header>
        <div className="p-6 text-center text-sm text-slate-500">
          No cards on this team.
        </div>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 bg-ink px-5 py-3 text-white">
        <h3 className="text-base font-bold tracking-tight-2">{team}</h3>
        <div className="text-[11px] font-semibold uppercase tracking-tight-2 text-white/70">
          {players.length} {players.length === 1 ? "player" : "players"} ·{" "}
          {cards.length} {cards.length === 1 ? "card" : "cards"}
          {hasMarket && (
            <>
              {" "}
              · <span className="text-white">{formatUsd(totalMarketCents)}</span>{" "}
              market
            </>
          )}
        </div>
      </header>

      <div className="max-h-[640px] overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-30 bg-bone text-slate-700">
            <tr>
              <th className="sticky left-0 z-40 min-w-[180px] bg-bone px-3 py-2 text-left text-[10px] font-bold uppercase tracking-tight-2">
                Player
              </th>
              {buckets.map((b) => (
                <th
                  key={b.label}
                  className="bg-bone px-3 py-2 text-left text-[10px] font-bold uppercase tracking-tight-2"
                  title={`${b.weight} pts/card · ${b.count} cards on this team`}
                >
                  <div className="leading-tight">{b.label}</div>
                  <div className="text-[9px] font-semibold text-slate-400">
                    ×{b.weight}
                  </div>
                </th>
              ))}
              <th className="bg-bone px-3 py-2 text-right text-[10px] font-bold uppercase tracking-tight-2">
                Score
              </th>
              {hasMarket && (
                <th className="bg-accent px-3 py-2 text-right text-[10px] font-bold uppercase tracking-tight-2 text-white">
                  Market $
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <tr
                key={p.playerName}
                className="border-b border-slate-100 last:border-0"
              >
                <td className="sticky left-0 z-20 min-w-[180px] bg-white px-3 py-2 font-semibold tracking-tight-2">
                  {p.playerName}
                </td>
                {buckets.map((b) => {
                  const nums = p.byBucket.get(b.label) ?? [];
                  return (
                    <td
                      key={b.label}
                      className={`bg-white px-3 py-2 text-xs ${
                        nums.length === 0 ? "text-slate-300" : "text-slate-700"
                      }`}
                    >
                      {nums.length === 0 ? (
                        "—"
                      ) : (
                        <span className="font-mono">{nums.join(", ")}</span>
                      )}
                    </td>
                  );
                })}
                <td className="bg-white px-3 py-2 text-right font-bold tabular-nums tracking-tight-2 text-slate-700">
                  {p.totalScore}
                </td>
                {hasMarket && (
                  <td
                    className="bg-accent/5 px-3 py-2 text-right font-extrabold tabular-nums tracking-tight-2 text-ink"
                    title={
                      p.marketSamples > 0
                        ? `${p.marketSamples} of ${p.totalCards} cards have eBay data`
                        : "no eBay data yet"
                    }
                  >
                    {p.marketCents > 0 ? (
                      formatUsd(p.marketCents)
                    ) : (
                      <span className="text-xs text-slate-300">—</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function computePlayerSheet(cards: CardRow[]): {
  buckets: BucketMeta[];
  players: PlayerRow[];
  totalMarketCents: number;
  hasMarket: boolean;
} {
  // First pass: bucket weights + counts (for column ordering).
  const bucketMap = new Map<string, BucketMeta>();
  for (const c of cards) {
    const cls = classifyCard(c.cardNumber, c.variation);
    const existing = bucketMap.get(cls.label);
    if (existing) existing.count++;
    else bucketMap.set(cls.label, { label: cls.label, weight: cls.weight, count: 1 });
  }
  const buckets = [...bucketMap.values()].sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    return b.count - a.count;
  });
  const weightByLabel = new Map(buckets.map((b) => [b.label, b.weight]));

  // Second pass: per-player rows + market rollup.
  const playerMap = new Map<string, PlayerRow>();
  let totalMarketCents = 0;
  let hasMarket = false;
  for (const c of cards) {
    const cls = classifyCard(c.cardNumber, c.variation);
    let row = playerMap.get(c.playerName);
    if (!row) {
      row = {
        playerName: c.playerName,
        byBucket: new Map(),
        totalCards: 0,
        totalScore: 0,
        marketCents: 0,
        marketSamples: 0,
      };
      playerMap.set(c.playerName, row);
    }
    let nums = row.byBucket.get(cls.label);
    if (!nums) {
      nums = [];
      row.byBucket.set(cls.label, nums);
    }
    nums.push(c.cardNumber);
    row.totalCards++;
    row.totalScore += weightByLabel.get(cls.label) ?? cls.weight;
    if (c.marketValueCents != null && c.marketValueCents > 0) {
      row.marketCents += c.marketValueCents;
      row.marketSamples++;
      totalMarketCents += c.marketValueCents;
      hasMarket = true;
    }
  }

  // Sort by market value when present (highest market first), fall back to
  // content score for players without market data.
  const players = [...playerMap.values()].sort((a, b) => {
    if (hasMarket && (a.marketCents > 0 || b.marketCents > 0)) {
      return b.marketCents - a.marketCents || b.totalScore - a.totalScore;
    }
    return b.totalScore - a.totalScore;
  });
  return { buckets, players, totalMarketCents, hasMarket };
}
