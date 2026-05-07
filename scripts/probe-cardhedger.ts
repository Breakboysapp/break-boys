/**
 * Sanity-check the Card Hedger integration.
 *
 * Run with:
 *   npx tsx scripts/probe-cardhedger.ts
 *
 * Requires CARD_HEDGER_API set in .env. Picks a high-signal card from
 * our DB (Ohtani 2025 Topps Chrome if present, else any card with a
 * known PSA 10 price) and exercises the four endpoints we'll lean on
 * most: card-match → all-prices-by-card → price-estimate → top-movers.
 *
 * Read the printed output. If card-match returns confidence > 0.8 and
 * all-prices-by-card returns sensible cents, the wiring is good. If
 * anything 401s the env var probably has a stray newline; if anything
 * 404s the doc paths drifted.
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
  getAllPricesByCard,
  getPriceEstimate,
  getTopMovers,
  matchCard,
} from "../src/lib/sources/pricing/cardhedger";

const prisma = new PrismaClient();

async function main() {
  if (!process.env.CARD_HEDGER_API) {
    console.error("CARD_HEDGER_API not set in .env — bailing.");
    process.exit(1);
  }

  // Pick a card that's likely indexed on Card Hedger's side. Ohtani's
  // base/auto in 2025 Topps Chrome is a safe bet — high volume, mainline
  // product. Fall back to any card with PSA 10 data we already imported
  // from PriceCharting.
  const card = await prisma.card.findFirst({
    where: {
      playerName: "Shohei Ohtani",
      product: { name: { contains: "Topps Chrome", mode: "insensitive" } },
      psa10Cents: { gt: 0 },
    },
    include: { product: { select: { name: true } } },
  });
  if (!card) {
    console.error("No suitable test card in DB; expected an Ohtani PC entry.");
    process.exit(1);
  }

  const queryText = [
    card.product.name,
    card.cardNumber,
    card.playerName,
    card.variation,
  ]
    .filter(Boolean)
    .join(" ");
  console.log("Probe card:", queryText);
  console.log("  Our PSA 10 (PriceCharting):", card.psa10Cents, "cents");

  console.log("\n[1/4] card-match…");
  const match = await matchCard({ text: queryText, category: "Baseball" });
  console.log("       cardId:", match.cardId);
  console.log("       confidence:", match.confidence);
  console.log("       description:", match.description);

  if (match.cardId != null) {
    console.log("\n[2/4] all-prices-by-card…");
    const all = await getAllPricesByCard(match.cardId);
    console.log(
      "       grades returned:",
      all.prices.map((p) => `${p.grade}=${p.cents}c`).join(", "),
    );

    console.log("\n[3/4] price-estimate (PSA 10)…");
    const est = await getPriceEstimate(match.cardId, "PSA 10");
    console.log(
      "       cents:",
      est.cents,
      "low:",
      est.centsLow,
      "high:",
      est.centsHigh,
      "conf:",
      est.confidence,
      "method:",
      est.method,
    );
  } else {
    console.log("       (skipping price probes — match returned null)");
  }

  console.log("\n[4/4] top-movers…");
  const movers = await getTopMovers();
  console.log("       received", movers.length, "movers");
  for (const m of movers.slice(0, 5)) {
    console.log(
      `         · ${m.description} (${m.grade ?? "raw"}) — ${m.cents}c, ${m.gainPct.toFixed(1)}%`,
    );
  }

  await prisma.$disconnect();
  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
