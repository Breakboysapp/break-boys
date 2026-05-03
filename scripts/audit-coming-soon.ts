/**
 * Audit "Coming Soon" products — list every product with 0 cards in the DB.
 * The product page treats _count.cards === 0 as the Coming Soon state, so
 * any product here is one a user sees as "no checklist yet."
 *
 * Then for each, attempt to find the Beckett xlsx (the same source we use
 * for the seed scripts). If a checklist URL is now available where it
 * wasn't before, the product is backfill-able and we should run the seed.
 *
 *   npx tsx scripts/audit-coming-soon.ts
 */
import { PrismaClient } from "@prisma/client";

async function main() {
  const prisma = new PrismaClient();

  const empty = await prisma.product.findMany({
    where: { cards: { none: {} } },
    select: {
      id: true,
      name: true,
      sport: true,
      manufacturer: true,
      releaseDate: true,
      releaseStatus: true,
      source: true,
      externalId: true,
      createdAt: true,
    },
    orderBy: [
      { releaseDate: { sort: "asc", nulls: "last" } },
      { name: "asc" },
    ],
  });

  console.log(`\nProducts with 0 cards: ${empty.length}\n`);
  console.log(
    "Status".padEnd(11) +
      "Released".padEnd(12) +
      "Sport".padEnd(7) +
      "Mfr".padEnd(10) +
      "Name",
  );
  console.log("-".repeat(110));
  const now = new Date();
  for (const p of empty) {
    const released =
      p.releaseDate
        ? p.releaseDate.toISOString().slice(0, 10)
        : "—";
    const isPast =
      p.releaseDate != null && p.releaseDate < now;
    const tag = isPast
      ? "⚠ PAST"
      : p.releaseDate != null
      ? "future"
      : "undated";
    console.log(
      tag.padEnd(11) +
        released.padEnd(12) +
        p.sport.padEnd(7) +
        (p.manufacturer ?? "—").slice(0, 9).padEnd(10) +
        p.name,
    );
  }

  console.log(
    `\nLegend:`,
  );
  console.log(`  ⚠ PAST   — release date is in the past, but no cards loaded.`);
  console.log(`             These are likely backfill candidates: Beckett may`);
  console.log(`             now have published the xlsx that wasn't ready before.`);
  console.log(`  future   — release date is upcoming, expected to be empty.`);
  console.log(`  undated  — no release date set; might or might not be live.\n`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
