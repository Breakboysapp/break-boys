/**
 * Per-card eBay market-value fetcher.
 *
 * For each card we run one Browse API search and reduce the active listings
 * to a robust median asking price. Cards with distinctive prefixes (autos,
 * inserts) are queried by `<product> <cardNumber>` because the card number
 * is unique enough to anchor the result. Base cards (numeric card numbers)
 * are queried by `<product> <playerName>` since "1" alone is too noisy.
 *
 * Trade-offs to know:
 *   - Browse API returns ACTIVE listings (asking prices). Marketplace
 *     Insights gives sold comps but requires per-app approval. Once approved
 *     we swap the URL — the rest of this file is identical.
 *   - We use the trimmed median (drop top/bottom 10%) to reduce outlier
 *     impact (a $9999 listing or a 99-cent giveaway).
 *   - For thin markets (sample < MIN_SAMPLE) we return null so the composite
 *     blender knows to fall back to the content score.
 */

const TOKEN_URL_PROD = "https://api.ebay.com/identity/v1/oauth2/token";
const TOKEN_URL_SBX = "https://api.sandbox.ebay.com/identity/v1/oauth2/token";
const BROWSE_URL_PROD = "https://api.ebay.com/buy/browse/v1/item_summary/search";
const BROWSE_URL_SBX = "https://api.sandbox.ebay.com/buy/browse/v1/item_summary/search";
const SCOPE = "https://api.ebay.com/oauth/api_scope";
const TOKEN_TTL_BUFFER_MS = 60_000;

// Listings under this drop out — junk items, accidental pennies, etc.
const MIN_PRICE_CENTS = 100;
// Anything above this is almost certainly a graded slab outlier or wishful list.
const MAX_PRICE_CENTS = 1_000_000;
// Below this sample size, treat the per-card value as unreliable (return null).
const MIN_SAMPLE = 3;
// Per-call result cap — eBay supports up to 200 but 50 is plenty for medians.
const PER_CARD_LIMIT = 50;
// Polite throttle between calls to stay under eBay's free-tier rate limit.
const INTER_REQUEST_DELAY_MS = 220;

const NUMERIC = /^\d+$/;

let cachedToken: { token: string; expiresAt: number } | null = null;

function endpoints() {
  const env = (process.env.EBAY_ENV ?? "production").toLowerCase();
  return env === "sandbox"
    ? { tokenUrl: TOKEN_URL_SBX, browseUrl: BROWSE_URL_SBX }
    : { tokenUrl: TOKEN_URL_PROD, browseUrl: BROWSE_URL_PROD };
}

export function ebayConfigured(): boolean {
  return Boolean(process.env.EBAY_APP_ID && process.env.EBAY_CERT_ID);
}

async function getAppToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + TOKEN_TTL_BUFFER_MS) {
    return cachedToken.token;
  }
  const appId = process.env.EBAY_APP_ID;
  const certId = process.env.EBAY_CERT_ID;
  if (!appId || !certId) {
    throw new Error("EBAY_APP_ID and EBAY_CERT_ID must be set in env");
  }
  const basic = Buffer.from(`${appId}:${certId}`).toString("base64");
  const { tokenUrl } = endpoints();
  const res = await globalThis.fetch(tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `grant_type=client_credentials&scope=${encodeURIComponent(SCOPE)}`,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`eBay token request failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  return json.access_token;
}

type BrowseItem = {
  price?: { value?: string; currency?: string };
  buyingOptions?: string[];
};

type BrowseResponse = {
  itemSummaries?: BrowseItem[];
};

export type CardLookup = {
  cardId: string;
  cardNumber: string;
  playerName: string;
};

export type CardMarketValue = {
  cardId: string;
  medianCents: number | null;
  sampleSize: number;
};

/**
 * Build the eBay search query for a given card. Card numbers with letters
 * (auto/insert prefixes) are distinctive enough to use directly; numeric
 * card numbers need the player name to disambiguate.
 */
export function buildQuery(productName: string, card: CardLookup): string {
  if (NUMERIC.test(card.cardNumber)) {
    return `${productName} ${card.playerName}`;
  }
  return `${productName} ${card.cardNumber}`;
}

/** Trimmed median: drop the top and bottom 10% of values, then median. */
export function trimmedMedian(cents: number[]): number | null {
  if (cents.length === 0) return null;
  const sorted = [...cents].sort((a, b) => a - b);
  const trim = Math.floor(sorted.length * 0.1);
  const trimmed = sorted.slice(trim, sorted.length - trim);
  if (trimmed.length === 0) return sorted[Math.floor(sorted.length / 2)];
  const mid = Math.floor(trimmed.length / 2);
  if (trimmed.length % 2 === 0) {
    return Math.round((trimmed[mid - 1] + trimmed[mid]) / 2);
  }
  return trimmed[mid];
}

async function fetchOne(args: {
  productName: string;
  card: CardLookup;
  token: string;
  browseUrl: string;
}): Promise<CardMarketValue> {
  const url = new URL(args.browseUrl);
  url.searchParams.set("q", buildQuery(args.productName, args.card));
  url.searchParams.set("limit", String(PER_CARD_LIMIT));
  url.searchParams.set(
    "filter",
    [
      "buyingOptions:{FIXED_PRICE}",
      "priceCurrency:USD",
      `price:[${(MIN_PRICE_CENTS / 100).toFixed(2)}..${(MAX_PRICE_CENTS / 100).toFixed(0)}]`,
    ].join(","),
  );
  url.searchParams.set("sort", "price");

  const res = await globalThis.fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${args.token}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    return { cardId: args.card.cardId, medianCents: null, sampleSize: 0 };
  }
  const json = (await res.json()) as BrowseResponse;
  const items = json.itemSummaries ?? [];
  const cents: number[] = [];
  for (const item of items) {
    const raw = item.price?.value;
    if (!raw) continue;
    const dollars = Number(raw);
    if (!Number.isFinite(dollars) || dollars <= 0) continue;
    cents.push(Math.round(dollars * 100));
  }
  if (cents.length < MIN_SAMPLE) {
    return { cardId: args.card.cardId, medianCents: null, sampleSize: cents.length };
  }
  return {
    cardId: args.card.cardId,
    medianCents: trimmedMedian(cents),
    sampleSize: cents.length,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type ProgressCallback = (done: number, total: number) => void;

/**
 * Fetch market values for an entire checklist. Sequential (with a small
 * pause between calls) to stay polite under eBay's free-tier rate limit.
 * For 500 cards × 220ms ≈ 110 seconds — fine for cron, slow for a button
 * click, so the route should kick this off and let the UI poll.
 */
export async function fetchCardValues(args: {
  productName: string;
  cards: CardLookup[];
  onProgress?: ProgressCallback;
}): Promise<CardMarketValue[]> {
  const token = await getAppToken();
  const { browseUrl } = endpoints();
  const out: CardMarketValue[] = [];
  for (let i = 0; i < args.cards.length; i++) {
    try {
      const r = await fetchOne({
        productName: args.productName,
        card: args.cards[i],
        token,
        browseUrl,
      });
      out.push(r);
    } catch (err) {
      console.warn(
        `[ebay] card ${args.cards[i].cardNumber} (${args.cards[i].playerName}) failed: ${err instanceof Error ? err.message : err}`,
      );
      out.push({
        cardId: args.cards[i].cardId,
        medianCents: null,
        sampleSize: 0,
      });
    }
    args.onProgress?.(i + 1, args.cards.length);
    if (i < args.cards.length - 1) await sleep(INTER_REQUEST_DELAY_MS);
  }
  return out;
}
