/**
 * Detect manufacturer from a product name. Order matters — more specific
 * sub-brands first so "Bowman Chrome" doesn't get caught by "Topps".
 *
 * Used at product-creation time (NewProductForm) and as a backfill helper
 * for products imported before the manufacturer column existed.
 */

const MANUFACTURER_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /\bbowman\b/i, name: "Bowman" },
  { pattern: /\bstadium club\b/i, name: "Stadium Club" },
  { pattern: /\bpanini\b/i, name: "Panini" },
  { pattern: /\btopps\b/i, name: "Topps" },
  { pattern: /\bupper deck\b/i, name: "Upper Deck" },
  { pattern: /\bleaf\b/i, name: "Leaf" },
  { pattern: /\bonyx\b/i, name: "Onyx" },
  { pattern: /\bwild card\b/i, name: "Wild Card" },
  { pattern: /\bsage\b/i, name: "Sage" },
  { pattern: /\bfanatics\b/i, name: "Fanatics" },
];

export const KNOWN_MANUFACTURERS = MANUFACTURER_PATTERNS.map((p) => p.name);

export function detectManufacturer(text: string): string | null {
  for (const { pattern, name } of MANUFACTURER_PATTERNS) {
    if (pattern.test(text)) return name;
  }
  return null;
}
