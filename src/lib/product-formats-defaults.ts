/**
 * Default box formats per product, derived from the product's name.
 *
 * Modern card products almost always come in a known set of box
 * configurations. Topps Chrome → Hobby + Mega + Hanger; Bowman Draft
 * → Hobby + Jumbo + Super Jumbo + Mega + Breaker Delight; Definitive
 * is a single Hobby SKU; etc. Rather than asking each user to type
 * those in (they won't), we infer from the product name and seed the
 * ProductFormat rows automatically.
 *
 * Pattern matches are checked in order — first hit wins. The terminal
 * fallback is a single "Hobby" so every product gets at least one
 * format; the user (or future me) can swap in a more accurate set if
 * a heuristic is wrong.
 *
 * Pack/auto configs are populated where the data is widely-known and
 * stable (same numbers across years for the same product line). For
 * everything else, only the format NAMES are seeded; users can fill
 * in pack/auto details on the product page if they care, but the
 * names already make the format selector useful.
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

// Most specific patterns first — premium one-format products before
// the brand-level catch-alls.
const RULES: Rule[] = [
  // --- Premium single-Hobby products ---
  // These are flagship high-end SKUs that typically only ship as a
  // hobby-level box. No retail / mega / jumbo variant exists.
  {
    match:
      /\b(definitive|flawless|national treasures|immaculate|origins|spectra|gilded|impeccable|allure|noir|signature series|one and one|gold standard|limited|opaque|skybox|black gold|sterling|five star|tribute|premier)\b/i,
    formats: [F("Hobby")],
  },
  // Panini "Topps One" / "Panini One" single-format premium
  {
    match: /\bpanini one\b/i,
    formats: [F("Hobby")],
  },

  // --- Bowman family (most variability) ---
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
        "Mega Box",
        7,
        5,
        null,
        "Mega-exclusive: Bowman In Action Mojo die-cuts, Prized Prospects Mojo, Chrome Prospect Mega Autographs, Chrome Prospects Laser Refractors. Two exclusive Chrome packs per box.",
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
      F("Mega Box", 7, 4, null, "Mega-exclusive parallels."),
    ],
  },
  {
    match: /\bbowman\b/i,
    formats: [
      F("Hobby", 24, 10, 2),
      F("Jumbo", 12, 32, 3),
      F("Mega Box", 8, 5),
      F("Hanger", 1, 35),
    ],
  },

  // --- Topps Chrome family ---
  // Premium variants like Sapphire / Black / Cosmic / Update / Logofractor
  // each ship as a single Hobby SKU.
  {
    match:
      /\btopps chrome (sapphire|black|cosmic|update|logofractor|platinum anniversary)\b/i,
    formats: [F("Hobby")],
  },
  {
    match: /\btopps chrome\b/i,
    formats: [
      F("Hobby", 24, 4, 2),
      F("Mega Box", 7, 4),
      F("Hanger", 1, 25),
    ],
  },
  // Topps Finest (premium hobby/mega only)
  {
    match: /\btopps finest\b/i,
    formats: [F("Hobby"), F("Mega Box")],
  },

  // --- Topps flagship (Series 1/2/Update) ---
  {
    match: /\btopps (series|update)\b/i,
    formats: [
      F("Hobby", 24, 14, 1),
      F("Jumbo", 10, 46, 3),
      F("Mega Box", 5, 12),
      F("Hanger", 1, 67),
      F("Blaster", 7, 8),
      F("Retail", 36, 14),
    ],
  },
  {
    match: /\btopps heritage\b/i,
    formats: [
      F("Hobby", 24, 9, 1),
      F("Jumbo", 12, 25, 2),
      F("Mega Box", 8, 9),
      F("Hanger", 1, 35),
    ],
  },

  // --- Panini flagship hobby + retail spread ---
  // Prizm / Mosaic / Select / Donruss — all share a similar Hobby +
  // Cello + Mega + Choice + Hanger profile, with minor SKU variance.
  {
    match: /\bpanini (prizm|mosaic|select)\b/i,
    formats: [
      F("Hobby"),
      F("Cello"),
      F("Mega Box"),
      F("Choice"),
      F("Hanger"),
    ],
  },
  // Donruss Racing (NASCAR) is single Hobby — must be checked BEFORE
  // the generic Panini Donruss rule below or it gets the multi-format
  // catch-all by mistake.
  {
    match: /\bdonruss racing\b/i,
    formats: [F("Hobby")],
  },
  {
    match:
      /\bpanini (donruss|absolute|phoenix|contenders|illusions|zenith|chronicles|rookies & stars|score)\b/i,
    formats: [F("Hobby"), F("Cello"), F("Mega Box"), F("Hanger")],
  },

  // --- Upper Deck ---
  {
    match: /\bupper deck (allure|flair|world of sports)\b/i,
    formats: [F("Hobby")],
  },
  {
    match: /\bo-pee-chee platinum\b/i,
    formats: [F("Hobby"), F("Blaster")],
  },
  {
    match: /\bo-pee-chee\b/i,
    formats: [F("Hobby"), F("Blaster"), F("Hanger")],
  },
  // Rush of Ikorr — Upper Deck's TCG, booster-driven
  {
    match: /rush of ikorr/i,
    formats: [F("Booster Box"), F("Booster Pack")],
  },

  // --- Terminal fallback: any product unmatched gets a single Hobby ---
  // Far better than an empty editor; the user can edit if needed.
  { match: /.*/, formats: [F("Hobby")] },
];

/**
 * Returns the default formats for a given product name.
 *
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
