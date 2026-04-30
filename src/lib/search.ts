/**
 * Server-safe helpers used by both the home page and calendar page when
 * building filter facets. Lives in `src/lib` (no `"use client"`) so server
 * components can call them — keeping them in the SearchFilters component
 * file would mark them as client-only.
 */

/** First year mentioned in a product name (e.g. "2025-26 Topps" → "2025"). */
export function extractYear(name: string): string | null {
  const m = name.match(/\b(19|20)\d{2}\b/);
  return m ? m[0] : null;
}

/**
 * Every year mentioned in a product name. For NBA/NHL season-range names
 * like "2025-26 Topps Basketball" or "2024-25 Panini Prizm Basketball",
 * this returns BOTH years — so the year filter chip surfaces the product
 * under either selection.
 *
 * Single-year names like "2026 Topps Chrome Black Baseball" return one year.
 */
export function extractYears(name: string): string[] {
  // Match standalone 4-digit years, plus season ranges like "2025-26"
  // (which the simple regex would only capture the leading 2025 of). For
  // ranges, we manually compute the second year.
  const years = new Set<string>();
  // Standalone matches
  const matches = name.match(/\b(19|20)\d{2}\b/g) ?? [];
  for (const m of matches) years.add(m);
  // Season-range expansion: "2025-26" → also add "2026"; "2019-20" → "2020"
  const rangeMatches = name.match(/\b(19|20)\d{2}-\d{2}\b/g) ?? [];
  for (const m of rangeMatches) {
    const [first, suffix] = m.split("-");
    const century = first.slice(0, 2); // "20"
    const secondYear = `${century}${suffix}`;
    years.add(secondYear);
  }
  return [...years];
}

/**
 * Best-effort release time for sort ordering. Uses the explicit
 * `releaseDate` when set; otherwise infers from the latest year mentioned
 * in the name (mid-year as a coarse default — sorts year-by-year sensibly
 * without claiming false precision).
 */
export function inferReleaseTime(p: {
  name: string;
  releaseDate: Date | null;
}): number {
  if (p.releaseDate) return p.releaseDate.getTime();
  const years = extractYears(p.name);
  if (years.length === 0) return 0;
  // Use the LATEST year (so "2025-26" sorts as 2026)
  const latest = years.sort()[years.length - 1];
  return new Date(`${latest}-07-01T00:00:00Z`).getTime();
}

export function uniqueSorted(values: Array<string | null | undefined>): string[] {
  const set = new Set<string>();
  for (const v of values) if (v) set.add(v);
  return [...set].sort((a, b) => b.localeCompare(a, "en", { numeric: true }));
}
