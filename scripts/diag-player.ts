/**
 * Quick diagnostic — show every card for given players in a product,
 * with their classified weight and current market value. Used to debug
 * cases like "Nolan Ryan ranking above Mike Trout for the Angels."
 *
 *   npx tsx scripts/diag-player.ts <productId> "Mike Trout" "Nolan Ryan"
 */
import { PrismaClient } from "@prisma/client";
import { classifyCard } from "../src/lib/scoring";

async function main() {
  const productId = process.argv[2];
  const players = process.argv.slice(3);
  if (!productId || players.length === 0) {
    console.error(
      'Usage: tsx scripts/diag-player.ts <productId> "Player A" "Player B" ...',
    );
    process.exit(1);
  }
  const prisma = new PrismaClient();
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { name: true },
  });
  console.log(`\n${product?.name}\n`);

  for (const player of players) {
    const cards = await prisma.card.findMany({
      where: {
        productId,
        playerName: { contains: player, mode: "insensitive" },
      },
      select: {
        cardNumber: true,
        playerName: true,
        team: true,
        variation: true,
        marketValueCents: true,
      },
      orderBy: { cardNumber: "asc" },
    });

    let totalScore = 0;
    let totalMarket = 0;
    let withMarket = 0;
    console.log(`=== ${player} (${cards.length} cards) ===`);
    for (const c of cards) {
      const cls = classifyCard(c.cardNumber, c.variation);
      totalScore += cls.weight;
      const m = c.marketValueCents;
      if (m != null && m > 0) {
        totalMarket += m;
        withMarket++;
      }
      const mDisp = m != null ? `$${(m / 100).toFixed(2)}` : "—";
      console.log(
        `  ${c.cardNumber.padEnd(8)} ${(c.variation ?? "(base)").slice(0, 36).padEnd(36)} weight=${cls.weight}  ${mDisp}  ${c.playerName}`,
      );
    }
    console.log(
      `  → totalScore=${totalScore}  totalMarket=$${(totalMarket / 100).toFixed(2)}  marketCoverage=${withMarket}/${cards.length}\n`,
    );
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
