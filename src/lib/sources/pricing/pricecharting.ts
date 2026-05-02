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
  /** Optional. When present, hints the variation (e.g. "Dual Autographs
   * Checklist", "Black - 1/1") for query + ranking. Without it we can
   * still match base/numeric-only cards but lose the ability to reject
   * a base-card fallback for an auto/parallel lookup. */
  variation?: string | null;
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

/**
 * Words from the variation field that hurt the search rather than help —
 * "Checklist" appears on basically every Beckett checklist row but never
 * in PriceCharting's product names. Strip them before forming the query.
 */
const VARIATION_NOISE = new Set([
  "checklist",
  "set",
  "card",
  "cards",
  "no",
]);

function isNonBase(card: CardLookup): boolean {
  if (!NUMERIC.test(card.cardNumber)) return true; // letter-prefix → insert/auto
  if (card.variation) {
    // "Base Set" and "Base Set · RC" stay as base; everything else is non-base.
    return !/^Base Set( ·.*)?$/i.test(card.variation.trim());
  }
  return false;
}

/** Trim variation tokens we'd want to feed PriceCharting's search box. */
function variationKeywords(variation: string | null | undefined): string {
  if (!variation) return "";
  return variation
    .replace(/[·•]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !VARIATION_NOISE.has(w.toLowerCase()))
    .join(" ");
}

/** Build the search query for one card. */
export function buildQuery(productName: string, card: CardLookup): string {
  // Card-number prefixes for inserts/autos (e.g. "DA-TRG") are distinctive.
  // For numeric base cards the prefix is just a number → too noisy alone.
  const includeCardNumber = !NUMERIC.test(card.cardNumber);
  const parts: string[] = [productName, card.playerName];
  if (includeCardNumber) parts.push(card.cardNumber);
  const v = variationKeywords(card.variation);
  if (v) parts.push(v);
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

  // Rank candidates. The set-name match is a noisy signal on its own —
  // PriceCharting's "console-name" is typically the year+brand. The
  // discriminating signals are (a) does the matched product mention
  // the player, (b) does it mention the specific card number/prefix,
  // and (c) does it mention the variation (Auto / Refractor / parallel).
  const productLower = args.productName.toLowerCase();
  const cardNumberLower = args.card.cardNumber.toLowerCase();
  const playerLower = args.card.playerName.toLowerCase();
  const variationKw = variationKeywords(args.card.variation).toLowerCase();
  const nonBase = isNonBase(args.card);

  const ranked = products
    .map((p) => {
      const consoleName = (p["console-name"] ?? "").toLowerCase();
      const pName = (p["product-name"] ?? "").toLowerCase();
      let score = 0;
      // Console name contains a leading set word (year or brand)
      if (productLower && consoleName.includes(productLower.split(" ")[0])) score += 3;
      // Set-word overlap
      for (const word of productLower.split(" ")) {
        if (word.length > 2 && consoleName.includes(word)) score++;
      }
      // Player name in product-name
      if (playerLower && pName.includes(playerLower)) score += 3;
      // Card-number prefix in product-name (e.g. "DA-TRG") — strong signal
      if (!NUMERIC.test(args.card.cardNumber) && pName.includes(cardNumberLower)) {
        score += 6;
      }
      // Variation keywords in product-name (e.g. "auto", "refractor")
      if (variationKw) {
        for (const w of variationKw.split(/\s+/)) {
          if (w.length > 2 && pName.includes(w)) score += 2;
        }
      }
      return { p, score };
    })
    .sort((a, b) => b.score - a.score);

  const best = ranked[0]?.p;
  if (!best) {
    return { cardId: args.card.cardId, medianCents: null, sampleSize: 0 };
  }

  // Reject suspicious matches: if this is a non-base card (auto / parallel
  // / numbered insert) but the matched product-name shows none of the
  // signals that would normally appear (the card number, the variation
  // keyword, or any explicit "auto"/"parallel" hint), assume PriceCharting
  // fell back to the base card and return null. Better to show no data
  // than to show $3.43 next to a Trout dual auto.
  if (nonBase) {
    const bestName = (best["product-name"] ?? "").toLowerCase();
    const cardNumberMatch =
      !NUMERIC.test(args.card.cardNumber) && bestName.includes(cardNumberLower);
    const variationMatch =
      variationKw &&
      variationKw
        .split(/\s+/)
        .some((w) => w.length > 2 && bestName.includes(w));
    const explicitNonBaseHint =
      /\b(auto|autograph|signature|refractor|parallel|patch|relic|memorabilia|prizm|sapphire|atomic)\b/.test(
        bestName,
      );
    if (!cardNumberMatch && !variationMatch && !explicitNonBaseHint) {
      return { cardId: args.card.cardId, medianCents: null, sampleSize: 0 };
    }
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
