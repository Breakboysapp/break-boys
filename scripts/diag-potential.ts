/**
 * Show the new "potential" math for given player(s) — uses the real
 * computeBreakdown logic so we see what the score card will actually
 * render after the synthetic-estimate change.
 *
 *   npx tsx scripts/diag-potential.ts <productId> "Mike Trout" "Nolan Ryan"
 */
import { PrismaClient } from "@prisma/client";
import { computeBreakdown } from "../src/lib/scoring";

async function main() {
  const productId = process.argv[2];
  const filter = process.argv.slice(3);
  if (!productId) {
    console.error(
      'Usage: tsx scripts/diag-potential.ts <productId> ["Player A" "Player B" ...]',
    );
    process.exit(1);
  }
  const prisma = new PrismaClient();
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { name: true },
  });
  console.log(`\n${product?.name}\n`);

  const cards = await prisma.card.findMany({
    where: { productId },
    select: {
      cardNumber: true,
      team: true,
      playerName: true,
      variation: true,
      marketValueCents: true,
    },
  });

  const { rows } = computeBreakdown(cards, "playerName");
  // If no filter, show top 10 by potential
  const sorted = rows
    .filter((r) =>
      filter.length === 0
        ? true
        : filter.some((f) => r.name.toLowerCase().includes(f.toLowerCase())),
    )
    .sort((a, b) => b.totalPotentialCents - a.totalPotentialCents);

  const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
  console.log(
    "Player".padEnd(28) +
      "Cards".padStart(7) +
      "Score".padStart(8) +
      "Confirmed".padStart(13) +
      "Potential".padStart(13) +
      "Top hit".padStart(11) +
      "  Conf%",
  );
  console.log("-".repeat(85));
  for (const r of (filter.length ? sorted : sorted.slice(0, 12))) {
    const confPct = r.totalCards > 0
      ? Math.round((r.cardsWithMarket / r.totalCards) * 100)
      : 0;
    console.log(
      r.name.slice(0, 28).padEnd(28) +
        String(r.totalCards).padStart(7) +
        String(r.totalScore).padStart(8) +
        fmt(r.confirmedMarketCents).padStart(13) +
        fmt(r.totalPotentialCents).padStart(13) +
        fmt(r.maxPotentialCents).padStart(11) +
        `  ${confPct}%`,
    );
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
