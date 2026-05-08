/**
 * Canonical URL path helpers for products.
 *
 * Pattern: /<sport>/<manufacturer>/<year>/<slug>
 *
 *   /baseball/topps/2025/2025-topps-chrome-baseball
 *   /baseball/bowman/2026/2026-bowman-baseball
 *   /football/panini/2025/2025-panini-prizm-football
 *
 * The legacy /products/[id] path stays alive as a 301 redirect so old
 * bookmarks and external links keep working — see the redirect in
 * src/app/products/[id]/page.tsx.
 *
 * Slug includes the year prefix for SEO clarity even though the year
 * is also a path segment. Two reasons: search engines often surface
 * the slug as the link title, and humans copy/paste the slug as a
 * standalone identifier. The redundancy is cheap.
 */

/**
 * Maps the canonical sport codes we store in Product.sport to the
 * URL-friendly segment users will see. Falls through to lowercase
 * for sports we haven't standardized on (Golf, Soccer, Racing, TCG).
 */
const SPORT_TO_PATH: Record<string, string> = {
  MLB: "baseball",
  NBA: "basketball",
  NFL: "football",
  NHL: "hockey",
};

/** Reverse of SPORT_TO_PATH plus the literal lowercase forms, used
 *  when resolving an inbound URL segment back to the DB sport. */
const PATH_TO_SPORT_CANDIDATES: Record<string, string[]> = {
  baseball: ["MLB"],
  basketball: ["NBA"],
  football: ["NFL"],
  hockey: ["NHL"],
};

export function sportPath(sport: string): string {
  return SPORT_TO_PATH[sport] ?? sport.toLowerCase();
}

/** Returns every plausible Product.sport value for a given URL
 *  segment. Most sports map 1:1; the canonical four are the
 *  exceptions. */
export function sportsFromPath(seg: string): string[] {
  const lower = seg.toLowerCase();
  const canonical = PATH_TO_SPORT_CANDIDATES[lower];
  if (canonical) return canonical;
  // Try a case-insensitive title match for unmapped sports
  // ("golf" → "Golf", "racing" → "Racing", etc.)
  return [lower.charAt(0).toUpperCase() + lower.slice(1), lower];
}

export function manufacturerSlug(m: string): string {
  return m
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Extract the year-like prefix from a product name. Handles plain
 * `2025` and dual-season `2025-26` forms (NBA / NHL releases).
 */
export function yearFromName(name: string): string | null {
  const m = name.match(/\b(20\d{2}(?:-\d{2})?)\b/);
  return m ? m[1] : null;
}

export function productSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Compute the canonical /<sport>/<mfr>/<year>/<slug> path for a
 * product. Returns null when we can't construct one (missing
 * manufacturer or year not in the name) — caller should fall back to
 * the legacy /products/[id] form.
 */
export function productPath(p: {
  sport: string;
  manufacturer: string | null;
  name: string;
}): string | null {
  if (!p.manufacturer) return null;
  const year = yearFromName(p.name);
  if (!year) return null;
  return `/${sportPath(p.sport)}/${manufacturerSlug(
    p.manufacturer,
  )}/${year}/${productSlug(p.name)}`;
}
