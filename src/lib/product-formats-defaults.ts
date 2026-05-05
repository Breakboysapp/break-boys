/**
 * Default box formats per product, derived from the product's name.
 *
 * Hobby-tier formats only — Hobby, Jumbo, Super Jumbo, Breaker
 * Delight (and premium variants like HTA Choice). Retail-tier
 * formats (Hanger, Mega, Mega Box, Value, Blaster, Cello, Retail
 * Choice) are intentionally excluded — the user doesn't track those.
 *
 * Pattern matches are checked in order; first hit wins. Terminal
 * fallback gives every product at least a "Hobby" entry.
 *
 * Pack/auto configs are populated where the data is widely-known
 * and stable. For unmatched specifics, only the format names are
 * seeded.
 */

export type FormatTemplate = {
  name: string;
  packsPerBox: number | null;
  cardsPerPack: number | null;
  autosPerBox: number | null;
  notes: string | null;
};

type Rule = { match: RegExp; formats: FormatTemplate[] };

const F = (
  name: string,
  packs?: number | null,
  cards?: number | null,
  autos?: number | null,
  notes?: string | null,
): FormatTemplate => ({
  name,
  packsPerBox: packs ?? null,
  cardsPerPack: cards ?? null,
  autosPerBox: autos ?? null,
  notes: notes ?? null,
});

const RULES: Rule[] = [
  // --- Premium single-Hobby products ---
  // Flagship high-end SKUs that ship as Hobby only — no retail variants.
  {
    match:
      /\b(definitive|flawless|national treasures|immaculate|origins|spectra|gilded|impeccable|allure|noir|signature series|one and one|gold standard|limited|opaque|skybox|black gold|sterling|five star|tribute|premier)\b/i,
    formats: [F("Hobby")],
  },
  {
    match: /\bpanini one\b/i,
    formats: [F("Hobby")],
  },

  // --- Bowman family ---
  {
    match: /\bbowman draft\b/i,
    formats: [
      F(
        "Hobby",
        12,
        32,
        3,
        "Standard hobby configuration. Full checklist access including Orange /75 parallels.",
      ),
      F("Jumbo", 8, 32, 4, "Bigger packs than Hobby; same checklist depth."),
      F(
        "Super Jumbo",
        5,
        120,
        5,
        "Highest auto count per box, but CANNOT pull Orange /75 parallels — those are Hobby-exclusive.",
      ),
      F(
        "Breaker Delight",
        1,
        10,
        3,
        "1 pack of 10 cards, but loaded — 3 autographs per box plus at least 3 exclusive numbered Chrome Prospects Geometric Refractors (Delight-only).",
      ),
    ],
  },
  {
    match: /\bbowman chrome\b/i,
    formats: [
      F("Hobby", 18, 4, 2),
      F("HTA Choice", 12, 4, 1),
      F(
        "Breaker Delight",
        1,
        10,
        3,
        "Delight-exclusive Geometric Refractors and high auto density.",
      ),
    ],
  },
  {
    match: /\bbowman\b/i,
    formats: [
      F("Hobby", 24, 10, 2),
      F("Jumbo", 12, 32, 3),
      F("Breaker Delight", 1, 10, 3),
    ],
  },

  // --- Topps Chrome family ---
  {
    match:
      /\btopps chrome (sapphire|black|cosmic|update|logofractor|platinum anniversary)\b/i,
    formats: [F("Hobby")],
  },
  // Football has more hobby SKUs than Baseball/Basketball — Jumbo +
  // Breaker Delight in addition to standard Hobby.
  {
    match: /\btopps chrome football\b/i,
    formats: [
      F("Hobby", 24, 4, 2),
      F("Jumbo", 12, 12, 3),
      F("Breaker Delight", 1, 10, 3),
    ],
  },
  {
    match: /\btopps chrome\b/i,
    formats: [F("Hobby", 24, 4, 2)],
  },
  {
    match: /\btopps finest\b/i,
    formats: [F("Hobby")],
  },

  // --- Topps flagship (Series 1/2/Update / Heritage) ---
  {
    match: /\btopps (series|update)\b/i,
    formats: [
      F("Hobby", 24, 14, 1),
      F("Jumbo", 10, 46, 3),
    ],
  },
  {
    match: /\btopps heritage\b/i,
    formats: [
      F("Hobby", 24, 9, 1),
      F("Jumbo", 12, 25, 2),
    ],
  },

  // --- Panini flagship ---
  // Single Hobby for everything — Panini's retail spread (Cello /
  // Choice / Blaster / Mega) is excluded per user preference.
  {
    match: /\bpanini (prizm|mosaic|select)\b/i,
    formats: [F("Hobby")],
  },
  {
    match:
      /\bpanini (donruss|absolute|phoenix|contenders|illusions|zenith|chronicles|rookies & stars|score)\b/i,
    formats: [F("Hobby")],
  },
  {
    match: /\bdonruss racing\b/i,
    formats: [F("Hobby")],
  },

  // --- Upper Deck ---
  {
    match: /\bupper deck (allure|flair|world of sports)\b/i,
    formats: [F("Hobby")],
  },
  {
    match: /\bo-pee-chee( platinum)?\b/i,
    formats: [F("Hobby")],
  },
  // Rush of Ikorr — Upper Deck's TCG, booster-driven (kept since
  // these are TCG packs, not 'retail' in the sports-card sense).
  {
    match: /rush of ikorr/i,
    formats: [F("Booster Box"), F("Booster Pack")],
  },

  // --- Terminal fallback ---
  { match: /.*/, formats: [F("Hobby")] },
];

/**
 * Returns the default formats for a given product name.
 * Pattern-matched, deterministic. Re-running on the same name always
 * returns the same list — important since the seed upserts on
 * (productId, name) and we don't want subsequent runs to reorder or
 * mutate user edits.
 */
export function defaultFormatsForProduct(name: string): FormatTemplate[] {
  for (const rule of RULES) {
    if (rule.match.test(name)) return rule.formats;
  }
  return [F("Hobby")];
}

/**
 * Set of format names that are explicitly retail-tier and should be
 * deleted from the DB during the seed cleanup pass. Used by the
 * seed script to clean up rows from previous heuristics.
 */
export const RETAIL_FORMAT_NAMES = new Set([
  "Hanger",
  "Mega",
  "Mega Box",
  "Value",
  "Blaster",
  "Cello",
  "Choice",
  "Retail",
]);
