/**
 * PriceCharting API client for per-card market values.
 *
 * Auth: query-param `t=<token>`. Get a token by signing up at
 *   https://www.pricecharting.com/ → Account → API
 *
 * Endpoints we use:
 *   GET /api/product?t=TOKEN&q=<search>   — single best-match product
 *   GET /api/products?t=TOKEN&q=<search>  — multi-match (we use this when
 *                                           the single-product search misses
 *                                           and we want fuzzy matching)
 *
 * Price fields returned (all in CENTS — `1295` = $12.95):
 *   loose-price       — raw card / unboxed
 *   cib-price         — complete-in-box (mostly for video games)
 *   new-price         — sealed / new
 *   graded-price      — graded card aggregate
 *
 * For sports cards we use loose-price by default (raw card market value).
 *
 * Coverage caveat: PriceCharting is video-game / Pokemon / Magic heavy;
 * sports-card coverage is patchier than eBay would have been. Our refresh
 * loop reports per-card hits/misses so we know the actual rate.
 */

const PC_BASE = "https://www.pricecharting.com/api";
const PER_REQUEST_DELAY_MS = 150; // be polite — PC has fair-use limits

export type CardLookup = {
  cardId: string;
  cardNumber: string;
  playerName: string;
};

export type CardMarketValue = {
  cardId: string;
  medianCents: number | null;
  sampleSize: number; // 1 if matched, 0 if not — PC returns single-product not range
  matchedProductName?: string; // for transparency / debugging coverage
  matchedConsoleName?: string;
};

type PCProduct = {
  id?: string | number;
  "console-name"?: string;
  "product-name"?: string;
  "loose-price"?: number;
  "cib-price"?: number;
  "new-price"?: number;
  "graded-price"?: number;
  "manual-only-price"?: number;
  "box-only-price"?: number;
};

type PCMultiResponse = {
  status?: string;
  products?: PCProduct[];
};

export function pricechartingConfigured(): boolean {
  return Boolean(process.env.PRICECHARTING_TOKEN);
}

const NUMERIC = /^\d+$/;

/** Build the search query for one card. */
export function buildQuery(productName: string, card: CardLookup): string {
  // For inserts/autos with letter prefixes, the prefix is distinctive.
  // For numeric base cards, the prefix is just a number → too noisy on its own.
  const includeCardNumber = !NUMERIC.test(card.cardNumber);
  const parts = [productName, card.playerName];
  if (includeCardNumber) parts.push(card.cardNumber);
  return parts.filter(Boolean).join(" ");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function searchOne(args: {
  productName: string;
  card: CardLookup;
  token: string;
}): Promise<CardMarketValue> {
  const q = buildQuery(args.productName, args.card);
  // /api/product returns a SINGLE best match. We use the multi-product
  // endpoint instead because a single hit on a wrong "best match" is worse
  // than picking the closest of several candidates.
  const url = `${PC_BASE}/products?t=${encodeURIComponent(
    args.token,
  )}&q=${encodeURIComponent(q)}`;

  const res = await globalThis.fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    return { cardId: args.card.cardId, medianCents: null, sampleSize: 0 };
  }
  const json = (await res.json()) as PCMultiResponse;
  const products = json.products ?? [];
  if (products.length === 0) {
    return { cardId: args.card.cardId, medianCents: null, sampleSize: 0 };
  }

  // Pick the product whose console-name best contains our productName.
  // Fall back to the first hit if no clear winner.
  const productLower = args.productName.toLowerCase();
  const ranked = products
    .map((p) => {
      const consoleName = (p["console-name"] ?? "").toLowerCase();
      const productNameLower = (p["product-name"] ?? "").toLowerCase();
      const playerLower = args.card.playerName.toLowerCase();
      let score = 0;
      // Strong signal: the console-name contains our product name
      if (productLower && consoleName.includes(productLower.split(" ")[0])) score += 5;
      // Each shared word boosts the score
      for (const word of productLower.split(" ")) {
        if (word.length > 2 && consoleName.includes(word)) score++;
      }
      // Player name match in product-name
      if (playerLower && productNameLower.includes(playerLower)) score += 3;
      return { p, score };
    })
    .sort((a, b) => b.score - a.score);

  const best = ranked[0]?.p;
  if (!best) {
    return { cardId: args.card.cardId, medianCents: null, sampleSize: 0 };
  }

  // Prefer loose-price (raw card). PriceCharting returns prices in CENTS already.
  const loose = best["loose-price"];
  const graded = best["graded-price"];
  const newP = best["new-price"];
  const price = loose ?? graded ?? newP ?? null;
  if (!price || price <= 0) {
    return { cardId: args.card.cardId, medianCents: null, sampleSize: 0 };
  }

  return {
    cardId: args.card.cardId,
    medianCents: price,
    sampleSize: 1,
    matchedProductName: best["product-name"],
    matchedConsoleName: best["console-name"],
  };
}

export async function fetchCardValues(args: {
  productName: string;
  cards: CardLookup[];
}): Promise<CardMarketValue[]> {
  const token = process.env.PRICECHARTING_TOKEN;
  if (!token) {
    throw new Error("PRICECHARTING_TOKEN not set");
  }
  const out: CardMarketValue[] = [];
  for (let i = 0; i < args.cards.length; i++) {
    try {
      const r = await searchOne({
        productName: args.productName,
        card: args.cards[i],
        token,
      });
      out.push(r);
    } catch (err) {
      console.warn(
        `[pricecharting] card ${args.cards[i].cardNumber} (${args.cards[i].playerName}) failed: ${
          err instanceof Error ? err.message : err
        }`,
      );
      out.push({
        cardId: args.cards[i].cardId,
        medianCents: null,
        sampleSize: 0,
      });
    }
    if (i < args.cards.length - 1) await sleep(PER_REQUEST_DELAY_MS);
  }
  return out;
}
