/**
 * Shared importer logic for PriceCharting set ingest. Used by:
 *   - scripts/import-pricecharting-set.ts (CLI for one-off backfills)
 *   - src/app/api/cron/refresh-pricecharting/route.ts (scheduled refresh)
 *
 * The CLI and the cron diverge only in their progress reporting. The
 * actual fetch + parse + upsert logic lives here so both paths stay in
 * lockstep.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
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
  /**
   * Variation-name regex. Any card whose `variation` matches is dropped
   * from this set's import — used to surgically exclude cards that PC
   * lists under one slug but actually belong to a separate product.
   * Example: 2025 Topps Chrome's listing page includes "[Sapphire]"
   * variants that are really part of Topps Chrome Sapphire Selections
   * (a separately-purchased product), so the regular Chrome slug uses
   * `excludeVariation: /sapphire/i` and we list Sapphire Selections as
   * its own tracked slug. Same pattern applies in NFL and NBA.
   */
  excludeVariation?: RegExp;
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
    // PC lumps Sapphire variants under the regular Chrome listing —
    // strip them; they're tracked separately under the Selections slug.
    excludeVariation: /sapphire/i,
  },
  {
    slug: "baseball-cards-2025-topps-chrome-sapphire-selections",
    name: "2025 Topps Chrome Sapphire Selections Baseball",
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
 *
 * @param opts.skipPop - When true, skips the pop-report fetch entirely.
 *   The pop endpoint is on a Cloudflare-protected SCP host that hangs
 *   from Vercel's serverless runtime even with curl (something about
 *   the Lambda egress IP / TLS fingerprint). Setting skipPop=true on
 *   the cron route keeps refreshes fast and unblocked; pop counts are
 *   backfilled later via the local CLI script which doesn't hit the
 *   same network restriction.
 */
export async function importSet(
  prisma: PrismaClient,
  meta: SlugMeta,
  progress: ImportProgress = () => {},
  opts: { skipPop?: boolean } = {},
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

  let popRows: PCPopRow[] = [];
  if (opts.skipPop) {
    progress(`[${meta.slug}] skipping pop fetch (skipPop=true)`);
  } else {
    progress(`[${meta.slug}] fetching pop report…`);
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
  }
  const popByLabel = new Map<string, PCPopRow>();
  for (const r of popRows) popByLabel.set(r.cardLabel, r);

  progress(`[${meta.slug}] fetching console listing…`);
  const { products: rawRows } = await fetchConsoleProducts(meta.slug);
  // Apply the per-slug variation filter: drops cards that PC lists under
  // this slug but actually belong to a different (separately-tracked)
  // product — Sapphire variants on the regular Chrome page being the
  // canonical case. Cards with a matching variation are filtered out
  // before write, so a re-import naturally cleans up any rows from a
  // previous unfiltered run via the deletion pass below.
  const consoleRows = meta.excludeVariation
    ? rawRows.filter((r) => {
        const v = parseProductName(r.productName).variation ?? "";
        return !meta.excludeVariation!.test(v);
      })
    : rawRows;
  result.consoleRows = consoleRows.length;
  if (meta.excludeVariation) {
    progress(
      `[${meta.slug}]   ${consoleRows.length} cards (filtered ${rawRows.length - consoleRows.length} matching ${meta.excludeVariation})`,
    );
  } else {
    progress(`[${meta.slug}]   ${consoleRows.length} cards`);
  }

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

  // BULK strategy: 7,500-card sets blow past Vercel's 300s function cap
  // when each card runs its own findUnique → update/create roundtrip.
  // Restructured into:
  //   1. One query to fetch every existing pricechartingId on this product
  //   2. Classify console rows into "create new" vs "update existing"
  //   3. createMany() the new ones in chunks (single query each)
  //   4. update() the existing ones in chunked $transaction batches
  // This drops total DB roundtrips from O(7500) to O(~150) and brings a
  // full-set refresh well inside the 300s envelope.

  const existingRows = await prisma.card.findMany({
    where: { productId: product.id, pricechartingId: { not: null } },
    select: { id: true, pricechartingId: true },
  });
  const existingByPCId = new Map<string, string>();
  for (const r of existingRows) {
    if (r.pricechartingId) existingByPCId.set(r.pricechartingId, r.id);
  }

  // Shared shape for both new-row inserts (createMany) and existing-row
  // updates. createMany requires the unchecked variant (foreign keys as
  // raw IDs, not nested connect objects), which matches what we're
  // building anyway.
  type CardCreate = Prisma.CardCreateManyInput;
  type CardUpdate = Prisma.CardUncheckedUpdateInput;
  const toCreate: CardCreate[] = [];
  const toUpdate: Array<{ id: string; data: CardUpdate }> = [];

  for (const c of consoleRows) {
    const parsed = parseProductName(c.productName);
    if (!parsed.playerName || !parsed.cardNumber) {
      result.skipped++;
      continue;
    }
    const pop = popByLabel.get(c.productName);
    // Only include pop fields when we have fresh pop data for this card.
    // When skipPop=true (cron path) we DON'T want to clobber existing pop
    // counts written by a prior local-CLI run with nulls.
    const popFields = pop
      ? {
          popG6: pop.popG6 ?? null,
          popG7: pop.popG7 ?? null,
          popG8: pop.popG8 ?? null,
          popG9: pop.popG9 ?? null,
          popG10: pop.popG10 ?? null,
          popTotal: pop.popTotal ?? null,
          popUpdatedAt: now,
        }
      : {};
    const sharedFields = {
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
      ...popFields,
    };
    const existingId = existingByPCId.get(c.id);
    if (existingId) {
      // Update path. Don't write team — never clobber an existing
      // manually-set team value. Don't write productId either; an
      // existing row already has the right one.
      toUpdate.push({ id: existingId, data: sharedFields });
    } else {
      // Insert path. team="—" placeholder fills the required column;
      // CSV checklist uploads or future per-card /api/product calls
      // populate real teams.
      toCreate.push({ ...sharedFields, productId: product.id, team: "—" });
    }
  }

  // Bulk insert in 500-row chunks (Postgres max parameter count safety).
  for (let i = 0; i < toCreate.length; i += 500) {
    const chunk = toCreate.slice(i, i + 500);
    await prisma.card.createMany({ data: chunk, skipDuplicates: true });
    result.created += chunk.length;
    progress(`[${meta.slug}]   created ${result.created}/${toCreate.length}`);
  }

  // Bulk update in 100-row chunks. Updates can't be expressed as one
  // bulk SQL like createMany (each row has different values), so we
  // batch as $transaction([update, update, …]) which still cuts
  // roundtrip overhead vs. awaiting one at a time.
  for (let i = 0; i < toUpdate.length; i += 100) {
    const chunk = toUpdate.slice(i, i + 100);
    await prisma.$transaction(
      chunk.map((u) =>
        prisma.card.update({ where: { id: u.id }, data: u.data }),
      ),
    );
    result.updated += chunk.length;
    if (result.updated % 500 === 0 || i + 100 >= toUpdate.length) {
      progress(
        `[${meta.slug}]   updated ${result.updated}/${toUpdate.length}`,
      );
    }
  }

  // Cleanup pass: remove any existing cards on this product whose
  // variation matches excludeVariation. Catches rows from earlier
  // unfiltered import runs (e.g. before the Sapphire split landed) so a
  // re-import surgically drops the now-misclassified data without
  // requiring a manual cleanup query.
  if (meta.excludeVariation && product.id) {
    const stale = await prisma.card.findMany({
      where: { productId: product.id },
      select: { id: true, variation: true },
    });
    const toDelete = stale
      .filter((c) => meta.excludeVariation!.test(c.variation ?? ""))
      .map((c) => c.id);
    if (toDelete.length > 0) {
      await prisma.card.deleteMany({ where: { id: { in: toDelete } } });
      progress(
        `[${meta.slug}]   cleaned up ${toDelete.length} pre-filter rows`,
      );
    }
  }

  progress(
    `[${meta.slug}] done. created=${result.created} updated=${result.updated} skipped=${result.skipped}`,
  );
  return result;
}
