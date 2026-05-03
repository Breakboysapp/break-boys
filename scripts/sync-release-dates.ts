/**
 * Run the cardboardconnection sync logic locally — for products in the
 * DB that have no release date but Cardboard Connection has an article
 * for, this script updates the release date in place.
 *
 * Mirrors what the patched /api/sync/[provider] route does (name + sport
 * fallback, externalId adoption), but local so it can use the production
 * DATABASE_URL and we get visibility into per-product matches.
 *
 *   npx tsx scripts/sync-release-dates.ts
 *
 * Read-only by default — pass --apply to actually write updates.
 */
import { PrismaClient } from "@prisma/client";
import { cardboardConnection } from "../src/lib/sources/cardboardconnection";

async function main() {
  const apply = process.argv.includes("--apply");
  const prisma = new PrismaClient();

  console.log(`Mode: ${apply ? "APPLY" : "DRY RUN (pass --apply to write)"}\n`);

  console.log("Fetching cardboardconnection feed…");
  const items = await cardboardConnection.fetch();
  console.log(`  ${items.length} items in feed\n`);

  // Pull all products with 0 cards (the Coming Soon set we want to audit)
  // along with everything they have today.
  const products = await prisma.product.findMany({
    where: { cards: { none: {} } },
    select: {
      id: true,
      name: true,
      sport: true,
      releaseDate: true,
      source: true,
      externalId: true,
    },
  });
  console.log(`Auditing ${products.length} 0-card products against feed:\n`);

  let matched = 0;
  let updates = 0;
  for (const p of products) {
    // Find a feed item that matches by exact name + sport. The feed's name
    // can have suffixes ("Set Review and Checklist") so also accept fuzzy
    // contains-match.
    const feedItem = items.find(
      (i) =>
        i.sport === p.sport &&
        (i.name === p.name ||
          i.name.toLowerCase().includes(p.name.toLowerCase()) ||
          p.name.toLowerCase().includes(i.name.toLowerCase())),
    );
    if (!feedItem) {
      console.log(`✗ ${p.name}`);
      continue;
    }
    matched++;
    const willChangeDate =
      feedItem.releaseDate &&
      (p.releaseDate == null ||
        p.releaseDate.toISOString().slice(0, 10) !==
          feedItem.releaseDate.toISOString().slice(0, 10));
    const tag = willChangeDate ? "🔄 UPDATE" : "✓ matches";
    const oldDate = p.releaseDate?.toISOString().slice(0, 10) ?? "—";
    const newDate = feedItem.releaseDate?.toISOString().slice(0, 10) ?? "—";
    console.log(
      `${tag} ${p.name}\n   ${oldDate} → ${newDate}   feed.name="${feedItem.name}"`,
    );

    if (apply && willChangeDate) {
      await prisma.product.update({
        where: { id: p.id },
        data: {
          releaseDate: feedItem.releaseDate,
          // Adopt the feed's externalId so future syncs hit the fast path
          source: cardboardConnection.id,
          externalId: feedItem.externalId,
        },
      });
      updates++;
    } else if (willChangeDate) {
      updates++;
    }
  }

  console.log(
    `\nSummary: ${matched}/${products.length} matched in feed; ${updates} would change${apply ? " (APPLIED)" : ""}.`,
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
