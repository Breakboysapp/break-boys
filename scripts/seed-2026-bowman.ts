/**
 * One-off seed: add 2026 Bowman Baseball with its Beckett checklist.
 * Mirrors seed-2023-bowman.ts — scoped to a single product so re-running
 * doesn't disturb cards, snapshots, or market data on other products.
 *
 *   npx tsx scripts/seed-2026-bowman.ts
 *
 * releaseDate is left null; run scripts/backfill-release-dates.ts
 * afterwards to populate it from Beckett's xlsx upload month.
 */
import { PrismaClient } from "@prisma/client";
import { beckett } from "../src/lib/sources/checklist/beckett";
import { detectManufacturer } from "../src/lib/manufacturer";

const PRODUCTS: Array<{
  name: string;
  sport: string;
  slug: string;
}> = [
  {
    name: "2026 Bowman Baseball",
    sport: "MLB",
    slug: "2026-bowman-baseball-cards",
  },
];

async function run() {
  const prisma = new PrismaClient();
  const dbHost = process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] ?? "(unknown)";
  console.log(`Seeding ${PRODUCTS.length} product to ${dbHost}\n`);

  for (const p of PRODUCTS) {
    console.log(`→ ${p.name}`);

    const manufacturer = detectManufacturer(p.name);

    let product = await prisma.product.findFirst({ where: { name: p.name } });
    if (!product) {
      product = await prisma.product.create({
        data: { name: p.name, sport: p.sport, manufacturer },
      });
      console.log(`  + created (id=${product.id})`);
    } else {
      if (!product.manufacturer && manufacturer) {
        await prisma.product.update({
          where: { id: product.id },
          data: { manufacturer },
        });
      }
      console.log(`  ↺ existing (id=${product.id})`);
    }

    let result;
    try {
      const url = `https://www.beckett.com/news/${p.slug}/`;
      result = await beckett.importFrom(new URL(url));
    } catch (err) {
      console.log(`  ⚠ checklist fetch failed: ${err instanceof Error ? err.message : err}`);
      continue;
    }

    // Idempotent: clear existing cards for THIS product only before re-inserting.
    await prisma.card.deleteMany({ where: { productId: product!.id } });

    const CHUNK = 1000;
    for (let i = 0; i < result.rows.length; i += CHUNK) {
      const slice = result.rows.slice(i, i + CHUNK);
      await prisma.card.createMany({
        data: slice.map((r) => ({
          productId: product!.id,
          team: r.team,
          playerName: r.playerName,
          cardNumber: r.cardNumber,
          variation: r.variation ?? null,
        })),
      });
    }

    const teams = Array.from(new Set(result.rows.map((r) => r.team)));
    for (const team of teams) {
      await prisma.teamPrice.upsert({
        where: { productId_team: { productId: product!.id, team } },
        update: {},
        create: { productId: product!.id, team },
      });
    }

    console.log(`  ✓ ${result.rows.length} cards · ${teams.length} teams\n`);
  }

  await prisma.$disconnect();
  console.log("Done.");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
