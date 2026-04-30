/**
 * eBay Browse API client for value-index aggregation.
 *
 * Auth: OAuth 2.0 client_credentials grant. Requires:
 *   EBAY_APP_ID    (Client ID, from developer.ebay.com → My Account → Keys)
 *   EBAY_CERT_ID   (Client Secret)
 *   EBAY_ENV       optional, "production" (default) | "sandbox"
 *
 * Strategy:
 *   For each team in a product, query Browse API for active listings matching
 *   `<product name> <team>`, filter to fixed-price + recent + reasonable price
 *   range, sum the asking prices to get a raw value-index in cents.
 *
 * Limitation: Browse API returns ACTIVE listings (asking prices), not sold
 *   comps. eBay's Marketplace Insights API has sold data but requires
 *   per-app approval ("Insights" status). Once approved, swap the endpoint
 *   from /buy/browse to /buy/marketplace_insights — interface here is the same.
 */

const TOKEN_URL_PROD = "https://api.ebay.com/identity/v1/oauth2/token";
const TOKEN_URL_SBX = "https://api.sandbox.ebay.com/identity/v1/oauth2/token";
const BROWSE_URL_PROD = "https://api.ebay.com/buy/browse/v1/item_summary/search";
const BROWSE_URL_SBX = "https://api.sandbox.ebay.com/buy/browse/v1/item_summary/search";
const SCOPE = "https://api.ebay.com/oauth/api_scope";
const TOKEN_TTL_BUFFER_MS = 60_000;

export type ValueIndexResult = {
  team: string;
  valueIndexCents: number;
  sampleSize: number;
};

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
  itemEndDate?: string;
  buyingOptions?: string[];
  condition?: string;
};

type BrowseResponse = {
  itemSummaries?: BrowseItem[];
  total?: number;
};

async function searchTeam(args: {
  productName: string;
  team: string;
  limit?: number;
}): Promise<{ totalCents: number; sampleSize: number }> {
  const token = await getAppToken();
  const { browseUrl } = endpoints();
  const q = `${args.productName} ${args.team}`;
  const url = new URL(browseUrl);
  url.searchParams.set("q", q);
  url.searchParams.set("limit", String(args.limit ?? 100));
  // Filter: fixed-price (Buy It Now) + USD only + reasonable price band.
  // Excludes outlier $9999 listings and giveaways.
  url.searchParams.set(
    "filter",
    [
      "buyingOptions:{FIXED_PRICE}",
      "priceCurrency:USD",
      "price:[1..10000]",
    ].join(","),
  );
  url.searchParams.set("sort", "price");

  const res = await globalThis.fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      // EBAY-C-MARKETPLACE-ID required; default to US.
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`eBay browse failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as BrowseResponse;
  const items = json.itemSummaries ?? [];

  let totalCents = 0;
  let sampleSize = 0;
  for (const item of items) {
    const raw = item.price?.value;
    if (!raw) continue;
    const dollars = Number(raw);
    if (!Number.isFinite(dollars) || dollars <= 0) continue;
    totalCents += Math.round(dollars * 100);
    sampleSize++;
  }
  return { totalCents, sampleSize };
}

export async function fetchValueIndexes(args: {
  productName: string;
  teams: string[];
}): Promise<ValueIndexResult[]> {
  const results: ValueIndexResult[] = [];
  // Sequential to avoid eBay rate-limit; 35 MLB teams × ~150ms each ≈ 5s.
  for (const team of args.teams) {
    try {
      const r = await searchTeam({ productName: args.productName, team });
      results.push({
        team,
        valueIndexCents: r.totalCents,
        sampleSize: r.sampleSize,
      });
    } catch (err) {
      // Don't fail the whole sync on one team — log and move on.
      console.warn(
        `[ebay] failed for team ${team}: ${err instanceof Error ? err.message : err}`,
      );
      results.push({ team, valueIndexCents: 0, sampleSize: 0 });
    }
  }
  return results;
}
