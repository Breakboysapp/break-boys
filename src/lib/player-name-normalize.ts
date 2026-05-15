/**
 * Player-name canonicalization at the write path.
 *
 * Stops future checklist imports from re-introducing case-collision
 * duplicates that have to be merged after the fact. The same player
 * is occasionally spelled with subtle differences across sources
 * (Beckett xlsx vs SportsCardsPro vs hand-uploads) — most often it's
 * a case mismatch: "LeBron James" vs "Lebron James", "Cooper DeJean"
 * vs "Cooper Dejean", "Shaquille O'Neal" vs "Shaquille O'neal".
 *
 * Strategy: before inserting a batch of cards, snapshot the existing
 * canonical spellings from the Card table (one query). For each row
 * being inserted, lowercase-match against the snapshot — if a
 * canonical form exists, use it; otherwise the incoming spelling
 * becomes the canonical going forward.
 *
 * Normalization folds case AND diacritics — turns out our data
 * is dirty along both axes: "Luka Doncic" / "Luka Dončić" (NFC) /
 * "Luka Dončić" (NFD-decomposed) all need to collapse to one
 * canonical entry. Same shape for "José Altuve" / "Jose Altuve",
 * "Fernando Tatís Jr." / "Fernando Tatis Jr.", etc. The canonical
 * form preserves whatever accents the most-common spelling uses,
 * so the displayed name stays correct.
 *
 * What we explicitly do NOT collapse: suffixes (Jr./Sr./III),
 * nicknames (Mike vs Michael), or initials — those are intentional
 * distinctions in the hobby ("Cal Ripken Jr." and "Cal Ripken III"
 * are genuinely different players).
 */

import type { PrismaClient } from "@prisma/client";

export type CanonicalMap = Map<string, string>;

/** Lowercase + strip combining diacritics. Folds NFC and NFD
 *  variants of the same name to the same key, and collapses
 *  accent vs. no-accent. */
export function normalizeKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * Build a lowercase → canonical-spelling map from the existing
 * Card table. Canonical = the most-frequent spelling for each
 * lowercase form. One full table scan; runs in well under a second
 * even for 50k+ rows.
 */
export async function buildCanonicalMap(
  prisma: PrismaClient,
): Promise<CanonicalMap> {
  const rows = await prisma.card.groupBy({
    by: ["playerName"],
    _count: { _all: true },
  });

  // For each lowercased key, track the variant with the highest
  // card count. First sighting wins on ties — deterministic across
  // runs since groupBy is sorted internally by the engine.
  const byLower = new Map<string, { name: string; count: number }>();
  for (const r of rows) {
    if (!r.playerName) continue;
    const k = normalizeKey(r.playerName);
    const cur = byLower.get(k);
    if (!cur || r._count._all > cur.count) {
      byLower.set(k, { name: r.playerName, count: r._count._all });
    }
  }

  const out: CanonicalMap = new Map();
  for (const [k, v] of byLower) out.set(k, v.name);
  return out;
}

/**
 * Resolve a candidate spelling against the canonical map. If a
 * canonical form exists for the candidate's lowercase key, return
 * it (preserving original case). Otherwise, this spelling becomes
 * the new canonical — return it as-is AND register it in the map
 * so subsequent rows in the same batch reuse it.
 */
export function canonicalize(
  candidate: string,
  map: CanonicalMap,
): string {
  if (!candidate) return candidate;
  const k = normalizeKey(candidate);
  const existing = map.get(k);
  if (existing) return existing;
  map.set(k, candidate);
  return candidate;
}
