/**
 * Import an entire set from PriceCharting / SportsCardsPro into the local DB.
 *
 *   npx tsx scripts/import-pricecharting-set.ts <slug>            # dry-run
 *   npx tsx scripts/import-pricecharting-set.ts <slug> --apply    # write
 *
 * Example:
 *   npx tsx scripts/import-pricecharting-set.ts baseball-cards-2025-topps-chrome --apply
 *
 * What it does:
 *   1. Fetches every page of /api/console/<slug> (JSON, ~150/page).
 *   2. Fetches /pop/set/<slug> once (HTML), parses the pop table,
 *      and joins to console rows by productName / cardLabel.
 *   3. Upserts a Product row keyed by (source="api:pricecharting", externalId=slug).
 *   4. Upserts each Card row keyed by pricechartingId.  Existing per-card
 *      data (team, marketValueCents, etc.) is preserved on update.
 *
 * Idempotent: re-running refreshes prices + pop counts without duplicating
 * cards, and won't touch fields the importer doesn't own (team labels you
 * may have set manually, eBay market values, etc.).
 *
 * Team data: NOT populated by this importer. PC's console-listing endpoint
 * doesn't expose team. New Card rows get team="—" and existing rows keep
 * whatever team they had. The Chase view (top players by value) doesn't
 * need team; the Team Scoreboard view will fall back to "Other" for
 * un-team-tagged cards. We can layer team enrichment later via the
 * existing CSV checklist upload, or a separate per-card /api/product call.
 */
import { PrismaClient } from "@prisma/client";
import {
  fetchConsoleProducts,
  fetchPopRows,
  parseProductName,
  type PCConsoleProduct,
  type PCPopRow,
} from "../src/lib/sources/pricing/pricecharting-console";

// PC slug → human-readable product name + sport. Add entries here when
// onboarding a new set; falls back to a sensible derivation otherwise.
const SLUG_OVERRIDES: Record<
  string,
  { name: string; sport: string; manufacturer: string }
> = {
  "baseball-cards-2025-topps-chrome": {
    name: "2025 Topps Chrome Baseball",
    sport: "MLB",
    manufacturer: "Topps",
  },
  "football-cards-2024-topps-chrome": {
    name: "2024 Topps Chrome Football",
    sport: "NFL",
    manufacturer: "Topps",
  },
  "football-cards-2025-topps-chrome": {
    name: "2025 Topps Chrome Football",
    sport: "NFL",
    manufacturer: "Topps",
  },
};

function deriveProductMeta(slug: string): {
  name: string;
  sport: string;
  manufacturer: string;
} {
  const o = SLUG_OVERRIDES[slug];
  if (o) return o;
  // Generic fallback — title-case the slug, guess sport from the prefix.
  const parts = slug.split("-");
  let sport = "Other";
  if (slug.startsWith("baseball-")) sport = "MLB";
  else if (slug.startsWith("football-")) sport = "NFL";
  else if (slug.startsWith("basketball-")) sport = "NBA";
  else if (slug.startsWith("hockey-")) sport = "NHL";
  const name = parts
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ")
    .replace(/^Baseball Cards /, "")
    .replace(/^Football Cards /, "")
    .replace(/^Basketball Cards /, "")
    .replace(/^Hockey Cards /, "");
  return { name, sport, manufacturer: "Topps" };
}

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("usage: tsx scripts/import-pricecharting-set.ts <slug> [--apply]");
    process.exit(1);
  }
  const apply = process.argv.includes("--apply");
  const prisma = new PrismaClient();

  console.log(`Slug: ${slug}`);
  console.log(`Mode: ${apply ? "APPLY" : "DRY RUN (--apply to write)"}`);
  console.log();

  // 1. Fetch pop HTML FIRST — Cloudflare on the SCP host is finicky
  //    and we want a clean session before burning rate-budget on the
  //    pricecharting.com paginated console fetch.
  console.log("[1/3] Fetching pop report…");
  let popRows: PCPopRow[] = [];
  try {
    popRows = await fetchPopRows(slug);
    console.log(`      ${popRows.length} pop rows.`);
  } catch (err) {
    console.warn(
      `      pop fetch failed (continuing without pop data): ${
        err instanceof Error ? err.message : err
      }`,
    );
  }

  // 2. Fetch console JSON (full set).
  console.log("[2/3] Fetching console listing…");
  const { products: consoleRows } = await fetchConsoleProducts(slug);
  console.log(`      ${consoleRows.length} cards.`);
  // Index by productName for the join.  Pop labels match console
  // productName verbatim — confirmed against 2025 Topps Chrome Baseball.
  const popByLabel = new Map<string, PCPopRow>();
  for (const r of popRows) popByLabel.set(r.cardLabel, r);

  // Sanity-print the top 5 cards with full data.
  console.log();
  console.log("Sample (top 5 by PSA 10 price):");
  const sorted = [...consoleRows].sort(
    (a, b) => (b.psa10Cents ?? 0) - (a.psa10Cents ?? 0),
  );
  for (const c of sorted.slice(0, 5)) {
    const pop = popByLabel.get(c.productName);
    const fmt = (cents: number | null) =>
      cents == null ? "—" : `$${(cents / 100).toFixed(2)}`;
    const gem =
      pop && pop.popTotal && pop.popG10 != null
        ? `${((pop.popG10 / pop.popTotal) * 100).toFixed(1)}%`
        : "—";
    console.log(
      `  ${c.productName.padEnd(48)} raw=${fmt(c.ungradedCents).padEnd(10)} 10=${fmt(c.psa10Cents).padEnd(10)} 9=${fmt(c.psa9Cents).padEnd(10)} pop10=${pop?.popG10 ?? "—"}  gem=${gem}`,
    );
  }

  // 3. Upsert Product + Cards.
  console.log();
  console.log("[3/3] Writing to DB…");
  const meta = deriveProductMeta(slug);

  let productId: string;
  if (apply) {
    const product = await prisma.product.upsert({
      where: {
        source_externalId: { source: "api:pricecharting", externalId: slug },
      },
      create: {
        name: meta.name,
        sport: meta.sport,
        manufacturer: meta.manufacturer,
        source: "api:pricecharting",
        externalId: slug,
        releaseStatus: "released",
      },
      update: {
        // Don't clobber name/sport on re-runs in case the user edited them.
      },
    });
    productId = product.id;
    console.log(`      Product upserted: ${product.name} (${product.id})`);
  } else {
    productId = "<dry-run>";
    console.log(
      `      Would upsert Product: ${meta.name} (${meta.sport}, ${meta.manufacturer})`,
    );
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const now = new Date();

  for (const c of consoleRows) {
    const parsed = parseProductName(c.productName);
    if (!parsed.playerName || !parsed.cardNumber) {
      skipped++;
      continue;
    }
    const pop = popByLabel.get(c.productName);

    if (!apply) {
      created++; // dry-run conservatism: pretend everything is new.
      continue;
    }

    // Upsert keyed by pricechartingId so re-runs are stable.
    const existing = await prisma.card.findUnique({
      where: { pricechartingId: c.id },
      select: { id: true },
    });
    const data = {
      productId,
      team: existing ? undefined : "—",
      playerName: parsed.playerName,
      cardNumber: parsed.cardNumber,
      variation: parsed.variation,
      pricechartingId: c.id,
      ungradedCents: c.ungradedCents,
      psa10Cents: c.psa10Cents,
      psa9Cents: c.psa9Cents,
      printRun: c.printRun || null,
      imageUrl: c.imageUri || null,
      pricesUpdatedAt: now,
      popG6: pop?.popG6 ?? null,
      popG7: pop?.popG7 ?? null,
      popG8: pop?.popG8 ?? null,
      popG9: pop?.popG9 ?? null,
      popG10: pop?.popG10 ?? null,
      popTotal: pop?.popTotal ?? null,
      popUpdatedAt: pop ? now : null,
    };
    if (existing) {
      await prisma.card.update({
        where: { id: existing.id },
        data: { ...data, team: undefined }, // never overwrite a manually-set team
      });
      updated++;
    } else {
      await prisma.card.create({
        data: { ...data, team: "—" },
      });
      created++;
    }
  }

  console.log();
  console.log(`Done. created=${created} updated=${updated} skipped=${skipped}`);
  if (!apply) console.log("(dry-run — re-run with --apply to write)");

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
