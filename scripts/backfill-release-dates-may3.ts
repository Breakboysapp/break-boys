/**
 * One-off backfill: set release dates on 10 undated 0-card products
 * based on web-research dates (2026-05-03 audit). After this runs,
 * the home page's "Coming Soon" tab logic — which now requires the
 * release date be null OR in the future — correctly shows only the
 * 3 products that are genuinely upcoming.
 *
 * Read-only by default. Pass --apply to write.
 *
 *   npx tsx scripts/backfill-release-dates-may3.ts          # dry run
 *   npx tsx scripts/backfill-release-dates-may3.ts --apply  # write
 */
import { PrismaClient } from "@prisma/client";

// Each entry: name (matches Product.name exactly) + the most reliable
// release date from web research. Source URLs are noted in the audit
// chat thread for re-verification.
const UPDATES: Array<{ name: string; sport: string; releaseDate: string }> = [
  // Released — backfill candidates once Beckett/Topps/Panini publish xlsx
  { name: "2024 Panini Contenders Football", sport: "NFL", releaseDate: "2025-06-11" },
  { name: "2025 Panini National Treasures Football", sport: "NFL", releaseDate: "2026-02-18" },
  { name: "2025 Panini One and One WNBA", sport: "NBA", releaseDate: "2026-03-13" },
  { name: "2025 Topps Definitive Baseball Set Checklist and", sport: "MLB", releaseDate: "2026-04-29" },
  { name: "2025-26 Panini National Treasures Road to FIFA World Cup 2026 Set", sport: "Soccer", releaseDate: "2026-04-30" },
  { name: "2025-26 Panini Signature Series Basketball", sport: "NBA", releaseDate: "2026-04-29" },
  { name: "2025-26 Upper Deck O-Pee-Chee Platinum Hockey", sport: "NHL", releaseDate: "2026-04-15" },
  { name: "2026 Upper Deck Rush of Ikorr TCG", sport: "TCG", releaseDate: "2026-04-30" },
  // Genuinely upcoming
  { name: "2025 Topps Finest Football", sport: "NFL", releaseDate: "2026-05-15" },
  { name: "2025-26 Panini Noir Basketball", sport: "NBA", releaseDate: "2026-06-10" },
];

async function main() {
  const apply = process.argv.includes("--apply");
  const prisma = new PrismaClient();

  console.log(`Mode: ${apply ? "APPLY" : "DRY RUN (pass --apply to write)"}\n`);

  let matched = 0;
  let updated = 0;
  for (const u of UPDATES) {
    const existing = await prisma.product.findFirst({
      where: { name: u.name, sport: u.sport },
      select: { id: true, name: true, releaseDate: true, _count: { select: { cards: true } } },
    });
    if (!existing) {
      console.log(`✗ NOT FOUND  ${u.name}`);
      continue;
    }
    matched++;
    if (existing._count.cards > 0) {
      console.log(`⚠ HAS CARDS  ${u.name} — skipping (not in Coming Soon)`);
      continue;
    }
    const oldDate = existing.releaseDate?.toISOString().slice(0, 10) ?? "—";
    if (oldDate === u.releaseDate) {
      console.log(`✓ already   ${u.name}`);
      continue;
    }
    console.log(`🔄 ${u.name}\n   ${oldDate} → ${u.releaseDate}`);
    if (apply) {
      await prisma.product.update({
        where: { id: existing.id },
        data: { releaseDate: new Date(u.releaseDate + "T00:00:00Z") },
      });
      updated++;
    } else {
      updated++;
    }
  }

  console.log(
    `\nMatched ${matched}/${UPDATES.length}; ${updated} would change${apply ? " (APPLIED)" : ""}.`,
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
