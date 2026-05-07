/**
 * Card Hedger API client.
 *
 * Auth: header `X-API-Key: <key>`. Key lives in env var `CARD_HEDGER_API`.
 * Docs: https://api.cardhedger.com/docs
 *
 * Why we use it (in addition to PriceCharting):
 *   - Confidence-bounded price estimates (`price_low` / `price_high`)
 *     for cards without recent comps. PC returns a flat number or
 *     nothing.
 *   - Time-weighted comps with anomaly filtering — better signal for
 *     ultra-rare /1 sales than PC's median.
 *   - Player-level sales aggregates — directly powers the Chase view
 *     trend column with real volume data instead of our snapshot diff.
 *   - AI card matching (`card-match`) — accepts free-form text like
 *     "BCP-1 Ethan Holliday Chrome Refractor" and returns a card_id
 *     plus confidence. Could solve the variation-string mismatches we
 *     hit with PriceCharting's exact-string matching.
 *
 * What we DON'T use yet:
 *   - Image search (OCR + visual lookup) — interesting for inventory
 *     scanning workflows but not for the current Chase view scope.
 *   - Price update subscriptions — webhook-style; revisit when we have
 *     enough cards tracked to make polling expensive.
 *   - CSV export (Enterprise-only) — needs paid tier.
 *
 * All amounts are USD cents to match our internal money convention.
 * The Card Hedger API returns dollar-floats in JSON; we convert at the
 * boundary so callers never see floats.
 */

const CH_BASE = "https://api.cardhedger.com";

function authHeader(): Record<string, string> {
  const key = process.env.CARD_HEDGER_API;
  if (!key) {
    throw new Error(
      "CARD_HEDGER_API env var not set — Card Hedger integration disabled.",
    );
  }
  return {
    "X-API-Key": key,
    "Content-Type": "application/json",
  };
}

/** Convert "12.34" or 12.34 to 1234 cents; null/undefined/zero passes through. */
function toCents(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

// ---------------------------------------------------------------------------
// Card matching
// ---------------------------------------------------------------------------

export type CardMatchInput = {
  /** Free-form text describing the card. Best results when it includes
   * year, set, player name, card number, and any parallel info. */
  text: string;
  /** Optional category hint to narrow the search ("Baseball", "Basketball",
   * etc.). Mirrors the categories Card Hedger surfaces in its UI. */
  category?: string;
};

export type CardMatchResult = {
  cardId: number | null;
  /** 0-1 confidence score. Below ~0.7 we treat as a miss. */
  confidence: number;
  /** Card description Card Hedger thinks matches — useful for QA when
   * confidence is borderline. */
  description: string | null;
};

export async function matchCard(input: CardMatchInput): Promise<CardMatchResult> {
  const res = await fetch(`${CH_BASE}/v1/cards/card-match`, {
    method: "POST",
    headers: authHeader(),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(
      `Card Hedger card-match failed: ${res.status} ${await res.text()}`,
    );
  }
  const json = (await res.json()) as {
    card_id?: number | null;
    confidence?: number;
    description?: string | null;
  };
  return {
    cardId: json.card_id ?? null,
    confidence: json.confidence ?? 0,
    description: json.description ?? null,
  };
}

// ---------------------------------------------------------------------------
// Pricing — single card
// ---------------------------------------------------------------------------

export type AllPricesByCard = {
  cardId: number;
  prices: Array<{
    grade: string;
    grader: string | null;
    cents: number;
    displayOrder: number;
  }>;
};

/** Latest prices across every grade Card Hedger has data for on a given
 *  card. Use this to populate PSA 10 / PSA 9 / Raw / etc. in one round
 *  trip after we've matched the card. */
export async function getAllPricesByCard(
  cardId: number,
): Promise<AllPricesByCard> {
  const res = await fetch(`${CH_BASE}/v1/cards/all-prices-by-card`, {
    method: "POST",
    headers: authHeader(),
    body: JSON.stringify({ card_id: cardId }),
  });
  if (!res.ok) {
    throw new Error(
      `Card Hedger all-prices-by-card failed: ${res.status} ${await res.text()}`,
    );
  }
  const json = (await res.json()) as {
    card_id: number;
    prices?: Array<{
      grade?: string;
      grader?: string | null;
      price?: number;
      display_order?: number;
    }>;
  };
  return {
    cardId: json.card_id,
    prices: (json.prices ?? []).flatMap((p) => {
      const cents = toCents(p.price);
      if (cents == null || !p.grade) return [];
      return [
        {
          grade: p.grade,
          grader: p.grader ?? null,
          cents,
          displayOrder: p.display_order ?? 0,
        },
      ];
    }),
  };
}

// ---------------------------------------------------------------------------
// Pricing — confidence-bounded estimate
// ---------------------------------------------------------------------------

export type PriceEstimate = {
  cardId: number;
  grade: string;
  /** Best-guess price in cents. Null when the card has no comps and no
   *  modeled estimate could be produced. */
  cents: number | null;
  centsLow: number | null;
  centsHigh: number | null;
  /** 0-1 confidence. Card Hedger weights recency, sample size, and
   *  category coverage. */
  confidence: number;
  /** "comps" | "model" | "interpolated" — how the estimate was produced.
   *  Useful when surfacing data quality to the user. */
  method: string | null;
  freshnessDays: number | null;
};

export async function getPriceEstimate(
  cardId: number,
  grade: string,
): Promise<PriceEstimate> {
  const res = await fetch(`${CH_BASE}/v1/cards/price-estimate`, {
    method: "POST",
    headers: authHeader(),
    body: JSON.stringify({ card_id: cardId, grade }),
  });
  if (!res.ok) {
    throw new Error(
      `Card Hedger price-estimate failed: ${res.status} ${await res.text()}`,
    );
  }
  const json = (await res.json()) as {
    price?: number;
    price_low?: number;
    price_high?: number;
    confidence?: number;
    method?: string | null;
    freshness_days?: number | null;
  };
  return {
    cardId,
    grade,
    cents: toCents(json.price),
    centsLow: toCents(json.price_low),
    centsHigh: toCents(json.price_high),
    confidence: json.confidence ?? 0,
    method: json.method ?? null,
    freshnessDays: json.freshness_days ?? null,
  };
}

// ---------------------------------------------------------------------------
// Player-level signal — drives the Chase trend column once integrated
// ---------------------------------------------------------------------------

export type PlayerSalesBucket = {
  /** ISO date string — start of the bucket. */
  bucketStart: string;
  count: number;
  totalCents: number;
  averageCents: number;
  /** True when this bucket is still in-progress (today's day/week). */
  partial: boolean;
};

export type PlayerSalesStats = {
  player: string;
  interval: "day" | "week" | "month";
  buckets: PlayerSalesBucket[];
};

/**
 * Bucketed sales counts + dollar volume per player. Wires directly into
 * the Chase view's Trend column with much better signal than our current
 * snapshot diff: we get actual sales volume changes instead of inferring
 * from price drift.
 */
export async function getPlayerSalesStats(args: {
  players: string[];
  interval: "day" | "week" | "month";
  /** Number of buckets back from today. Capped: day≤90, week≤52, month≤24. */
  periods?: number;
  includeCurrent?: boolean;
}): Promise<PlayerSalesStats[]> {
  const res = await fetch(`${CH_BASE}/v1/cards/sales-stats-by-player`, {
    method: "POST",
    headers: authHeader(),
    body: JSON.stringify({
      players: args.players,
      interval: args.interval,
      periods: args.periods ?? (args.interval === "day" ? 30 : 12),
      include_current: args.includeCurrent ?? true,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Card Hedger sales-stats-by-player failed: ${res.status} ${await res.text()}`,
    );
  }
  const json = (await res.json()) as {
    interval?: string;
    results?: Array<{
      player?: string;
      buckets?: Array<{
        bucket_start?: string;
        count?: number;
        total_amount?: number;
        average_sale?: number;
        partial?: boolean;
      }>;
    }>;
  };
  const interval = (json.interval ?? args.interval) as PlayerSalesStats["interval"];
  return (json.results ?? []).map((r) => ({
    player: r.player ?? "",
    interval,
    buckets: (r.buckets ?? []).map((b) => ({
      bucketStart: b.bucket_start ?? "",
      count: b.count ?? 0,
      totalCents: toCents(b.total_amount) ?? 0,
      averageCents: toCents(b.average_sale) ?? 0,
      partial: b.partial ?? false,
    })),
  }));
}

// ---------------------------------------------------------------------------
// Trend signal for the homepage / explore views
// ---------------------------------------------------------------------------

export type TopMover = {
  cardId: number;
  description: string;
  grade: string | null;
  cents: number | null;
  /** % change over the rolling window Card Hedger uses. */
  gainPct: number;
};

/** Cards trending up over the last week. Card Hedger picks the window;
 *  we just consume the result. Useful for a future "What's hot this week"
 *  surface on the homepage. */
export async function getTopMovers(): Promise<TopMover[]> {
  const res = await fetch(`${CH_BASE}/v1/cards/top-movers`, {
    headers: authHeader(),
  });
  if (!res.ok) {
    throw new Error(
      `Card Hedger top-movers failed: ${res.status} ${await res.text()}`,
    );
  }
  const json = (await res.json()) as {
    cards?: Array<{
      card_id?: number;
      description?: string;
      grade?: string | null;
      price?: number;
      gain_pct?: number;
    }>;
  };
  return (json.cards ?? []).flatMap((c) => {
    if (c.card_id == null) return [];
    return [
      {
        cardId: c.card_id,
        description: c.description ?? "",
        grade: c.grade ?? null,
        cents: toCents(c.price),
        gainPct: c.gain_pct ?? 0,
      },
    ];
  });
}
