/**
 * Direct seed: pulls checklists from Beckett locally and writes via Prisma
 * directly to whatever DATABASE_URL points at. Use when the deployed
 * /api/products/[id]/checklist/from-url endpoint is broken or slow on
 * Vercel's runtime — local execution sidesteps the serverless function
 * entirely.
 *
 *   npx tsx scripts/seed-from-beckett-direct.ts
 */
import { PrismaClient } from "@prisma/client";
import { beckett } from "../src/lib/sources/checklist/beckett";
import { detectManufacturer } from "../src/lib/manufacturer";

const PRODUCTS = [
  { name: "2026 Topps Chrome Black Baseball", sport: "MLB", slug: "2026-topps-chrome-black-baseball-cards" },
  { name: "2025 Topps Chrome Baseball", sport: "MLB", slug: "2025-topps-chrome-baseball-cards" },
  { name: "2025 Topps Series 1 Baseball", sport: "MLB", slug: "2025-topps-series-1-baseball-cards" },
  { name: "2025 Topps Series 2 Baseball", sport: "MLB", slug: "2025-topps-series-2-baseball-cards" },
  { name: "2025 Topps Heritage Baseball", sport: "MLB", slug: "2025-topps-heritage-baseball-cards" },
  { name: "2025 Topps Definitive Collection Baseball", sport: "MLB", slug: "2025-topps-definitive-baseball-cards" },
  { name: "2025 Topps Gilded Collection Baseball", sport: "MLB", slug: "2025-topps-gilded-collection-baseball-cards" },
  { name: "2025 Bowman Chrome Baseball", sport: "MLB", slug: "2025-bowman-chrome-baseball-cards" },
  { name: "2025 Bowman Draft Baseball", sport: "MLB", slug: "2025-bowman-draft-baseball-cards" },
  { name: "2024 Topps Chrome Baseball", sport: "MLB", slug: "2024-topps-chrome-baseball-checklist" },
  { name: "2025 Topps Chrome Football", sport: "NFL", slug: "2025-topps-chrome-football-cards" },
  { name: "2025 Panini Prizm Football", sport: "NFL", slug: "2025-panini-prizm-football-cards" },
  { name: "2025-26 Topps Basketball", sport: "NBA", slug: "2025-26-topps-basketball-cards" },
  { name: "2025-26 Topps Chrome Basketball", sport: "NBA", slug: "2025-26-topps-chrome-basketball-cards" },
  { name: "2025-26 Topps Cosmic Chrome Basketball", sport: "NBA", slug: "2025-26-topps-cosmic-chrome-basketball-cards" },
  { name: "2025-26 Topps Finest Basketball", sport: "NBA", slug: "2025-26-topps-finest-basketball-cards" },
  { name: "2025-26 Topps Chrome Sapphire Basketball", sport: "NBA", slug: "2025-26-topps-chrome-sapphire-basketball-cards" },
  { name: "2025-26 Bowman Basketball", sport: "NBA", slug: "2025-26-bowman-basketball-cards" },
  { name: "2024-25 Topps Chrome Basketball", sport: "NBA", slug: "2024-25-topps-chrome-basketball-cards" },
  { name: "2024-25 Panini Prizm Basketball", sport: "NBA", slug: "2024-25-panini-prizm-basketball-cards" },
];

async function run() {
  const prisma = new PrismaClient();
  console.log(`Seeding ${PRODUCTS.length} products directly to ${process.env.DATABASE_URL?.split("@")[1]?.split("/")[0]}\n`);

  for (const p of PRODUCTS) {
    process.stdout.write(`→ ${p.name}\n`);

    // Upsert the product
    const manufacturer = detectManufacturer(p.name);
    let product = await prisma.product.findFirst({ where: { name: p.name } });
    if (!product) {
      product = await prisma.product.create({
        data: { name: p.name, sport: p.sport, manufacturer },
      });
    } else if (!product.manufacturer && manufacturer) {
      await prisma.product.update({
        where: { id: product.id },
        data: { manufacturer },
      });
    }

    // Fetch + parse the checklist
    const url = `https://www.beckett.com/news/${p.slug}/`;
    let result;
    try {
      result = await beckett.importFrom(new URL(url));
    } catch (err) {
      console.log(`  ⚠ ${err instanceof Error ? err.message : err} (Coming Soon)`);
      continue;
    }

    // Replace cards. No wrapping transaction — Neon's pooled connection
    // has a short transaction window that chokes on 2k+ row inserts. If
    // the script fails partway through a product, re-running is idempotent
    // (deleteMany clears the slate first).
    await prisma.card.deleteMany({ where: { productId: product!.id } });

    // Chunk the inserts so we don't exceed Postgres parameter limits
    // (Postgres caps at 32k bind params; 4 fields × 8000 rows is safe).
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

    // Ensure a TeamPrice row exists per distinct team
    const teams = Array.from(new Set(result.rows.map((r) => r.team)));
    for (const team of teams) {
      await prisma.teamPrice.upsert({
        where: { productId_team: { productId: product!.id, team } },
        update: {},
        create: { productId: product!.id, team },
      });
    }

    console.log(`  ✓ ${result.rows.length} cards`);
  }

  await prisma.$disconnect();
  console.log("\nDone.");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
