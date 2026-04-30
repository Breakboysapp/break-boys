// Integration test: feeds a fixture RSS through the parser and runs the
// same upsert logic the API route uses, against the dev SQLite database.
// Run: npx tsx scripts/test-sync.ts
import { PrismaClient } from "@prisma/client";
import { parseFeed } from "../src/lib/sources/cardboardconnection";

const SAMPLE_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <item>
    <title><![CDATA[2025 Topps Finest Football Set Review and Checklist]]></title>
    <link>https://www.cardboardconnection.com/2025-topps-finest-football-set-review-and-checklist</link>
    <description><![CDATA[Released on April 26, 2026.]]></description>
  </item>
  <item>
    <title><![CDATA[2026 Topps Chrome Black Baseball Set Review and Checklist]]></title>
    <link>https://www.cardboardconnection.com/2026-topps-chrome-black-baseball-set-review-and-checklist</link>
    <description><![CDATA[Released on April 29, 2026.]]></description>
  </item>
  <item>
    <title><![CDATA[2026 Panini Donruss Racing NASCAR]]></title>
    <link>https://www.cardboardconnection.com/2026-panini-donruss-racing-nascar</link>
    <description><![CDATA[Drops on April 22, 2026.]]></description>
  </item>
</channel></rss>`;

const SOURCE_ID = "api:cardboardconnection";

async function main() {
  const prisma = new PrismaClient();
  // Clean previous test rows so the run is repeatable.
  await prisma.product.deleteMany({ where: { source: SOURCE_ID } });

  const items = parseFeed(SAMPLE_FEED);
  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const item of items) {
    if (!item.sport) {
      skipped++;
      continue;
    }
    const existing = await prisma.product.findUnique({
      where: { source_externalId: { source: SOURCE_ID, externalId: item.externalId } },
    });
    if (existing) {
      await prisma.product.update({
        where: { id: existing.id },
        data: {
          name: item.name,
          sport: item.sport,
          manufacturer: item.manufacturer ?? existing.manufacturer,
          releaseDate: item.releaseDate ?? existing.releaseDate,
        },
      });
      updated++;
    } else {
      await prisma.product.create({
        data: {
          name: item.name,
          sport: item.sport,
          manufacturer: item.manufacturer,
          releaseDate: item.releaseDate,
          source: SOURCE_ID,
          externalId: item.externalId,
        },
      });
      created++;
    }
  }
  console.log(`First pass: created=${created} updated=${updated} skipped=${skipped}`);

  // Second pass should update, not create (idempotency).
  let created2 = 0;
  let updated2 = 0;
  for (const item of items) {
    if (!item.sport) continue;
    const existing = await prisma.product.findUnique({
      where: { source_externalId: { source: SOURCE_ID, externalId: item.externalId } },
    });
    if (existing) {
      await prisma.product.update({
        where: { id: existing.id },
        data: { name: item.name, sport: item.sport },
      });
      updated2++;
    } else {
      created2++;
    }
  }
  console.log(`Second pass: created=${created2} updated=${updated2}`);

  const synced = await prisma.product.findMany({
    where: { source: SOURCE_ID },
    orderBy: { releaseDate: "asc" },
  });
  console.log(`\nSynced products in DB: ${synced.length}`);
  for (const p of synced) {
    console.log(
      `- ${p.name} | mfr=${p.manufacturer} sport=${p.sport} releaseDate=${p.releaseDate?.toISOString().slice(0, 10) ?? "null"}`,
    );
  }

  // Cleanup so dev DB stays clean.
  await prisma.product.deleteMany({ where: { source: SOURCE_ID } });
  await prisma.$disconnect();

  if (created !== 3 || updated !== 0) {
    console.error(`First pass expected created=3 updated=0`);
    process.exit(1);
  }
  if (created2 !== 0 || updated2 !== 3) {
    console.error(`Second pass expected created=0 updated=3 (idempotency check)`);
    process.exit(1);
  }
  console.log("\nSync pipeline verified.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
