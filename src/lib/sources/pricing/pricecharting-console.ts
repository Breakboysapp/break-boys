/**
 * PriceCharting / SportsCardsPro per-set ingest.
 *
 * Two undocumented endpoints we use:
 *
 *   GET /api/console/<slug>?cursor=N
 *     JSON. 150 cards per page; paginate via the returned `cursor`.
 *     Fields per card: id, productName, productUri, price1/2/3, printRun,
 *     imageUri.  price1 = Ungraded, price2 = PSA 10, price3 = PSA 9.
 *
 *   GET https://www.sportscardspro.com/pop/set/<slug>
 *     HTML. One `<table>` with rows: Card · G6 · G7 · G8 · G9 · G10 · Total.
 *     Combined PSA + CGC counts. Same row order as the console JSON,
 *     so we join by parsed (playerName, cardNumber, variation).
 *
 * Auth: none required for these endpoints. The token-protected /api/product
 * endpoint is unrelated and only used for sealed-box / single-card lookup.
 *
 * Slug examples:
 *   baseball-cards-2025-topps-chrome
 *   football-cards-2024-topps-chrome
 *   basketball-cards-2024-25-panini-prizm
 */

const PC_BASE = "https://www.pricecharting.com";
const SCP_BASE = "https://www.sportscardspro.com";
// SCP/PC sit behind Cloudflare. Custom or "compatible" User-Agents get
// 403'd at the edge; a current Chrome UA passes cleanly. We're not
// trying to evade rate limits — same gentle PER_REQUEST_DELAY_MS as
// the existing /api/product client — just looking like a real browser
// for the HTML pop page (the JSON /api/console endpoint is friendlier).
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const PER_REQUEST_DELAY_MS = 200;

export type PCConsoleProduct = {
  id: string;
  productName: string;
  productUri: string;
  imageUri: string;
  /** Ungraded / loose card. Cents. */
  ungradedCents: number | null;
  /** PSA 10 — graded gem. Cents. */
  psa10Cents: number | null;
  /** PSA 9 — graded mint. Cents. */
  psa9Cents: number | null;
  /** 0 means unnumbered. */
  printRun: number;
};

export type PCPopRow = {
  /** Raw text from the row, e.g. "Shohei Ohtani [Refractor] #1". Used for joining. */
  cardLabel: string;
  popG6: number | null;
  popG7: number | null;
  popG8: number | null;
  popG9: number | null;
  popG10: number | null;
  popTotal: number | null;
};

export type ParsedCard = {
  /** Player name with parallel/variation stripped. "Shohei Ohtani". */
  playerName: string;
  /** Card number including any prefix. "1", "AC-SO", "CL-1". */
  cardNumber: string;
  /** Bracketed variation token, if any. "Refractor", "X-Fractor", null. */
  variation: string | null;
};

/**
 * PC's productName follows a stable shape:
 *   "Shohei Ohtani #1"
 *   "Shohei Ohtani [Refractor] #1"
 *   "Shohei Ohtani [Red Speckle Image Variation] #1"
 *   "Aaron Judge Auto #AC-AJ"
 *
 * The card number is the last #-prefixed token. Anything in []s is the
 * variation. Everything else, after stripping known suffixes (Auto), is
 * the player name.
 */
export function parseProductName(name: string): ParsedCard {
  let s = name.trim();

  // Card number: last "#..." token (alpha-num + dashes).
  let cardNumber = "";
  const numMatch = s.match(/#([A-Za-z0-9-]+)\s*$/);
  if (numMatch) {
    cardNumber = numMatch[1];
    s = s.slice(0, numMatch.index).trim();
  }

  // Variation: bracketed segment.
  let variation: string | null = null;
  const varMatch = s.match(/\[([^\]]+)\]\s*$/);
  if (varMatch) {
    variation = varMatch[1].trim();
    s = s.slice(0, varMatch.index).trim();
  }

  // What's left is the player name. Trim trailing classifiers like " Auto".
  const playerName = s.replace(/\s+(Auto|Autograph|Patch|Relic)\s*$/i, "").trim();

  return { playerName, cardNumber, variation };
}

/**
 * "$1,234.56" → 123456 (cents). Empty string / "—" → null.
 * Handles "$20,000.00" without choking.
 */
export function parsePriceCents(s: string | null | undefined): number | null {
  if (!s) return null;
  const cleaned = s.replace(/[$,]/g, "").trim();
  if (!cleaned || cleaned === "—") return null;
  const f = Number.parseFloat(cleaned);
  if (!Number.isFinite(f) || f <= 0) return null;
  return Math.round(f * 100);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch every page of a console listing, returning the flat list of cards.
 * Paginates on `cursor`; PC returns ~150 per page until the cursor stops
 * advancing. Bails after MAX_PAGES as a safety net for unbounded loops.
 */
export async function fetchConsoleProducts(slug: string): Promise<{
  category: string;
  products: PCConsoleProduct[];
}> {
  const MAX_PAGES = 50; // 50 × 150 = 7,500 cards. No real set comes close.
  const all: PCConsoleProduct[] = [];
  let cursor: string | null = null;
  let category = "";
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = cursor
      ? `${PC_BASE}/api/console/${slug}?cursor=${encodeURIComponent(cursor)}`
      : `${PC_BASE}/api/console/${slug}`;
    const res = await globalThis.fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`fetchConsoleProducts: ${res.status} on ${url}`);
    }
    const json = (await res.json()) as {
      category?: string;
      cursor?: string;
      products?: Array<{
        id: string;
        productName: string;
        productUri: string;
        imageUri?: string;
        price1?: string;
        price2?: string;
        price3?: string;
        printRun?: number;
      }>;
    };
    if (!category && json.category) category = json.category;
    const items = json.products ?? [];
    if (items.length === 0) break;
    for (const p of items) {
      all.push({
        id: p.id,
        productName: p.productName,
        productUri: p.productUri,
        imageUri: p.imageUri ?? "",
        ungradedCents: parsePriceCents(p.price1),
        psa10Cents: parsePriceCents(p.price2),
        psa9Cents: parsePriceCents(p.price3),
        printRun: p.printRun ?? 0,
      });
    }
    // Cursor stops advancing when we've reached the end.
    if (!json.cursor || json.cursor === cursor) break;
    cursor = json.cursor;
    await sleep(PER_REQUEST_DELAY_MS);
  }
  return { category, products: all };
}

/**
 * Fetch and parse the population-report HTML for a set. One row per card
 * (combined PSA + CGC counts); same order as the console listing.
 *
 * Implementation note: SCP's pop endpoint sits behind Cloudflare with
 * JA3/JA4 TLS fingerprinting that flags Node's native `fetch` (undici)
 * as a bot — request returns 403 regardless of headers we set. `curl`'s
 * TLS fingerprint is on Cloudflare's allow-list, so we shell out for
 * this one request. The rest of the importer uses regular fetch.
 */
export async function fetchPopRows(slug: string): Promise<PCPopRow[]> {
  const url = `${SCP_BASE}/pop/set/${slug}`;
  const html = await curlGet(url);
  return parsePopHtml(html);
}

async function curlGet(url: string): Promise<string> {
  // Lazy import keeps Node `child_process` out of any client bundle that
  // might tree-shake this module wrong.
  const { execFile } = await import("node:child_process");
  return new Promise((resolve, reject) => {
    execFile(
      "curl",
      [
        "-sSL", // silent + show errors + follow redirects
        "-A",
        UA,
        "-H",
        "Accept: text/html,application/xhtml+xml,application/xml;q=0.9",
        "-H",
        "Accept-Language: en-US,en;q=0.9",
        "--max-time",
        "30",
        url,
      ],
      // 5 MB buffer is plenty — pop pages cap at ~700 KB even for huge sets.
      { maxBuffer: 5 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(`curl ${url}: ${stderr || err.message}`));
        if (!stdout || stdout.length < 1000) {
          return reject(
            new Error(
              `curl ${url}: unexpectedly short body (${stdout.length} bytes)`,
            ),
          );
        }
        resolve(stdout);
      },
    );
  });
}

/**
 * Pop table parser. The page has exactly one table; rows after the
 * header are: img · cardLabel · G6 · G7 · G8 · G9 · G10 · Total · UI.
 * We tolerate "—" / "-" cells (rendered as null counts).
 */
export function parsePopHtml(html: string): PCPopRow[] {
  const rows: PCPopRow[] = [];
  // Match every <tr ...>...</tr>, skipping the first (header).
  const trMatches = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)];
  for (const tr of trMatches.slice(1)) {
    const tdMatches = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)];
    if (tdMatches.length < 8) continue;
    const stripTags = (s: string) =>
      s
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const cells = tdMatches.map((m) => stripTags(m[1]));
    const cardLabel = cells[1];
    const toCount = (s: string): number | null => {
      if (!s || s === "-" || s === "—") return null;
      const n = Number.parseInt(s.replace(/,/g, ""), 10);
      return Number.isFinite(n) ? n : null;
    };
    const popG6 = toCount(cells[2]);
    const popG7 = toCount(cells[3]);
    const popG8 = toCount(cells[4]);
    const popG9 = toCount(cells[5]);
    const popG10 = toCount(cells[6]);
    const popTotal = toCount(cells[7]);
    if (!cardLabel) continue;
    rows.push({ cardLabel, popG6, popG7, popG8, popG9, popG10, popTotal });
  }
  return rows;
}
