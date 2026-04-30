/**
 * Fixed-algorithm pricing model.
 *
 * Every card is auto-classified by its cardNumber prefix; weights are
 * baked in here, not stored per product. The algorithm has no per-product
 * knobs — by design. The only inputs it takes from the user are the box
 * price (per product) and team wholesale (per team contract).
 *
 *   weight(card) = lookup(prefix(card.cardNumber))
 *   contentScore(team) = Σ weight(c) for c in team's cards
 *   marketValue(team)  = Σ c.marketValueCents (when present)
 *
 *   contentShare(team) = contentScore / Σ contentScore
 *   marketShare(team)  = marketValue / Σ marketValue
 *   coverage(team)     = (cards w/ marketValue) / (total cards on team)
 *   effAlpha(team)     = α + (1 - α) × (1 - coverage(team))
 *
 *   rawShare(team) = effAlpha × contentShare + (1 - effAlpha) × marketShare
 *   share(team)    = rawShare / Σ rawShare    (re-normalized to sum to 1)
 *   retail(team)   = share(team) × Product.boxPriceCents
 *
 * α is fixed at PRICING_BLEND_ALPHA below — adjust there if the
 * algorithm itself needs to change. Coverage adjustment ensures thin-data
 * teams stay anchored to content even when α leans toward market.
 */

const NUMERIC = /^\d+$/;

/**
 * The single algorithm-level mix knob. Lives in code, not in the DB,
 * because the user said: don't make pricing variable per product.
 *
 * 0.5 = balanced content + market; thin-coverage teams self-correct via
 * the per-team coverage shift.
 */
export const PRICING_BLEND_ALPHA = 0.5;

/** Default weight for unknown alphabetic prefixes (treated as inserts). */
const DEFAULT_INSERT_WEIGHT = 4;

/**
 * Card-type weights by prefix pattern, in priority order. First matching
 * pattern wins. Numeric card numbers (no prefix) get the BASE_WEIGHT.
 *
 * Tune the algorithm by editing this table. Do not expose to the UI.
 *
 * Source: hobby convention plus the Break Boys 2026 Topps Chrome Black
 * weighting scheme (Ivory=15, Dual=12, Std Auto=10, SF=8, Paint=6, Inserts=4, Base=1).
 */
const PREFIX_WEIGHTS: Array<{ match: RegExp; label: string; weight: number }> = [
  // Topps Chrome Black autographs
  { match: /^IVA-/i, label: "Ivory Auto", weight: 15 },
  { match: /^PDPA-/i, label: "Pitch Black Dual Auto", weight: 12 },
  { match: /^CBA-/i, label: "Chrome Black Auto", weight: 10 },
  { match: /^SFA-/i, label: "Super Futures Auto", weight: 8 },
  { match: /^PIA-/i, label: "Paint It Auto", weight: 6 },
  // Topps Chrome Black inserts
  { match: /^DAM-/i, label: "Damascus", weight: 4 },
  { match: /^NOC-/i, label: "Nocturnal", weight: 4 },
  { match: /^DOD-/i, label: "Depth of Darkness", weight: 4 },
  { match: /^CBHA-/i, label: "Home Field", weight: 4 },
  // Generic Topps Chrome / Bowman conventions
  { match: /AUTO/i, label: "Auto", weight: 10 },
  { match: /^RC-/i, label: "Rookie Insert", weight: 4 },
];

const BASE_WEIGHT = 1;

export type CardLite = {
  cardNumber: string;
  team: string;
  variation?: string | null;
};

/**
 * Coarse fallback weights when we know the broad category from the xlsx
 * sheet name (`card.variation`) but the card number prefix is unfamiliar.
 *
 * Beckett's xlsx labels each sheet with what it contains — Base,
 * Autographs, Memorabilia, Inserts, Variations, etc. Even when the prefix
 * (e.g., "TBA-AJ" for 2025-26 Topps Basketball Auto) isn't in the
 * PREFIX_WEIGHTS table, the sheet still tells us "this is an auto." This
 * map keeps autos out of the "Insert" bucket on products we haven't
 * hand-tuned prefixes for.
 */
const VARIATION_FALLBACKS: Array<{ match: RegExp; label: string; weight: number }> = [
  // Match more specific labels first so "Memorabilia" doesn't get caught by "*Auto*"
  { match: /memorabilia|relic|patch/i, label: "Memorabilia", weight: 6 },
  { match: /dual\s*auto|pitch\s*black\s*dual/i, label: "Dual Auto", weight: 12 },
  { match: /super\s*futures/i, label: "Super Futures Auto", weight: 8 },
  { match: /paint\s*it/i, label: "Paint It Auto", weight: 6 },
  { match: /ivory/i, label: "Ivory Auto", weight: 15 },
  { match: /autograph|\bauto\b/i, label: "Auto", weight: 10 },
  { match: /rookie\s*design\s*variation|rdv/i, label: "Rookie Design Variation", weight: 4 },
];

/**
 * Classify a card. Priority:
 *   1. Numeric card number → Base
 *   2. Known cardNumber prefix → fixed weight from PREFIX_WEIGHTS
 *   3. Known variation (xlsx sheet name) → fallback weight from
 *      VARIATION_FALLBACKS (autos, memorabilia, etc.)
 *   4. Default → "Insert" weight 4
 *
 * Variation is optional — older callsites can still pass just the
 * cardNumber for backward compat.
 */
export function classifyCard(
  cardNumber: string,
  variation?: string | null,
): { label: string; weight: number } {
  if (NUMERIC.test(cardNumber)) return { label: "Base", weight: BASE_WEIGHT };
  for (const p of PREFIX_WEIGHTS) {
    if (p.match.test(cardNumber)) return { label: p.label, weight: p.weight };
  }
  if (variation) {
    for (const p of VARIATION_FALLBACKS) {
      if (p.match.test(variation)) return { label: p.label, weight: p.weight };
    }
  }
  return { label: "Insert", weight: DEFAULT_INSERT_WEIGHT };
}

export type AlgorithmBucket = {
  label: string;
  weight: number;
  count: number;
  /** count × weight — how many points this bucket contributes to the product total */
  contribution: number;
};

export type BreakdownRow = {
  /** The grouping subject — team name or player name depending on view. */
  name: string;
  byBucket: Record<string, number>; // bucket label → count of cards
  totalCards: number;
  totalScore: number;
};

/**
 * Per-subject × per-bucket cross-tab. Generalized over the grouping
 * dimension so the score card can render either:
 *   - "team" view (default) — for traditional team breaks
 *   - "playerName" view     — for player-pick breaks (common in NFL)
 *
 * Returns the bucket order (sorted by weight desc) so column rendering is
 * consistent across both views.
 */
export function computeBreakdown(
  cards: {
    cardNumber: string;
    team: string;
    playerName: string;
    variation?: string | null;
  }[],
  groupBy: "team" | "playerName" = "team",
): {
  buckets: AlgorithmBucket[];
  rows: BreakdownRow[];
} {
  const buckets = summarizeAlgorithmFor(cards);
  const bucketLabels = buckets.map((b) => b.label);
  const bucketWeightByLabel = new Map(buckets.map((b) => [b.label, b.weight]));

  const rowMap = new Map<string, BreakdownRow>();
  for (const c of cards) {
    const subject = groupBy === "team" ? c.team : c.playerName;
    if (!subject) continue;
    const cls = classifyCard(c.cardNumber, c.variation);
    let row = rowMap.get(subject);
    if (!row) {
      row = {
        name: subject,
        byBucket: Object.fromEntries(bucketLabels.map((l) => [l, 0])),
        totalCards: 0,
        totalScore: 0,
      };
      rowMap.set(subject, row);
    }
    row.byBucket[cls.label] = (row.byBucket[cls.label] ?? 0) + 1;
    row.totalCards++;
    row.totalScore += bucketWeightByLabel.get(cls.label) ?? cls.weight;
  }

  const rows = [...rowMap.values()].sort((a, b) => b.totalScore - a.totalScore);
  return { buckets, rows };
}

/** @deprecated use computeBreakdown(cards, "team") */
export function computeTeamBreakdown(
  cards: {
    cardNumber: string;
    team: string;
    playerName: string;
    variation?: string | null;
  }[],
) {
  return computeBreakdown(cards, "team");
}

/**
 * Summarize how the algorithm classifies the cards in a given product.
 * Powers the "Weight program" UI on the product page — surfaces which
 * card types exist in this product, their fixed weights, and how much
 * each bucket contributes to the total content score.
 */
export function summarizeAlgorithmFor(
  cards: { cardNumber: string; variation?: string | null }[],
): AlgorithmBucket[] {
  const buckets = new Map<string, AlgorithmBucket>();
  for (const c of cards) {
    const cls = classifyCard(c.cardNumber, c.variation);
    const existing = buckets.get(cls.label);
    if (existing) {
      existing.count++;
      existing.contribution += cls.weight;
    } else {
      buckets.set(cls.label, {
        label: cls.label,
        weight: cls.weight,
        count: 1,
        contribution: cls.weight,
      });
    }
  }
  return [...buckets.values()].sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    return b.count - a.count;
  });
}

/**
 * Compute team scores from a list of cards using the fixed weighting.
 */
export function computeTeamScores(cards: CardLite[]): Map<string, number> {
  const scores = new Map<string, number>();
  for (const c of cards) {
    const { weight } = classifyCard(c.cardNumber, c.variation);
    scores.set(c.team, (scores.get(c.team) ?? 0) + weight);
  }
  return scores;
}

export function computeTeamMarketValue(
  cards: Array<CardLite & { marketValueCents: number | null }>,
): {
  perTeam: Map<string, number>;
  coveragePerTeam: Map<string, { covered: number; total: number }>;
} {
  const perTeam = new Map<string, number>();
  const coveragePerTeam = new Map<string, { covered: number; total: number }>();
  for (const c of cards) {
    const cov = coveragePerTeam.get(c.team) ?? { covered: 0, total: 0 };
    cov.total++;
    if (c.marketValueCents != null && c.marketValueCents > 0) {
      cov.covered++;
      perTeam.set(c.team, (perTeam.get(c.team) ?? 0) + c.marketValueCents);
    } else if (!perTeam.has(c.team)) {
      perTeam.set(c.team, 0);
    }
    coveragePerTeam.set(c.team, cov);
  }
  return { perTeam, coveragePerTeam };
}

export type CompositeRow = {
  team: string;
  contentScore: number;
  contentShare: number;
  marketCents: number;
  marketShare: number;
  marketCoverage: number;
  blendedShare: number;
  retailCents: number | null;
};

/**
 * Apply the fixed composite blend. The α is hard-coded at module load —
 * call sites don't pass it. Per-team coverage is computed and re-normalized
 * here so shares always sum to 1.
 */
export function computeComposite(args: {
  contentScores: Map<string, number>;
  marketValues: Map<string, number>;
  marketCoverage: Map<string, { covered: number; total: number }>;
  boxPriceCents: number | null;
}): CompositeRow[] {
  const totalContent = [...args.contentScores.values()].reduce((s, v) => s + v, 0);
  const totalMarket = [...args.marketValues.values()].reduce((s, v) => s + v, 0);
  const teams = new Set<string>([...args.contentScores.keys(), ...args.marketValues.keys()]);
  const α = PRICING_BLEND_ALPHA;

  const pre: Array<
    Omit<CompositeRow, "blendedShare" | "retailCents"> & { rawBlendedShare: number }
  > = [];
  for (const team of teams) {
    const content = args.contentScores.get(team) ?? 0;
    const market = args.marketValues.get(team) ?? 0;
    const cov = args.marketCoverage.get(team);
    const coverage = cov && cov.total > 0 ? cov.covered / cov.total : 0;

    const contentShare = totalContent > 0 ? content / totalContent : 0;
    const marketShare = totalMarket > 0 ? market / totalMarket : 0;
    const effAlpha = α + (1 - α) * (1 - coverage);
    const rawBlendedShare = effAlpha * contentShare + (1 - effAlpha) * marketShare;

    pre.push({
      team,
      contentScore: content,
      contentShare,
      marketCents: market,
      marketShare,
      marketCoverage: coverage,
      rawBlendedShare,
    });
  }

  const rawTotal = pre.reduce((s, r) => s + r.rawBlendedShare, 0);
  const rows: CompositeRow[] = pre.map((r) => {
    const blendedShare = rawTotal > 0 ? r.rawBlendedShare / rawTotal : 0;
    const retailCents =
      args.boxPriceCents != null
        ? Math.round(blendedShare * args.boxPriceCents)
        : null;
    return {
      team: r.team,
      contentScore: r.contentScore,
      contentShare: r.contentShare,
      marketCents: r.marketCents,
      marketShare: r.marketShare,
      marketCoverage: r.marketCoverage,
      blendedShare,
      retailCents,
    };
  });
  rows.sort((a, b) => b.blendedShare - a.blendedShare);
  return rows;
}
