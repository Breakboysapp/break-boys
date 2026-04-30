/**
 * Server-safe helpers used by both the home page and calendar page when
 * building filter facets. Lives in `src/lib` (no `"use client"`) so server
 * components can call them — keeping them in the SearchFilters component
 * file would mark them as client-only.
 */

export function extractYear(name: string): string | null {
  const m = name.match(/\b(19|20)\d{2}\b/);
  return m ? m[0] : null;
}

export function uniqueSorted(values: Array<string | null | undefined>): string[] {
  const set = new Set<string>();
  for (const v of values) if (v) set.add(v);
  return [...set].sort((a, b) => b.localeCompare(a, "en", { numeric: true }));
}
