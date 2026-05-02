/**
 * Provider router for per-card market values.
 *
 * Picks PriceCharting if its token is configured (preferred — paid plan,
 * sports-card aggregate prices), otherwise falls back to eBay (sold/active
 * listing medians). Adding a new provider later is a one-line change in
 * `pickProvider`; the route + UI never need to know which one is active.
 *
 * Both underlying implementations expose the same shape:
 *   fetchCardValues({ productName, cards }) → { cardId, medianCents, sampleSize }[]
 * so the route can stay provider-agnostic.
 */
import {
  ebayConfigured,
  fetchCardValues as fetchFromEbay,
} from "./ebayCards";

/**
 * Unified card-lookup shape — the variation field is a PriceCharting
 * hint (used for query disambiguation + base-card-fallback rejection).
 * eBay's matcher ignores it.
 */
export type CardLookup = {
  cardId: string;
  cardNumber: string;
  playerName: string;
  variation?: string | null;
};
import {
  pricechartingConfigured,
  fetchCardValues as fetchFromPriceCharting,
} from "./pricecharting";

export type MarketProvider = "pricecharting" | "ebay";

export type UnifiedCardMarketValue = {
  cardId: string;
  medianCents: number | null;
  sampleSize: number;
};

/** Which provider, if any, has credentials wired up right now. */
export function activeMarketProvider(): MarketProvider | null {
  if (pricechartingConfigured()) return "pricecharting";
  if (ebayConfigured()) return "ebay";
  return null;
}

export function marketProviderLabel(p: MarketProvider | null): string {
  if (p === "pricecharting") return "PriceCharting";
  if (p === "ebay") return "eBay";
  return "";
}

/** Human-readable description of why a refresh failed when no provider is set. */
export const MARKET_PROVIDER_NOT_CONFIGURED_MSG =
  "No market data provider configured — set PRICECHARTING_TOKEN (preferred) or EBAY_APP_ID/EBAY_CERT_ID";

export async function fetchCardValues(args: {
  productName: string;
  cards: CardLookup[];
}): Promise<UnifiedCardMarketValue[]> {
  const provider = activeMarketProvider();
  if (provider === "pricecharting") {
    const rs = await fetchFromPriceCharting(args);
    // Drop provider-specific extras (matchedProductName, etc.) so the
    // caller sees a uniform shape.
    return rs.map((r) => ({
      cardId: r.cardId,
      medianCents: r.medianCents,
      sampleSize: r.sampleSize,
    }));
  }
  if (provider === "ebay") {
    return fetchFromEbay(args);
  }
  throw new Error(MARKET_PROVIDER_NOT_CONFIGURED_MSG);
}
