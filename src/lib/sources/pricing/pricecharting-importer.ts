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
  {
    slug: "baseball-cards-2025-bowman-draft",
    name: "2025 Bowman Draft Baseball",
    sport: "MLB",
    manufacturer: "Topps",
    // Retrofractor in Bowman Draft is the legends/HoF tribute parallel
    // (Lou Brock #BD-202, Sadaharu Oh #BD-201, etc.). Excluding them
    // from the prospect-focused product so legends don't crowd out the
    // 2025 draft class in the Chase view.
    excludeVariation: /retrofractor/i,
  },
  // Bowman Draft Chrome Prospect Autograph — separate SCP slug for
  // the CPA-XX auto cards. Same name+sport as the base set so the
  // adoption logic merges this slug's cards into the same Product
  // row, surfacing prospects' autographs (the real chase) on the
  // Bowman Draft Chase view.
  {
    slug: "baseball-cards-2025-bowman-draft-chrome-prospect-autograph",
    name: "2025 Bowman Draft Baseball",
    sport: "MLB",
    manufacturer: "Topps",
  },
  // Bowman Draft Mega Box Autograph (BMA-XX) — same merge pattern.
  {
    slug: "baseball-cards-2025-bowman-draft-chrome-prospect-mega-autograph",
    name: "2025 Bowman Draft Baseball",
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
  // Match strategy:
  //   1. Look for an existing Product with this exact slug as externalId
  //      (means we've imported it before — link back to that row).
  //   2. Otherwise look for a manually-created product with matching
  //      (name, sport). The user often pre-creates products via CSV
  //      checklist upload before the PC importer runs; rather than
  //      duplicating into a parallel api:pricecharting product (which
  //      then loses the manually-set teams), we adopt the existing row
  //      and tag it with our externalId so future runs match by step 1.
  //   3. Last resort, create a fresh product.
  let product = await prisma.product.findUnique({
    where: {
      source_externalId: {
        source: "api:pricecharting",
        externalId: meta.slug,
      },
    },
  });
  if (!product) {
    const candidate = await prisma.product.findFirst({
      where: { name: meta.name, sport: meta.sport },
    });
    if (candidate) {
      progress(
        `[${meta.slug}] adopting existing product ${candidate.id} (${candidate.name})`,
      );
      product = await prisma.product.update({
        where: { id: candidate.id },
        data: {
          // Tag with our externalId so step-1 catches it next run.
          // Keep source as-is — it's metadata about how the product
          // first entered the system, not who currently owns it.
          externalId: meta.slug,
          manufacturer: candidate.manufacturer ?? meta.manufacturer,
        },
      });
    }
  }
  if (!product) {
    product = await prisma.product.create({
      data: {
        name: meta.name,
        sport: meta.sport,
        manufacturer: meta.manufacturer,
        source: "api:pricecharting",
        externalId: meta.slug,
        releaseStatus: "released",
      },
    });
  }
  result.productId = product.id;

  const now = new Date();

  // BULK strategy + match-only mode for adopted products.
  //
  // The importer pre-fetches every card on this product and builds
  // three lookup maps: by PC id, by (cardNumber, variation), and by
  // (playerName, cardNumber). Each PC console row tries those keys in
  // order. The first hit wins.
  //
  // When the product already has manually-uploaded cards (cards with
  // no pricechartingId), we run in MATCH-ONLY mode: PC rows that don't
  // match any existing card get skipped, NOT created as new "—" team
  // rows. The manual checklist is the source of truth for what's
  // pullable; PC just provides prices for the cards that are already
  // there. This keeps adopted products visually identical to before
  // import — same 1,141 cards with their teams — just with prices and
  // pop counts layered on top.
  //
  // Fresh products with no manual data fall through to the normal
  // create-everything behavior so e.g. a brand new Sapphire Selections
  // import populates the full set.

  const existingCards = await prisma.card.findMany({
    where: { productId: product.id },
    select: {
      id: true,
      cardNumber: true,
      variation: true,
      playerName: true,
      pricechartingId: true,
      team: true,
      // Pulled in for snapshot-on-change comparison below — without
      // these we'd write a snapshot every run, bloating the table
      // even when nothing moved.
      ungradedCents: true,
      psa10Cents: true,
      psa9Cents: true,
    },
  });
  const norm = (s: string | null | undefined) =>
    (s ?? "")
      .toLowerCase()
      .replace(/[\[\](){}.,#:;'"]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const cardKey = (n: string, v: string | null) =>
    `${norm(n)}|${norm(v)}`;
  const playerCardKey = (p: string, n: string) =>
    `${norm(p)}|${norm(n)}`;

  const existingByPCId = new Map<string, string>();
  const existingByCardKey = new Map<string, string>();
  const existingByPlayerCard = new Map<string, string>();
  // Player → team inference. When a PC row has no exact card match,
  // we use this to attach the new card to the same team as the player's
  // other (manually-uploaded) cards. Solves the Ohtani sanity case:
  // PC has 30+ Ohtani parallels, manual upload only has 5; the missing
  // 25 land here under "Dodgers" instead of an orphan "—" bucket.
  // First-encountered team wins; cross-team players (traded mid-season)
  // are rare in a single set and not worth the complexity tonight.
  const playerToTeam = new Map<string, string>();
  // Card-id → previous prices, used to decide whether this run should
  // write a CardPriceSnapshot (only on change). Avoids storing duplicate
  // rows day-over-day for cards whose prices haven't moved.
  const previousPrices = new Map<
    string,
    {
      ungradedCents: number | null;
      psa10Cents: number | null;
      psa9Cents: number | null;
    }
  >();
  let manualCardCount = 0;
  for (const c of existingCards) {
    if (c.pricechartingId) {
      existingByPCId.set(c.pricechartingId, c.id);
    } else {
      manualCardCount++;
    }
    existingByCardKey.set(cardKey(c.cardNumber, c.variation), c.id);
    existingByPlayerCard.set(playerCardKey(c.playerName, c.cardNumber), c.id);
    if (c.team && c.team !== "—" && !playerToTeam.has(c.playerName)) {
      playerToTeam.set(c.playerName, c.team);
    }
    previousPrices.set(c.id, {
      ungradedCents: c.ungradedCents,
      psa10Cents: c.psa10Cents,
      psa9Cents: c.psa9Cents,
    });
  }
  const matchOnlyMode = manualCardCount > 0;
  if (matchOnlyMode) {
    progress(
      `[${meta.slug}] enrich mode (${manualCardCount} manual cards · ${playerToTeam.size} known players — PC parallels for known players land on inferred teams; unknown players skipped)`,
    );
  }

  // Shared shape for both new-row inserts (createMany) and existing-row
  // updates. createMany requires the unchecked variant (foreign keys as
  // raw IDs, not nested connect objects), which matches what we're
  // building anyway.
  type CardCreate = Prisma.CardCreateManyInput;
  type CardUpdate = Prisma.CardUncheckedUpdateInput;
  const toCreate: CardCreate[] = [];
  const toUpdate: Array<{ id: string; data: CardUpdate }> = [];
  // Snapshot rows queued during the matching loop, flushed in one
  // createMany() after updates land.
  const snapshotRows: Prisma.CardPriceSnapshotCreateManyInput[] = [];

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
    // Match priority: PC id (exact, from prior runs) → exact card key
    // (cardNumber + variation, normalized).
    //
    // We DELIBERATELY don't fall back to (playerName + cardNumber)
    // matching anymore. That fallback collapses every parallel of a
    // player's same-numbered card onto one manual slot — Ohtani's PC
    // base, Refractor, X-Fractor, Pink, Red Refractor, Superfractor
    // all hash to the same `ohtani|1` key, only the last one's data
    // sticks, and the rest of his parallels never get prices. Without
    // the fallback, anything that doesn't match by exact key falls
    // through to team-inferred enrichment below, which creates new
    // rows so each parallel gets its own price.
    const existingId =
      existingByPCId.get(c.id) ??
      existingByCardKey.get(cardKey(parsed.cardNumber, parsed.variation));

    if (existingId) {
      // Update path. Don't write team / playerName / cardNumber /
      // variation — those are the user's manual values and we just
      // layer prices on top.
      toUpdate.push({
        id: existingId,
        data: {
          pricechartingId: c.id,
          ungradedCents: c.ungradedCents,
          psa10Cents: c.psa10Cents,
          psa9Cents: c.psa9Cents,
          printRun: c.printRun || null,
          imageUrl: c.imageUri || null,
          pricesUpdatedAt: now,
          ...popFields,
        },
      });
      // Snapshot iff any of the three price fields changed since the
      // last run. Skips writing duplicate rows when nothing moved —
      // important for the trend computation: zero-delta rows would
      // dilute moving averages.
      const prev = previousPrices.get(existingId);
      const changed =
        !prev ||
        prev.ungradedCents !== c.ungradedCents ||
        prev.psa10Cents !== c.psa10Cents ||
        prev.psa9Cents !== c.psa9Cents;
      if (changed) {
        snapshotRows.push({
          cardId: existingId,
          capturedAt: now,
          ungradedCents: c.ungradedCents,
          psa10Cents: c.psa10Cents,
          psa9Cents: c.psa9Cents,
        });
      }
    } else if (matchOnlyMode) {
      // Manual checklist exists. PC has a card the user didn't upload
      // (typical: Refractor/X-Fractor/Pink parallels missing from the
      // user's Beckett xlsx). If we know what team this PLAYER is on
      // from their other manually-uploaded cards, fold the PC card in
      // under that inferred team — Ohtani's 30+ PC parallels join
      // Dodgers cleanly even though the manual checklist only has 5.
      // If the player is genuinely unknown (never appeared in manual),
      // skip — keeps "—" orphans out of the breakdown.
      const inferredTeam = playerToTeam.get(parsed.playerName);
      if (inferredTeam) {
        toCreate.push({
          ...sharedFields,
          productId: product.id,
          team: inferredTeam,
        });
      } else {
        result.skipped++;
      }
    } else {
      // Fresh product, create normally.
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

  // Baseline snapshots for newly-created cards. We don't have their
  // cardId until createMany commits, so re-fetch the just-created rows
  // by pricechartingId (which we set during the create) and seed one
  // snapshot apiece. Runs once per import; cost is one query.
  if (toCreate.length > 0) {
    const newPCIds = toCreate
      .map((c) => c.pricechartingId)
      .filter((x): x is string => Boolean(x));
    const inserted = await prisma.card.findMany({
      where: { pricechartingId: { in: newPCIds }, productId: product.id },
      select: {
        id: true,
        pricechartingId: true,
        ungradedCents: true,
        psa10Cents: true,
        psa9Cents: true,
      },
    });
    for (const c of inserted) {
      snapshotRows.push({
        cardId: c.id,
        capturedAt: now,
        ungradedCents: c.ungradedCents,
        psa10Cents: c.psa10Cents,
        psa9Cents: c.psa9Cents,
      });
    }
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

  // Flush snapshot rows. createMany in 500-row chunks for the same
  // Postgres-parameter-cap reason as Card creates. Runs after Card
  // creates so newly-inserted cards have valid IDs to reference.
  for (let i = 0; i < snapshotRows.length; i += 500) {
    const chunk = snapshotRows.slice(i, i + 500);
    await prisma.cardPriceSnapshot.createMany({ data: chunk });
  }
  if (snapshotRows.length > 0) {
    progress(`[${meta.slug}]   wrote ${snapshotRows.length} price snapshots`);
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
