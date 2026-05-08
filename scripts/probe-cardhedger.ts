/**
 * Sanity-check the Card Hedger integration against the recommended
 * calls list (https://api.cardhedger.com/docs).
 *
 * Run with (Node 20+ has --env-file built in):
 *   npx tsx --env-file=.env scripts/probe-cardhedger.ts
 *
 * Requires CARD_HEDGER_API set in .env. Picks a high-signal card from
 * our DB (Ohtani 2025 Topps Chrome) and exercises:
 *   1. card-match           → resolves our card to a CH card_id
 *   2. card-details         → metadata + display-only top prices
 *   3. all-prices-by-card   → real prices across every grade
 *   4. prices-by-card       → 90-day price series for charts
 *   5. comps                → anomaly-filtered recent comps
 *
 * Read the printed output. card-match confidence > 0.7 + sensible cents
 * on all-prices-by-card means the wiring is good. 401 = key issue,
 * 404 = endpoint path drifted, schema mismatches in response = field
 * names differ from what the OpenAPI spec said.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

// Manually load .env when --env-file wasn't passed. Node 20's
// --env-file is the official way; this fallback parses the .env so
// `npx tsx scripts/probe-cardhedger.ts` works too without extra
// flags. Lines like `KEY=value` only — anything quoted or with
// expansions falls through to process.env.
function ensureEnvLoaded(): void {
  if (process.env.CARD_HEDGER_API) return;
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
      if (!m) continue;
      const [, key, val] = m;
      if (process.env[key] != null) continue;
      // Strip surrounding quotes if present.
      process.env[key] = val.replace(/^["'](.*)["']$/, "$1");
    }
  } catch {
    // .env missing — caller will throw on missing var below.
  }
}
ensureEnvLoaded();
import {
  getAllPricesByCard,
  getCardDetails,
  getComps,
  getPricesByCard,
  matchCard,
  searchCards,
} from "../src/lib/sources/pricing/cardhedger";

const prisma = new PrismaClient();

async function main() {
  if (!process.env.CARD_HEDGER_API) {
    console.error("CARD_HEDGER_API not set in .env — bailing.");
    process.exit(1);
  }

  // Pick the simplest possible card first — Ohtani #1 BASE in 2025
  // Topps Chrome (no parallel). Bumps our chance of a clean match
  // against Card Hedger's catalog vs. a /1 Sepia variant.
  const card = await prisma.card.findFirst({
    where: {
      playerName: "Shohei Ohtani",
      product: { name: { contains: "Topps Chrome", mode: "insensitive" } },
      cardNumber: "1",
      OR: [
        { variation: null },
        { variation: { equals: "" } },
        { variation: { contains: "Base", mode: "insensitive" } },
      ],
    },
    include: { product: { select: { name: true } } },
  });
  if (!card) {
    console.error("No base Ohtani #1 in DB; falling back to any priced entry.");
    process.exit(1);
  }

  // Try a few query phrasings to see which Card Hedger's matcher likes.
  const queries = [
    `${card.product.name} ${card.playerName} #${card.cardNumber}`.trim(),
    `${card.product.name} ${card.playerName}`.trim(),
    `${card.playerName} ${card.product.name.replace(/\D+/g, " ").trim()} #${card.cardNumber}`.trim(),
  ];
  console.log("Probe card:", card.product.name, "#" + card.cardNumber, card.playerName);
  console.log("  variation:", card.variation ?? "(base)");
  console.log("  PSA 10 (PriceCharting):", card.psa10Cents, "cents\n");

  let match: Awaited<ReturnType<typeof matchCard>> | null = null;
  for (const q of queries) {
    console.log("[1/5] card-match …", JSON.stringify(q));
    const r = await matchCard({ query: q, category: "Baseball" });
    console.log(
      "       cardId:",
      r.cardId,
      "confidence:",
      r.confidence,
      "description:",
      r.description,
    );
    if (r.cardId != null) {
      match = r;
      break;
    }
  }

  // If matchCard whiffed, fall back to a structured search — confirms
  // the catalog has the card (and gives us the real description format
  // Card Hedger uses, useful for tuning the match query).
  let resolvedCardId: string | null = match?.cardId ?? null;
  let resolvedDescription: string | null = match?.description ?? null;
  if (resolvedCardId == null) {
    console.log("\n[1b] card-search fallback (player + set) …");
    const search = await searchCards({
      player: card.playerName,
      set: card.product.name,
      pageSize: 5,
    });
    console.log("       hits:", search.count);
    for (const h of search.cards) {
      console.log(
        `         · #${h.cardId} ${h.description} (set=${h.set} #${h.cardNumber})`,
      );
    }
    if (search.cards[0]) {
      resolvedCardId = search.cards[0].cardId;
      resolvedDescription = search.cards[0].description;
    }
  }
  console.log("       cardId:", resolvedCardId);
  console.log("       description:", resolvedDescription);

  if (resolvedCardId == null) {
    console.log("\n  match returned null — skipping card_id-based probes.");
    await prisma.$disconnect();
    return;
  }

  console.log("\n[2/5] card-details …");
  const details = await getCardDetails(resolvedCardId);
  console.log("       set:", details.set);
  console.log("       player:", details.player);
  console.log("       cardNumber:", details.cardNumber);
  console.log("       rookie:", details.rookie);
  console.log(
    "       topPrices (display-only):",
    details.topPrices.map((p) => `${p.grade}=${p.cents}c`).join(", "),
  );

  console.log("\n[3/5] all-prices-by-card …");
  const all = await getAllPricesByCard(resolvedCardId);
  console.log(
    "       grades returned:",
    all.prices
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((p) => `${p.grade}=${p.cents}c`)
      .join(", "),
  );

  console.log("\n[4/5] prices-by-card (PSA 10, 90 days) …");
  const series = await getPricesByCard({
    cardId: resolvedCardId,
    grade: "PSA 10",
    days: 90,
  });
  console.log("       points:", series.length);
  if (series.length > 0) {
    const first = series[0];
    const last = series[series.length - 1];
    console.log(
      `       window: ${first.closingDate} (${first.cents}c) → ${last.closingDate} (${last.cents}c)`,
    );
  }

  console.log("\n[5/5] comps (PSA 10, 5 comps) …");
  const comps = await getComps({
    cardId: resolvedCardId,
    grade: "PSA 10",
    count: 5,
    timeWeighted: true,
    includeRawPrices: true,
  });
  console.log(
    `       comp: ${comps.compCents}c  high: ${comps.highCents}c  low: ${comps.lowCents}c  used: ${comps.countUsed}/${comps.countRequested}`,
  );
  for (const r of comps.rawPrices ?? []) {
    console.log(`         · ${r.saleDate} ${r.cents}c (${r.source ?? "?"})`);
  }

  await prisma.$disconnect();
  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
