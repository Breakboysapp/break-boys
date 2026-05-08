/**
 * Per-player rollup for the Chase view. Runs server-side in the
 * product page so we ship ~50 player rows to the client instead of
 * the raw ~1,000-card array (saved ~1MB of HTML on 2026 Bowman).
 *
 * The rollup logic was previously in ChaseScoreboard.tsx as a
 * useMemo'd client-side compute. Lifting it to the server cuts
 * client JS work AND payload size — Mobile Safari was choking on
 * the 1.18 MB HTML for 2026 Bowman.
 */

import { isAutoCard } from "@/lib/scoring";

export type ChaseInputCard = {
  playerName: string;
  team: string;
  isRookie: boolean;
  cardNumber: string;
  variation: string | null;
  ungradedCents: number | null;
  psa10Cents: number | null;
  printRun: number | null;
  popG10: number | null;
  popTotal: number | null;
  imageUrl: string | null;
};

export type PlayerRollup = {
  playerName: string;
  team: string;
  isRookie: boolean;
  cardCount: number;
  autoCount: number;
  marketTrendPct: number | null;
  topPsa10Cents: number;
  topVariation: string | null;
  topCardNumber: string;
  topImageUrl: string | null;
  medianPsa10Cents: number;
  marketScore: number;
  inSetMarketScore: number;
  popG10Sum: number;
  popTotalSum: number;
  gemRate: number | null;
};

const RAW_TO_GRADED_MULT = 6;

function effectiveValue(c: ChaseInputCard): number {
  const psa = c.psa10Cents ?? 0;
  const raw = (c.ungradedCents ?? 0) * RAW_TO_GRADED_MULT;
  return Math.max(psa, raw);
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function rollupChasePlayers(
  cards: ChaseInputCard[],
): PlayerRollup[] {
  const m = new Map<string, PlayerRollup & { _psa10s: number[] }>();
  for (const c of cards) {
    const psa10 = effectiveValue(c);
    let row = m.get(c.playerName);
    if (!row) {
      row = {
        playerName: c.playerName,
        team: "—",
        isRookie: false,
        cardCount: 0,
        autoCount: 0,
        topPsa10Cents: 0,
        topVariation: null,
        topCardNumber: "",
        topImageUrl: null,
        marketTrendPct: null,
        medianPsa10Cents: 0,
        marketScore: 0,
        inSetMarketScore: 0,
        popG10Sum: 0,
        popTotalSum: 0,
        gemRate: null,
        _psa10s: [],
      };
      m.set(c.playerName, row);
    }
    row.cardCount++;
    if (isAutoCard(c.cardNumber, c.variation)) row.autoCount++;
    if (row.team === "—" && c.team && c.team !== "—") row.team = c.team;
    if (c.isRookie) row.isRookie = true;
    if (psa10 > 0) row._psa10s.push(psa10);
    const isFirstCardEver = row.topCardNumber === "";
    if (psa10 > row.topPsa10Cents || isFirstCardEver) {
      row.topPsa10Cents = psa10;
      row.topVariation = c.variation;
      row.topCardNumber = c.cardNumber;
      row.topImageUrl = c.imageUrl;
    }
    if (c.popG10 != null) row.popG10Sum += c.popG10;
    if (c.popTotal != null) row.popTotalSum += c.popTotal;
  }

  const players = [...m.values()];
  for (const p of players) p.medianPsa10Cents = median(p._psa10s);

  const blend = (top: number, mid: number) =>
    Math.log(top + 1) * 0.6 + Math.log(mid + 1) * 0.4;
  const maxBlend = Math.max(
    ...players.map((p) => blend(p.topPsa10Cents, p.medianPsa10Cents)),
  );
  if (maxBlend > 0) {
    for (const p of players) {
      const b = blend(p.topPsa10Cents, p.medianPsa10Cents);
      const score =
        b > 0 ? Math.max(1, Math.round((b / maxBlend) * 100)) : 0;
      p.marketScore = score;
      p.inSetMarketScore = score;
    }
  }
  for (const row of players) {
    row.gemRate =
      row.popTotalSum > 0 ? row.popG10Sum / row.popTotalSum : null;
  }
  // Strip the internal _psa10s field before returning so the
  // serialized payload doesn't carry per-player price arrays.
  return players
    .map(({ _psa10s: _, ...rest }) => rest)
    .sort((a, b) => b.marketScore - a.marketScore);
}
