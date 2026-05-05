/**
 * Shared importer logic for PriceCharting set ingest. Used by:
 *   - scripts/import-pricecharting-set.ts (CLI for one-off backfills)
 *   - src/app/api/cron/refresh-pricecharting/route.ts (scheduled refresh)
 *
 * The CLI and the cron diverge only in their progress reporting. The
 * actual fetch + parse + upsert logic lives here so both paths stay in
 * lockstep.
 */
import type { PrismaClient } from "@prisma/client";
import {
  fetchConsoleProducts,
  fetchPopRows,
  parseProductName,
  type PCPopRow,
} from "./pricecharting-console";

export type SlugMeta = {
  slug: string;
  name: string;
  sport: string;
  manufacturer: string;
};

/**
 * The set of slugs the cron refreshes. Add a new entry here to start
 * tracking another set; the cron will pick it up on its next run and
 * upsert a Product row keyed by (source="api:pricecharting", slug).
 *
 * Keeping this in code (vs. a config table) for now because the list
 * is small and product-team-edited; revisit when we have >20 sets.
 */
export const TRACKED_SLUGS: SlugMeta[] = [
  {
    slug: "baseball-cards-2025-topps-chrome",
    name: "2025 Topps Chrome Baseball",
    sport: "MLB",
    manufacturer: "Topps",
  },
];

export type ImportProgress = (line: string) => void;

export type ImportResult = {
  slug: string;
  productId: string | null;
  consoleRows: number;
  popRows: number;
  created: number;
  updated: number;
  skipped: number;
  popFetchError: string | null;
};

/**
 * Run a single set's ingest end-to-end. Idempotent — re-running refreshes
 * prices + pop counts on existing cards (matched by pricechartingId) and
 * creates rows for any cards new to the set since last run.
 */
export async function importSet(
  prisma: PrismaClient,
  meta: SlugMeta,
  progress: ImportProgress = () => {},
): Promise<ImportResult> {
  const result: ImportResult = {
    slug: meta.slug,
    productId: null,
    consoleRows: 0,
    popRows: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    popFetchError: null,
  };

  progress(`[${meta.slug}] fetching pop report…`);
  let popRows: PCPopRow[] = [];
  try {
    popRows = await fetchPopRows(meta.slug);
    result.popRows = popRows.length;
    progress(`[${meta.slug}]   ${popRows.length} pop rows`);
  } catch (err) {
    result.popFetchError = err instanceof Error ? err.message : String(err);
    progress(
      `[${meta.slug}]   pop fetch failed (continuing without pop): ${result.popFetchError}`,
    );
  }
  const popByLabel = new Map<string, PCPopRow>();
  for (const r of popRows) popByLabel.set(r.cardLabel, r);

  progress(`[${meta.slug}] fetching console listing…`);
  const { products: consoleRows } = await fetchConsoleProducts(meta.slug);
  result.consoleRows = consoleRows.length;
  progress(`[${meta.slug}]   ${consoleRows.length} cards`);

  progress(`[${meta.slug}] writing to DB…`);
  const product = await prisma.product.upsert({
    where: {
      source_externalId: {
        source: "api:pricecharting",
        externalId: meta.slug,
      },
    },
    create: {
      name: meta.name,
      sport: meta.sport,
      manufacturer: meta.manufacturer,
      source: "api:pricecharting",
      externalId: meta.slug,
      releaseStatus: "released",
    },
    update: {},
  });
  result.productId = product.id;

  const now = new Date();
  for (const c of consoleRows) {
    const parsed = parseProductName(c.productName);
    if (!parsed.playerName || !parsed.cardNumber) {
      result.skipped++;
      continue;
    }
    const pop = popByLabel.get(c.productName);
    const existing = await prisma.card.findUnique({
      where: { pricechartingId: c.id },
      select: { id: true },
    });
    const data = {
      productId: product.id,
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
      // Don't clobber team — user may have set it via CSV upload.
      await prisma.card.update({ where: { id: existing.id }, data });
      result.updated++;
    } else {
      await prisma.card.create({ data: { ...data, team: "—" } });
      result.created++;
    }
    if ((result.created + result.updated) % 250 === 0) {
      progress(
        `[${meta.slug}]   …${result.created} created, ${result.updated} updated`,
      );
    }
  }

  progress(
    `[${meta.slug}] done. created=${result.created} updated=${result.updated} skipped=${result.skipped}`,
  );
  return result;
}
