/**
 * MLB Pipeline Top 100 fetcher.
 *
 * Pulls https://www.mlb.com/milb/prospects and reconstructs the Top 100
 * out of the embedded Apollo cache. The page only renders the first
 * ~5 rows server-side as actual <tr> elements (the rest stream in
 * client-side), but the full 100-prospect dataset is hydrated into
 * an inline JSON blob — so we don't need a headless browser.
 *
 * Strategy:
 *   1. Fetch the HTML, decode the handful of HTML entities Apollo
 *      escaped its payload with (&quot; &lt; &gt; &amp; &#x27; &#x3D;).
 *   2. Locate the 100 `RankedPlayerEntity` objects via balanced-brace
 *      scan from each `"__typename":"RankedPlayerEntity"` marker.
 *   3. Build a flat lookup of every `"Type:id":{...}` entry in the
 *      Apollo cache for the three types we need to dereference:
 *      Person (the player), Team (their affiliate), Sport (the level).
 *   4. For each ranked entity, walk: RankedPlayerEntity → playerEntity
 *      → player ref → Person → activeRoster ref → Team → sport ref →
 *      Sport. That gives rank/name/position/org/level/age in one pass.
 *
 * Returns the parsed roster — does not touch the DB. Callers
 * (the weekly cron and /prospects' inline self-seed) handle the
 * wipe + insert + revalidation.
 */

const PIPELINE_URL = "https://www.mlb.com/milb/prospects";
const USER_AGENT =
  "Mozilla/5.0 (compatible; BreakBoys/0.1; +https://breakboys.app)";

export type ParsedProspect = {
  rank: number;
  playerName: string;
  position: string | null;
  org: string | null;
  level: string | null;
  age: number | null;
};

const HTML_ENTITIES: Record<string, string> = {
  "&quot;": '"',
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&#x27;": "'",
  "&#39;": "'",
  "&#x3D;": "=",
  "&nbsp;": " ",
};

function decodeEntities(s: string): string {
  return s.replace(/&(?:[a-z]+|#x?[0-9a-fA-F]+);/g, (m) => {
    if (HTML_ENTITIES[m]) return HTML_ENTITIES[m];
    if (m.startsWith("&#x") || m.startsWith("&#X")) {
      const cp = parseInt(m.slice(3, -1), 16);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    if (m.startsWith("&#")) {
      const cp = parseInt(m.slice(2, -1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    return m;
  });
}

/**
 * Given a position inside a JSON object value, walk back to the
 * preceding `{` and forward through balanced braces — respecting
 * string boundaries and backslash escapes — to return the full
 * JSON object substring.
 */
function extractBalancedObject(text: string, anchor: number): string | null {
  let start = anchor;
  while (start >= 0 && text[start] !== "{") start--;
  if (start < 0) return null;

  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (c === "\\") {
      esc = true;
      continue;
    }
    if (c === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

type CacheEntry = Record<string, unknown>;
type CacheMap = Map<string, CacheEntry>;

function buildCache(text: string, types: string[]): CacheMap {
  const map: CacheMap = new Map();
  for (const tn of types) {
    const re = new RegExp(`"(${tn}:\\d+)":\\s*\\{`, "g");
    for (let m = re.exec(text); m !== null; m = re.exec(text)) {
      const key = m[1];
      const body = extractBalancedObject(text, m.index + m[0].length - 1);
      if (!body) continue;
      try {
        map.set(key, JSON.parse(body) as CacheEntry);
      } catch {
        // Drop malformed entries silently — a single bad object
        // shouldn't kill the whole 100-prospect import.
      }
    }
  }
  return map;
}

function resolveRef(
  ref: unknown,
  cache: CacheMap,
): CacheEntry | undefined {
  if (
    typeof ref !== "object" ||
    ref === null ||
    !("__ref" in ref) ||
    typeof (ref as { __ref: unknown }).__ref !== "string"
  ) {
    return undefined;
  }
  return cache.get((ref as { __ref: string }).__ref);
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export async function fetchMlbPipelineTop100(
  fetchImpl: typeof fetch = fetch,
): Promise<ParsedProspect[]> {
  const res = await fetchImpl(PIPELINE_URL, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    // Page is publicly cacheable; default fetch behavior is fine.
  });
  if (!res.ok) {
    throw new Error(
      `MLB Pipeline fetch failed: HTTP ${res.status} ${res.statusText}`,
    );
  }
  const html = await res.text();
  const text = decodeEntities(html);

  // Pull out every RankedPlayerEntity block (should be exactly 100).
  const rankedRe = /"__typename":"RankedPlayerEntity"/g;
  const rankedBlocks: Array<{
    rank: number;
    position: string | null;
    playerRef: string | null;
  }> = [];
  for (let m = rankedRe.exec(text); m !== null; m = rankedRe.exec(text)) {
    const body = extractBalancedObject(text, m.index);
    if (!body) continue;
    let parsed: CacheEntry;
    try {
      parsed = JSON.parse(body) as CacheEntry;
    } catch {
      continue;
    }
    const rank = asNumber(parsed.rank);
    if (rank === null) continue;
    const pe = parsed.playerEntity as CacheEntry | undefined;
    const position = asString(pe?.position);
    const playerRef =
      pe && typeof pe.player === "object" && pe.player !== null
        ? typeof (pe.player as { __ref?: unknown }).__ref === "string"
          ? ((pe.player as { __ref: string }).__ref)
          : null
        : null;
    rankedBlocks.push({ rank, position, playerRef });
  }

  if (rankedBlocks.length === 0) {
    throw new Error(
      "MLB Pipeline: parsed page contained no RankedPlayerEntity objects — page shape changed?",
    );
  }

  const cache = buildCache(text, ["Person", "Team", "Sport"]);

  const seen = new Set<number>();
  const out: ParsedProspect[] = [];
  for (const r of rankedBlocks) {
    if (seen.has(r.rank)) continue; // Defensive — Apollo can hydrate twice.
    seen.add(r.rank);

    const person = r.playerRef ? cache.get(r.playerRef) : undefined;
    const first = asString(person?.useName) ?? "";
    const last =
      asString(person?.useLastName) ?? asString(person?.boxscoreName) ?? "";
    const playerName = `${first} ${last}`.trim();
    if (!playerName) continue;

    const age = asNumber(person?.currentAge);
    const team = resolveRef(person?.activeRoster, cache);
    const org = asString(team?.parentOrgName) ?? asString(team?.name);
    const sport = resolveRef(team?.sport, cache);
    const level = asString(sport?.abbreviation);

    out.push({
      rank: r.rank,
      playerName,
      position: r.position,
      org,
      level,
      age,
    });
  }

  out.sort((a, b) => a.rank - b.rank);
  return out;
}
