/**
 * Quick coverage analysis: for a given product, group cards by variation
 * and show the hit rate per variation. Tells us whether PriceCharting is
 * thin on base cards (expected) or missing valuable inserts/autos (bad).
 *
 *   npx tsx scripts/analyze-coverage.ts <productId>
 */
import { PrismaClient } from "@prisma/client";

async function main() {
  const productId = process.argv[2];
  if (!productId) {
    console.error("Usage: tsx scripts/analyze-coverage.ts <productId>");
    process.exit(1);
  }
  const prisma = new PrismaClient();
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { name: true },
  });
  if (!product) {
    console.error("product not found");
    process.exit(1);
  }
  const cards = await prisma.card.findMany({
    where: { productId },
    select: {
      cardNumber: true,
      playerName: true,
      variation: true,
      marketValueCents: true,
    },
  });

  console.log(`\n${product.name} — ${cards.length} cards\n`);

  // Group by variation
  const byVariation = new Map<
    string,
    { hit: number; miss: number; valueCents: number[] }
  >();
  for (const c of cards) {
    const v = c.variation || "(base)";
    if (!byVariation.has(v)) {
      byVariation.set(v, { hit: 0, miss: 0, valueCents: [] });
    }
    const g = byVariation.get(v)!;
    if (c.marketValueCents != null) {
      g.hit++;
      g.valueCents.push(c.marketValueCents);
    } else {
      g.miss++;
    }
  }

  const rows = Array.from(byVariation.entries()).map(([v, g]) => {
    const total = g.hit + g.miss;
    const rate = total > 0 ? Math.round((g.hit / total) * 100) : 0;
    const avg =
      g.valueCents.length > 0
        ? g.valueCents.reduce((a, b) => a + b, 0) / g.valueCents.length
        : 0;
    return { variation: v, total, hit: g.hit, rate, avg };
  });
  rows.sort((a, b) => b.total - a.total);

  console.log(
    "Variation".padEnd(40) +
      "Total".padStart(7) +
      "Hits".padStart(7) +
      "Rate".padStart(7) +
      "  Avg",
  );
  console.log("-".repeat(75));
  for (const r of rows) {
    console.log(
      r.variation.slice(0, 40).padEnd(40) +
        String(r.total).padStart(7) +
        String(r.hit).padStart(7) +
        `${r.rate}%`.padStart(7) +
        `  $${(r.avg / 100).toFixed(2)}`,
    );
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
