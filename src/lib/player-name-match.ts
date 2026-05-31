/**
 * Tiered player-name matcher for the Sleeper board join.
 *
 * The problem: the checklist side (Beckett xlsx) and the stats side
 * (MLB Stats API roster) spell the same player slightly differently
 * often enough that an exact key join silently drops a meaningful
 * chunk of the board — those players show "no roster match" and never
 * get a Production / Sleeper score even though MLB has their stats.
 *
 * Both sides already agree on the *base* normalization — lowercase +
 * diacritic-folded — via `normalizeKey` in player-name-normalize.ts.
 * What that base key does NOT collapse, and what actually differs
 * between the two sources:
 *
 *   - Generational suffixes: "Jr." vs "Jr" vs no suffix at all
 *     ("Ronald Acuna Jr." on the card, "Ronald Acuna" in a feed).
 *   - Internal punctuation: periods in initials ("C.J. Abrams" vs
 *     "CJ Abrams"), apostrophes ("O'Neil Cruz" vs "Oneil Cruz"),
 *     stray commas left by a parser.
 *   - Hyphens: "Jung-hoo Lee" vs "Jung Hoo Lee".
 *   - First-name form: a full first name vs an abbreviation / short
 *     form ("Yoshinobu Yamamoto" vs "Yoshi Yamamoto").
 *
 * Strategy: three tiers, tried in order, each only used as a fallback
 * when the stricter tier above produced no hit. The two fuzzy tiers
 * only accept a candidate when it resolves to exactly ONE roster
 * player — if a relaxation would merge two distinct players (the
 * classic "Cal Ripken Jr." vs "Cal Ripken" the hobby intentionally
 * keeps separate, or two same-surname prospects), we decline rather
 * than guess. This guarantees we never override an exact match and
 * never turn a correct "no match" into a *wrong* match. We only fill
 * in blanks.
 *
 * Tier 1 — exact: current behavior, base normalized key equality.
 * Tier 2 — loose: suffix-stripped, punctuation-stripped, hyphen- and
 *   whitespace-collapsed. Unambiguous only.
 * Tier 3 — prefix: identical *full* surname + a first name that is a
 *   genuine short form of the other. Catches abbreviations / nicknames
 *   ("Cam"→"Cameron", "Leo"→"Leonardo", "Sam"→"Samuel", "Chris"→
 *   "Christopher", "Yoshi"→"Yoshinobu") while rejecting the traps a
 *   naive first-initial match falls into, all proven against the live
 *   28k-card dataset:
 *     - cross-name initials: "Aaron Judge" vs "Alex Judge" (neither is
 *       a prefix of the other).
 *     - Spanish -o pairs that are DIFFERENT people: "Robert Perez" vs
 *       "Roberto Perez", "Edgar" vs "Edgardo", "Albert" vs "Alberto"
 *       (rejected by the length-gap rule — a real nickname drops ≥3
 *       characters, these drop 1–2).
 *     - multi-word surname collisions: "Jose Cruz" vs "Jose De La
 *       Cruz", "Luis Santos" vs "Luis De Los Santos" (rejected because
 *       we require the WHOLE surname to match, not just its last token).
 *     - multi-player cards ("Edgar Martinez / Julio Rodriguez"), whose
 *       concatenated tokens never match a single player's surname.
 *   Unambiguous only.
 */

export type MatchType = "exact" | "loose" | "prefix";

// Generational suffixes we fold away for the loose tier. These are the
// forms that appear once punctuation is stripped. We deliberately omit
// lone "v" (too easy to collide with a real name token) and "i" (never
// a suffix in practice).
const SUFFIX_TOKENS = new Set(["jr", "sr", "ii", "iii", "iv"]);

// Shortest first-name length we'll treat as a real prefix. Below this
// (single initials, 2-letter fragments) the false-positive risk
// outweighs the recall, and Beckett checklists spell out first names
// anyway, so we lose almost nothing.
const MIN_PREFIX_LEN = 3;

// Minimum characters a real nickname/short-form drops vs the full name.
// "Sam"→"Samuel" (3), "Cam"→"Cameron" (4), "Leo"→"Leonardo" (5) clear
// this; the false-positive Spanish pairs "Robert"→"Roberto" (1),
// "Edgar"→"Edgardo" (2), "Jose"→"Joseph" (2) do not — they're distinct
// names, not abbreviations.
const MIN_PREFIX_GAP = 3;

/**
 * Loosen an already base-normalized key (lowercase + diacritic-folded,
 * i.e. the output of `normalizeKey`). Strips internal punctuation,
 * turns hyphens/slashes/underscores into spaces, drops generational
 * suffix tokens, and collapses whitespace.
 *
 *   "c.j. abrams"        -> "cj abrams"
 *   "ronald acuna jr."   -> "ronald acuna"
 *   "o'neil cruz"        -> "oneil cruz"
 *   "jung-hoo lee"       -> "jung hoo lee"
 */
export function looseKey(normalized: string): string {
  const cleaned = normalized
    // Drop characters that should vanish entirely (initials/contractions):
    // periods, straight + curly apostrophes, backticks, asterisks.
    .replace(/[.'’`*]/g, "")
    // Anything else non-alphanumeric becomes a space (hyphens, commas,
    // slashes, stray symbols) so token boundaries stay correct.
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = cleaned.split(" ").filter((t) => t && !SUFFIX_TOKENS.has(t));
  // Guard: a name that's nothing but suffix/punctuation (never happens
  // in practice) would otherwise emit "" — fall back to the cleaned form.
  return tokens.length > 0 ? tokens.join(" ") : cleaned;
}

/** Split a loosened key into [firstName, fullSurname], or null if it
 *  isn't a two-part-or-more name. The surname is EVERY token after the
 *  first joined back together ("de la cruz", "a reyes") — using the
 *  whole thing, not just the last token, is what stops "Jose Cruz" from
 *  colliding with "Jose De La Cruz". */
function firstAndSurname(normalized: string): [string, string] | null {
  const tokens = looseKey(normalized).split(" ").filter(Boolean);
  if (tokens.length < 2) return null;
  return [tokens[0], tokens.slice(1).join(" ")];
}

/** True when two first names are the same, or one is a genuine short
 *  form of the other: a prefix, at least MIN_PREFIX_LEN chars, dropping
 *  at least MIN_PREFIX_GAP characters. The gap is what separates real
 *  nicknames ("Sam"/"Samuel") from distinct names that merely share a
 *  prefix ("Robert"/"Roberto"). */
export function firstNameCompatible(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return (
    short.length >= MIN_PREFIX_LEN &&
    long.startsWith(short) &&
    long.length - short.length >= MIN_PREFIX_GAP
  );
}

/**
 * A reusable matcher built once over a set of candidate rows (e.g. the
 * MiLB roster, or the Pipeline ranking list) keyed by their base
 * normalized name. Look up a card's normalized name to get the best
 * candidate plus which tier resolved it.
 */
export type NameMatcher<T> = {
  match: (normalizedName: string) => { item: T; via: MatchType } | null;
};

export function buildNameMatcher<T>(
  items: T[],
  getNormalizedName: (item: T) => string,
): NameMatcher<T> {
  const exact = new Map<string, T>();
  // Loose tier stores a per-key map so we can detect ambiguity (a
  // loosened key resolving to >1 distinct player), deduped by the
  // item's own exact key.
  const loose = new Map<string, Map<string, T>>();
  // Prefix tier indexes candidates by surname so we can scan same-
  // surname rows for a prefix-compatible first name.
  const bySurname = new Map<
    string,
    Array<{ first: string; exactKey: string; item: T }>
  >();

  for (const item of items) {
    const nk = getNormalizedName(item);
    if (!nk) continue;
    // Exact: last write wins, mirroring the prior `new Map(rows.map())`.
    exact.set(nk, item);

    const lk = looseKey(nk);
    let bucket = loose.get(lk);
    if (!bucket) {
      bucket = new Map<string, T>();
      loose.set(lk, bucket);
    }
    if (!bucket.has(nk)) bucket.set(nk, item);

    const fs = firstAndSurname(nk);
    if (fs) {
      const [first, surname] = fs;
      const list = bySurname.get(surname) ?? [];
      list.push({ first, exactKey: nk, item });
      bySurname.set(surname, list);
    }
  }

  return {
    match(normalizedName: string) {
      if (!normalizedName) return null;

      const hit = exact.get(normalizedName);
      if (hit) return { item: hit, via: "exact" };

      // Tier 2 — loose, unambiguous only.
      const lk = looseKey(normalizedName);
      const looseBucket = loose.get(lk);
      if (looseBucket && looseBucket.size === 1) {
        return { item: looseBucket.values().next().value as T, via: "loose" };
      }

      // Tier 3 — prefix on first name, same surname, unambiguous only.
      const fs = firstAndSurname(normalizedName);
      if (fs) {
        const [first, surname] = fs;
        const candidates = bySurname.get(surname);
        if (candidates) {
          const compatible = candidates.filter((c) =>
            firstNameCompatible(first, c.first),
          );
          // Collapse to distinct players by exact key — a player listed
          // twice in the candidate set shouldn't read as ambiguous.
          const distinct = new Map(compatible.map((c) => [c.exactKey, c.item]));
          if (distinct.size === 1) {
            return { item: distinct.values().next().value as T, via: "prefix" };
          }
        }
      }

      return null;
    },
  };
}
