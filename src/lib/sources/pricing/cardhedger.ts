/**
 * Card Hedger API client.
 *
 * Auth: header `X-API-Key: <key>`. Key lives in env var `CARD_HEDGER_API`.
 * Docs: https://api.cardhedger.com/docs
 *
 * Endpoints we wrap (per Card Hedger's recommended-calls list):
 *
 *   Discovery:
 *     - card-match       — fuzzy-match free text → card_id + confidence
 *     - card-search      — paginated card list with filters
 *     - card-details     — full record for a known card_id
 *
 *   Pricing — note from CH: card-search / card-details only return TOP
 *   grade as a display hint. For real pricing, use one of:
 *     - prices-by-card           — historical time series (chart data)
 *     - all-prices-by-card       — latest price per grade in one call
 *     - comps                    — recent comparable sales w/ anomaly filter
 *     - 90day-prices-by-grade    — search-based price report (no card_id)
 *
 *   Player-level signal:
 *     - sales-stats-by-player    — bucketed sales counts + dollar volume
 *     - top-movers               — weekly trending cards
 *
 * All amounts converted to USD cents at the boundary so callers never
 * see floats. Card Hedger returns dollar-floats in JSON.
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
  query: string;
  /** Optional category hint to narrow the search ("Baseball", "Basketball",
   * etc.). Mirrors the categories Card Hedger surfaces in its UI. */
  category?: string;
};

export type CardMatchResult = {
  cardId: string | null;
  /** 0-1 confidence score. Below ~0.7 we treat as a miss. */
  confidence: number;
  /** Card description Card Hedger thinks matches — useful for QA when
   * confidence is borderline. */
  description: string | null;
  /** LLM reasoning explaining why this candidate was picked over the
   *  others. Surfaced by CH for QA / debugging — keep it threaded
   *  through so we can log it when the match is borderline. */
  reasoning: string | null;
  player: string | null;
  set: string | null;
  cardNumber: string | null;
  variant: string | null;
  imageUrl: string | null;
};

export async function matchCard(input: CardMatchInput): Promise<CardMatchResult> {
  const res = await fetch(`${CH_BASE}/v1/cards/card-match`, {
    method: "POST",
    headers: authHeader(),
    body: JSON.stringify({
      query: input.query,
      category: input.category,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Card Hedger card-match failed: ${res.status} ${await res.text()}`,
    );
  }
  // CH wraps the matched card in a `match` object alongside the
  // candidates_evaluated count. The match itself uses the same
  // field names as card-search/card-details (number, variant, image).
  const json = (await res.json()) as {
    match?:
      | (CHCardRow & {
          confidence?: number;
          reasoning?: string;
        })
      | null;
  };
  const m = json.match;
  return {
    cardId: m?.card_id ?? null,
    confidence: m?.confidence ?? 0,
    description: m?.description ?? null,
    reasoning: m?.reasoning ?? null,
    player: m?.player ?? null,
    set: m?.set ?? null,
    cardNumber: m?.number ?? null,
    variant: m?.variant ?? null,
    imageUrl: m?.image ?? null,
  };
}

// ---------------------------------------------------------------------------
// Card discovery
// ---------------------------------------------------------------------------

export type CardSearchInput = {
  search?: string;
  category?: string;
  set?: string;
  player?: string;
  rookie?: "yes" | "no";
  rawImagesOnly?: boolean;
  page?: number;
  pageSize?: number;
};

export type CardSearchHit = {
  cardId: string;
  description: string;
  set: string | null;
  player: string | null;
  cardNumber: string | null;
  rookie: boolean;
  imageUrl: string | null;
};

export type CardSearchResponse = {
  pages: number;
  count: number;
  cards: CardSearchHit[];
};

export async function searchCards(
  input: CardSearchInput,
): Promise<CardSearchResponse> {
  const res = await fetch(`${CH_BASE}/v1/cards/card-search`, {
    method: "POST",
    headers: authHeader(),
    body: JSON.stringify({
      search: input.search,
      category: input.category,
      set: input.set,
      player: input.player,
      rookie: input.rookie,
      raw_images_only: input.rawImagesOnly,
      page: input.page ?? 1,
      page_size: input.pageSize ?? 25,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Card Hedger card-search failed: ${res.status} ${await res.text()}`,
    );
  }
  const json = (await res.json()) as {
    pages?: number;
    count?: number;
    cards?: CHCardRow[];
  };
  return {
    pages: json.pages ?? 0,
    count: json.count ?? 0,
    cards: (json.cards ?? []).flatMap(parseCardRow),
  };
}

/**
 * Raw shape Card Hedger returns inside the `cards` array on
 * card-search, card-details, and 90day-prices-by-grade. Field names
 * follow CH's UI labels — `number` (not card_number), `variant` (not
 * variation), `image` (not image_url). Prices in `prices` are top
 * grade only — display use; never the source of truth.
 */
type CHCardRow = {
  card_id?: string;
  description?: string;
  player?: string | null;
  set?: string | null;
  number?: string | null;
  variant?: string | null;
  category?: string | null;
  category_group?: string | null;
  set_type?: string | null;
  rookie?: boolean;
  image?: string | null;
  gain?: number;
  "7 Day Sales"?: number;
  "30 Day Sales"?: number;
  prices?: Array<{ grade?: string; price?: number | string }>;
};

function parseCardRow(c: CHCardRow): CardSearchHit[] {
  if (!c.card_id) return [];
  return [
    {
      cardId: c.card_id,
      description: c.description ?? "",
      set: c.set ?? null,
      player: c.player ?? null,
      cardNumber: c.number ?? null,
      rookie: c.rookie ?? false,
      imageUrl: c.image ?? null,
    },
  ];
}

export type CardDetails = {
  cardId: string;
  description: string;
  set: string | null;
  player: string | null;
  cardNumber: string | null;
  variant: string | null;
  category: string | null;
  setType: string | null;
  rookie: boolean;
  imageUrl: string | null;
  /** Top-grade prices only — display-only per CH's note. Use
   *  getAllPricesByCard / getPricesByCard for real pricing. */
  topPrices: Array<{ grade: string; cents: number }>;
  /** Sales counts at the card level. Useful directly for the chase
   *  view trend signal — high recent volume correlates with chase
   *  worthiness regardless of price drift. */
  sales7Day: number | null;
  sales30Day: number | null;
};

export async function getCardDetails(cardId: string): Promise<CardDetails> {
  const res = await fetch(`${CH_BASE}/v1/cards/card-details`, {
    method: "POST",
    headers: authHeader(),
    body: JSON.stringify({ card_id: cardId }),
  });
  if (!res.ok) {
    throw new Error(
      `Card Hedger card-details failed: ${res.status} ${await res.text()}`,
    );
  }
  // card-details returns the same envelope as card-search:
  // { pages, count, cards: [...] }. Take the first card.
  const json = (await res.json()) as {
    cards?: CHCardRow[];
  };
  const c = json.cards?.[0] ?? {};
  return {
    cardId: c.card_id ?? cardId,
    description: c.description ?? "",
    set: c.set ?? null,
    player: c.player ?? null,
    cardNumber: c.number ?? null,
    variant: c.variant ?? null,
    category: c.category ?? null,
    setType: c.set_type ?? null,
    rookie: c.rookie ?? false,
    imageUrl: c.image ?? null,
    sales7Day: c["7 Day Sales"] ?? null,
    sales30Day: c["30 Day Sales"] ?? null,
    topPrices: (c.prices ?? []).flatMap((p) => {
      const cents = toCents(p.price);
      if (cents == null || !p.grade) return [];
      return [{ grade: p.grade, cents }];
    }),
  };
}

// ---------------------------------------------------------------------------
// Pricing — single card
// ---------------------------------------------------------------------------

export type AllPricesByCard = {
  cardId: string;
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
  cardId: string,
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
    card_id?: string;
    prices?: Array<{
      grade?: string;
      grader?: string | null;
      price?: number;
      display_order?: number;
    }>;
  };
  return {
    cardId: json.card_id ?? cardId,
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
// Pricing — historical time series (chart data)
// ---------------------------------------------------------------------------

export type PricePoint = {
  /** ISO date string. */
  closingDate: string;
  grade: string;
  cents: number;
};

/** Daily close prices for a card + grade. Default window is 180 days
 *  per CH; pass `days` to override. Powers chart views. */
export async function getPricesByCard(args: {
  cardId: string;
  grade: string;
  days?: number;
}): Promise<PricePoint[]> {
  const res = await fetch(`${CH_BASE}/v1/cards/prices-by-card`, {
    method: "POST",
    headers: authHeader(),
    body: JSON.stringify({
      card_id: args.cardId,
      grade: args.grade,
      days: args.days,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Card Hedger prices-by-card failed: ${res.status} ${await res.text()}`,
    );
  }
  const json = (await res.json()) as {
    prices?: Array<{
      closing_date?: string;
      Grade?: string;
      grade?: string;
      price?: number;
    }>;
  };
  return (json.prices ?? []).flatMap((p) => {
    const cents = toCents(p.price);
    if (cents == null || !p.closing_date) return [];
    return [
      {
        closingDate: p.closing_date,
        grade: p.Grade ?? p.grade ?? args.grade,
        cents,
      },
    ];
  });
}

// ---------------------------------------------------------------------------
// Pricing — comparable sales (anomaly-filtered)
// ---------------------------------------------------------------------------

export type CompsResult = {
  cardId: string;
  grade: string;
  /** Anomaly-filtered comp price in cents. */
  compCents: number | null;
  highCents: number | null;
  lowCents: number | null;
  countUsed: number;
  countRequested: number;
  rawPrices?: Array<{
    cents: number;
    saleDate: string | null;
    source: string | null;
  }>;
};

/** Recent comparable sales with CH's anomaly filter applied. The
 *  resulting `compCents` is what you'd quote when valuing a card to a
 *  buyer; raw_prices (when requested) are the underlying sales. */
export async function getComps(args: {
  cardId: string;
  grade: string;
  count: number;
  timeWeighted?: boolean;
  includeRawPrices?: boolean;
}): Promise<CompsResult> {
  const res = await fetch(`${CH_BASE}/v1/cards/comps`, {
    method: "POST",
    headers: authHeader(),
    body: JSON.stringify({
      card_id: args.cardId,
      grade: args.grade,
      count: args.count,
      time_weighted: args.timeWeighted ?? true,
      include_raw_prices: args.includeRawPrices ?? false,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Card Hedger comps failed: ${res.status} ${await res.text()}`,
    );
  }
  const json = (await res.json()) as {
    comp_price?: number;
    high?: number;
    low?: number;
    count_used?: number;
    count_requested?: number;
    raw_prices?: Array<{
      price?: number;
      sale_date?: string | null;
      source?: string | null;
    }>;
  };
  return {
    cardId: args.cardId,
    grade: args.grade,
    compCents: toCents(json.comp_price),
    highCents: toCents(json.high),
    lowCents: toCents(json.low),
    countUsed: json.count_used ?? 0,
    countRequested: json.count_requested ?? args.count,
    rawPrices: json.raw_prices?.flatMap((r) => {
      const cents = toCents(r.price);
      if (cents == null) return [];
      return [
        {
          cents,
          saleDate: r.sale_date ?? null,
          source: r.source ?? null,
        },
      ];
    }),
  };
}

// ---------------------------------------------------------------------------
// Pricing — search-based 90-day report (no card_id required)
// ---------------------------------------------------------------------------

export type NinetyDayPriceRow = {
  cardId: string;
  description: string;
  grade: string;
  cents: number | null;
  /** Average over the trailing 90-day window. */
  avgCents: number | null;
};

/** 90-day average price across cards matching a search. Useful for
 *  one-shot "what's this set of Ohtani Topps Chrome going for?" queries
 *  where we haven't matched individual cards yet. */
export async function get90DayPricesByGrade(args: {
  search?: string;
  player?: string;
  set?: string;
  category?: string;
  grade: string;
  page?: number;
  pageSize?: number;
}): Promise<NinetyDayPriceRow[]> {
  const res = await fetch(
    `${CH_BASE}/v1/cards/90day-prices-by-grade${args.search ? "-search" : ""}`,
    {
      method: "POST",
      headers: authHeader(),
      body: JSON.stringify({
        search: args.search,
        player: args.player,
        set: args.set,
        category: args.category,
        grade: args.grade,
        page: args.page ?? 1,
        page_size: args.pageSize ?? 25,
      }),
    },
  );
  if (!res.ok) {
    throw new Error(
      `Card Hedger 90day-prices-by-grade failed: ${res.status} ${await res.text()}`,
    );
  }
  const json = (await res.json()) as {
    cards?: Array<{
      card_id?: string;
      description?: string;
      grade?: string;
      price?: number;
      avg_price?: number;
    }>;
  };
  return (json.cards ?? []).flatMap((c) => {
    if (c.card_id == null) return [];
    return [
      {
        cardId: c.card_id,
        description: c.description ?? "",
        grade: c.grade ?? args.grade,
        cents: toCents(c.price),
        avgCents: toCents(c.avg_price),
      },
    ];
  });
}

// ---------------------------------------------------------------------------
// Pricing — confidence-bounded estimate
// ---------------------------------------------------------------------------

export type PriceEstimate = {
  cardId: string;
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
  cardId: string,
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
  /** ISO date string — end of the bucket (inclusive). */
  bucketEnd: string;
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
        // CH labels these `start` and `end` (NOT bucket_start / bucket_end).
        // The OpenAPI spec used `bucket_start`, but the live API returns
        // `start`. Tested against JJ Wetherholt sales-stats response.
        start?: string;
        end?: string;
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
      bucketStart: b.start ?? "",
      bucketEnd: b.end ?? "",
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
  cardId: string;
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
      card_id?: string;
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
