/**
 * One-off seed: add the wave of Topps products released after the June 2026
 * catalog update — one new Topps Chrome Baseball and every Topps NFL / NBA
 * product that has hit Beckett since. Scoped to just these products so
 * re-running never touches any other catalog entry. The only delete is
 * per-product, right before re-inserting cards, so it's idempotent.
 *
 *   npx tsx scripts/seed-2026-topps-new-releases.ts
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
  // Baseball — one new flagship-Chrome release
  {
    name: "2026 Topps Chrome Baseball",
    sport: "MLB",
    slug: "2026-topps-chrome-baseball-cards",
    releaseDate: "2026-07-22",
  },

  // NFL — Topps returned to football and has been dropping product after
  // product. Everything Beckett has posted a checklist for that isn't
  // already in our catalog.
  {
    name: "2025 Topps Chrome Sapphire Football",
    sport: "NFL",
    slug: "2025-topps-chrome-sapphire-football-cards",
    releaseDate: "2026-05-22",
  },
  {
    name: "2025 Topps Cosmic Chrome Football",
    sport: "NFL",
    slug: "2025-topps-cosmic-chrome-football-cards",
    releaseDate: "2026-06-19",
  },
  {
    name: "2025 Topps Chrome Black Football",
    sport: "NFL",
    slug: "2025-topps-chrome-black-football-cards",
    releaseDate: "2026-07-10",
  },
  {
    name: "2026 Topps Football",
    sport: "NFL",
    slug: "2026-topps-football-cards",
    releaseDate: "2026-08-21",
  },

  // NBA — two new brands post-June
  {
    name: "2025-26 Topps Inception Basketball",
    sport: "NBA",
    slug: "2025-26-topps-inception-basketball-cards",
    releaseDate: "2026-07-23",
  },
  {
    name: "2025-26 Topps Chrome Update Basketball",
    sport: "NBA",
    slug: "2025-26-topps-chrome-update-basketball-cards",
    releaseDate: "2026-08-06",
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
