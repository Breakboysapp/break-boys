/**
 * Player name ↔ URL slug mapping.
 *
 * Stable, deterministic, no DB lookup required either direction:
 *   "Shohei Ohtani"        ↔ "shohei-ohtani"
 *   "Bobby Witt Jr."       ↔ "bobby-witt-jr"
 *   "Ronald Acuña Jr."     ↔ "ronald-acuna-jr"   (accents stripped)
 *   "J.T. Realmuto"        ↔ "jt-realmuto"
 *   "D'Angelo Russell"     ↔ "dangelo-russell"
 *
 * Slug → name is a "best guess" reconstruction (Title Case the parts);
 * the page should always hit the DB to find the canonical playerName
 * by exact slug match against all Card.playerName values, falling back
 * to the reconstruction only if no match exists.
 */

/**
 * Convert a player name to its URL slug.
 *
 * Steps:
 *   1. NFD-normalize so accented chars decompose into base + combining
 *      mark (Á → A + ́), then strip the combining marks.
 *   2. Lowercase.
 *   3. Replace any run of non-alphanumeric characters with a single
 *      hyphen.
 *   4. Trim leading/trailing hyphens.
 */
export function playerSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Best-guess reconstruction of a player name from a slug. Used as a
 * fallback when the DB has no card with this slug and we still want to
 * render a "no data found" page with a sensible heading rather than
 * the raw slug. Title-cases each segment.
 */
export function nameFromSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
