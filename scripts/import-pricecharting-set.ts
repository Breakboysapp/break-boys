/**
 * Local CLI for one-off PriceCharting set imports. Thin wrapper around
 * the shared importSet() helper used by the scheduled cron at
 * /api/cron/refresh-pricecharting — keeping both flows on the same
 * code path.
 *
 * Usage:
 *   # one-shot import / refresh of a specific set
 *   npx tsx scripts/import-pricecharting-set.ts <slug>
 *
 *   # use a different DB (override DATABASE_URL inline)
 *   DATABASE_URL="postgresql://..." npx tsx scripts/import-pricecharting-set.ts <slug>
 *
 * Slug must already be present in TRACKED_SLUGS in
 * src/lib/sources/pricing/pricecharting-importer.ts. Add it there first
 * so the cron picks it up too.
 *
 * Idempotent: re-running refreshes prices + pop counts on existing cards
 * (matched by pricechartingId) and creates rows for any cards new to the
 * set since last run. Never overwrites the team field on existing rows.
 */
import { PrismaClient } from "@prisma/client";
import {
  TRACKED_SLUGS,
  importSet,
} from "../src/lib/sources/pricing/pricecharting-importer";

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("usage: tsx scripts/import-pricecharting-set.ts <slug>");
    console.error("\nKnown slugs:");
    for (const s of TRACKED_SLUGS) console.error(`  ${s.slug} — ${s.name}`);
    process.exit(1);
  }
  const meta = TRACKED_SLUGS.find((s) => s.slug === slug);
  if (!meta) {
    console.error(
      `Slug "${slug}" not in TRACKED_SLUGS. Add it to src/lib/sources/pricing/pricecharting-importer.ts first so the cron picks it up too.`,
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();
  await importSet(prisma, meta, (line) => console.log(line));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
