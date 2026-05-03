/**
 * One-off seed: add 2023 Bowman Chrome Baseball + 2023 Bowman Draft Baseball
 * with their Beckett checklists. Mirrors seed-from-beckett-direct.ts but
 * scoped to just these two products so re-running doesn't re-seed the
 * entire catalog.
 *
 *   npx tsx scripts/seed-2023-bowman.ts
 */
import { PrismaClient } from "@prisma/client";
import { beckett } from "../src/lib/sources/checklist/beckett";
import { detectManufacturer } from "../src/lib/manufacturer";

const PRODUCTS: Array<{
  name: string;
  sport: string;
  slug: string;
  releaseDate: string;
}> = [
  {
    name: "2023 Bowman Chrome Baseball",
    sport: "MLB",
    slug: "2023-bowman-chrome-baseball-cards",
    releaseDate: "2023-08-09",
  },
  {
    name: "2023 Bowman Draft Baseball",
    sport: "MLB",
    slug: "2023-bowman-draft-baseball-cards",
    releaseDate: "2024-01-10",
  },
];

async function run() {
  const prisma = new PrismaClient();
  const dbHost = process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] ?? "(unknown)";
  console.log(`Seeding ${PRODUCTS.length} products to ${dbHost}\n`);

  for (const p of PRODUCTS) {
    console.log(`→ ${p.name}`);

    const manufacturer = detectManufacturer(p.name);
    const releaseDate = new Date(p.releaseDate + "T00:00:00Z");

    let product = await prisma.product.findFirst({ where: { name: p.name } });
    if (!product) {
      product = await prisma.product.create({
        data: { name: p.name, sport: p.sport, manufacturer, releaseDate },
      });
      console.log(`  + created (id=${product.id})`);
    } else {
      // Backfill any missing fields without overwriting good data.
      const updates: { manufacturer?: string; releaseDate?: Date } = {};
      if (!product.manufacturer && manufacturer) updates.manufacturer = manufacturer;
      if (!product.releaseDate) updates.releaseDate = releaseDate;
      if (Object.keys(updates).length > 0) {
        await prisma.product.update({ where: { id: product.id }, data: updates });
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

    // Idempotent: clear existing cards before re-inserting.
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
