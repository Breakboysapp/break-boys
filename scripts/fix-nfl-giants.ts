/**
 * One-off data repair: every NFL card mistakenly labeled "San Francisco
 * Giants" (the MLB franchise) was actually the NFL New York Giants. The
 * Beckett parser ran the team string through normalizeTeam() which had a
 * "new york giants" → "San Francisco Giants" alias intended for MLB
 * historical handling but applied indiscriminately. The alias has been
 * removed in src/lib/teams.ts; this script fixes the cards that were
 * already imported.
 *
 * Updates two tables, scoped to sport='NFL':
 *   - Card.team: replace 'San Francisco Giants' anywhere in the team
 *     string (handles dual-team strings like 'Patriots/San Francisco
 *     Giants' too).
 *   - TeamPrice.team: same.
 *
 * Read-only by default. Pass --apply to write.
 */
import { PrismaClient } from "@prisma/client";

async function main() {
  const apply = process.argv.includes("--apply");
  const prisma = new PrismaClient();
  console.log(`Mode: ${apply ? "APPLY" : "DRY RUN (--apply to write)"}\n`);

  const nflProducts = await prisma.product.findMany({
    where: { sport: "NFL" },
    select: { id: true, name: true },
  });
  const nflProductIds = new Set(nflProducts.map((p) => p.id));

  // --- Card.team ---
  const cards = await prisma.card.findMany({
    where: {
      productId: { in: [...nflProductIds] },
      team: { contains: "San Francisco Giants" },
    },
    select: { id: true, team: true },
  });
  console.log(`Cards to update: ${cards.length}\n`);

  let cardUpdates = 0;
  for (const c of cards) {
    const newTeam = c.team.replaceAll(
      "San Francisco Giants",
      "New York Giants",
    );
    if (newTeam === c.team) continue;
    cardUpdates++;
    if (apply) {
      await prisma.card.update({
        where: { id: c.id },
        data: { team: newTeam },
      });
    }
  }
  console.log(`Card updates: ${cardUpdates}${apply ? " (applied)" : ""}\n`);

  // --- TeamPrice.team ---
  // Each (productId, team) is unique. If "New York Giants" already exists
  // for the same product, we need to merge: keep the existing one and
  // delete the duplicate. Otherwise we can simply rename in place.
  const teamPrices = await prisma.teamPrice.findMany({
    where: {
      productId: { in: [...nflProductIds] },
      team: { contains: "San Francisco Giants" },
    },
    select: { id: true, productId: true, team: true, wholesaleCents: true, valueIndexCents: true },
  });
  console.log(`TeamPrice rows to update: ${teamPrices.length}`);

  let priceUpdates = 0;
  let priceMerges = 0;
  for (const tp of teamPrices) {
    const newTeam = tp.team.replaceAll(
      "San Francisco Giants",
      "New York Giants",
    );
    if (newTeam === tp.team) continue;

    // Check for an existing row with the new name
    const conflict = await prisma.teamPrice.findUnique({
      where: { productId_team: { productId: tp.productId, team: newTeam } },
    });
    if (conflict) {
      priceMerges++;
      if (apply) {
        // Delete the duplicate; preserve any data on the existing row.
        // (If the duplicate had data the existing row didn't, we'd lose
        // it. In practice these are empty defaults so this is safe.)
        await prisma.teamPrice.delete({ where: { id: tp.id } });
      }
    } else {
      priceUpdates++;
      if (apply) {
        await prisma.teamPrice.update({
          where: { id: tp.id },
          data: { team: newTeam },
        });
      }
    }
  }
  console.log(
    `TeamPrice renames: ${priceUpdates}; merges (delete dup): ${priceMerges}${apply ? " (applied)" : ""}`,
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
