/**
 * Cached Prisma query wrappers via Next.js `unstable_cache`.
 *
 * Each export below is a Prisma read that's cached at the data-
 * fetch layer with a 1-hour TTL. Pages stay `force-dynamic` (so
 * builds don't try to pre-render against an unreachable DB), but
 * the data the page renders is read from the in-memory / file
 * cache instead of Postgres on every request.
 *
 * Result: same UX, ~99% fewer DB roundtrips for the pages that
 * call these. Directly addresses the Neon data-transfer quota
 * blow-up that took prod down on 2026-05-16.
 *
 * Mutation routes can call `revalidateTag(...)` to bust a specific
 * slice when they want immediate freshness — see
 * src/app/api/products/[id]/checklist/route.ts and friends.
 */

import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";

const ONE_HOUR = 3600;

/**
 * unstable_cache serializes its return value through Next.js's data
 * cache, which converts Date → ISO string. Calling `.getTime()` on
 * the deserialized result blows up because it's a string now, not a
 * Date. This walker converts ISO-shaped strings back into Date
 * objects so consumers see the same shape they'd see from Prisma
 * directly. Skip Date instances (no-op) and primitives.
 *
 * The regex matches the ISO 8601 form Prisma + JSON.stringify
 * produce: "2026-05-15T00:00:00.000Z" or "2026-05-15T00:00:00".
 */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function reviveDates<T>(value: T): T {
  if (value == null) return value;
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    return (ISO_DATE_RE.test(value) ? new Date(value) : value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => reviveDates(v)) as unknown as T;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as object)) {
      out[k] = reviveDates(v);
    }
    return out as T;
  }
  return value;
}

/**
 * Homepage / favorites / calendar all read the same product list
 * (full catalog, light shape). One cache key serves all three; tag
 * `products` so mutations can bust it.
 */
const _getAllProductsLightRaw = unstable_cache(
  async () => {
    return prisma.product.findMany({
      orderBy: [{ releaseDate: "desc" }, { createdAt: "desc" }],
      include: { _count: { select: { cards: true } } },
    });
  },
  ["all-products-light"],
  { revalidate: ONE_HOUR, tags: ["products"] },
);
export async function getAllProductsLight() {
  return reviveDates(await _getAllProductsLightRaw());
}

/**
 * Product detail page — the big one. Product + all cards + team
 * prices + formats. Card list can be 1,200+ rows per product, so
 * this is the single biggest read in the app.
 *
 * Cache key includes the product id so each product gets its own
 * cache slot. Tagged with both `product-<id>` (for targeted bust)
 * and `products` (for global bust).
 */
export async function getProductFullById(id: string) {
  const cached = await unstable_cache(
    async () => {
      return prisma.product.findUnique({
        where: { id },
        include: {
          teamPrices: { orderBy: { team: "asc" } },
          cards: {
            select: {
              id: true,
              cardNumber: true,
              team: true,
              playerName: true,
              variation: true,
              marketValueCents: true,
              ungradedCents: true,
              psa10Cents: true,
              psa9Cents: true,
              printRun: true,
              imageUrl: true,
              popG10: true,
              popTotal: true,
            },
          },
          formats: {
            orderBy: [{ position: "asc" }, { createdAt: "asc" }],
          },
          _count: { select: { cards: true } },
        },
      });
    },
    ["product-full", id],
    { revalidate: ONE_HOUR, tags: ["products", `product-${id}`] },
  )();
  return reviveDates(cached);
}

/**
 * Cross-product player price query — used by the product page to
 * build the Card-Ladder-style Overall player index. Joins the
 * full Card table filtered by player names in the source product;
 * potentially 10k+ rows on big sports like MLB.
 *
 * Cache key derived from sport + sorted player-name fingerprint
 * so the same product re-renders consistently while distinct
 * product calls don't collide.
 */
export async function getCrossProductPricedCards(
  sport: string,
  players: string[],
) {
  const fingerprint = [...players].sort().join("|").slice(0, 256);
  const cached = await unstable_cache(
    async () => {
      return prisma.card.findMany({
        where: {
          playerName: { in: players },
          product: { sport },
          OR: [
            { psa10Cents: { gt: 0 } },
            { ungradedCents: { gt: 0 } },
          ],
        },
        select: {
          playerName: true,
          psa10Cents: true,
          ungradedCents: true,
        },
      });
    },
    ["cross-product-priced", sport, fingerprint],
    { revalidate: ONE_HOUR, tags: ["products", `cross-${sport}`] },
  )();
  return reviveDates(cached);
}

/**
 * Card price snapshots for a product — feeds the per-player Trend
 * column. Snapshot rows only grow daily so an hour of cache is
 * fine.
 */
export async function getCardSnapshotsForProduct(productId: string) {
  const cached = await unstable_cache(
    async () => {
      return prisma.cardPriceSnapshot.findMany({
        where: { card: { productId } },
        select: {
          cardId: true,
          capturedAt: true,
          psa10Cents: true,
          ungradedCents: true,
        },
        orderBy: { capturedAt: "asc" },
      });
    },
    ["card-snapshots", productId],
    { revalidate: ONE_HOUR, tags: ["snapshots", `product-${productId}`] },
  )();
  return reviveDates(cached);
}

/**
 * Trending snapshots for a sport — backs /hot and /chase. Snapshot
 * data only refreshes nightly via the refresh-trending cron, so an
 * hour of cache is safe.
 */
export async function getTrendingSnapshotsForSport(
  sportCandidates: string[],
) {
  const cached = await unstable_cache(
    async () => {
      return prisma.playerTrendingSnapshot.findMany({
        where: { sport: { in: sportCandidates } },
        orderBy: { last30dCents: "desc" },
        take: 200,
      });
    },
    ["trending-snapshots", sportCandidates.join("|")],
    { revalidate: ONE_HOUR, tags: ["trending"] },
  )();
  return reviveDates(cached);
}

/**
 * Light card list for a sport — used by /hot/[sport] to resolve a
 * player's primary team. Returns just team + playerName + variation
 * + cardNumber, no price fields.
 */
/**
 * Catalog-wide gem-rate roll-up — one row per product with summed
 * pop counts across all its cards. Powers /insights/gem-rates.
 *
 * Two queries because Prisma's groupBy returns aggregates only; we
 * need the product metadata (name, sport, manufacturer, releaseDate,
 * total card count) joined in. Cheaper than a raw SQL join and the
 * full result is small (one row per product, ~80 products today).
 *
 * Filtered to products with non-zero popTotal — unreleased products
 * and ones with no graded data yet contribute nothing meaningful to
 * a "gem rate" comparison.
 */
export async function getProductGemRates() {
  const cached = await unstable_cache(
    async () => {
      const aggs = await prisma.card.groupBy({
        by: ["productId"],
        _sum: { popG10: true, popTotal: true },
        _count: { _all: true },
        where: { popTotal: { gt: 0 } },
      });
      if (aggs.length === 0) return [];
      const productIds = aggs.map((a) => a.productId);
      const products = await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: {
          id: true,
          name: true,
          sport: true,
          manufacturer: true,
          releaseDate: true,
          _count: { select: { cards: true } },
        },
      });
      const byId = new Map(products.map((p) => [p.id, p]));
      return aggs.flatMap((a) => {
        const p = byId.get(a.productId);
        if (!p) return [];
        const popG10 = a._sum.popG10 ?? 0;
        const popTotal = a._sum.popTotal ?? 0;
        return [
          {
            productId: a.productId,
            name: p.name,
            sport: p.sport,
            manufacturer: p.manufacturer,
            releaseDate: p.releaseDate,
            cardsWithPop: a._count._all,
            totalCards: p._count.cards,
            popG10,
            popTotal,
          },
        ];
      });
    },
    ["product-gem-rates"],
    { revalidate: ONE_HOUR, tags: ["products", "gem-rates"] },
  )();
  return reviveDates(cached);
}

export async function getCardsLightForSport(sportCandidates: string[]) {
  // No Date fields on this projection so reviveDates is a no-op,
  // but use it anyway for consistency — cheap on a string-only
  // record array.
  const cached = await unstable_cache(
    async () => {
      return prisma.card.findMany({
        where: { product: { sport: { in: sportCandidates } } },
        select: {
          playerName: true,
          team: true,
          variation: true,
          cardNumber: true,
        },
      });
    },
    ["cards-light-by-sport", sportCandidates.join("|")],
    { revalidate: ONE_HOUR, tags: ["products"] },
  )();
  return reviveDates(cached);
}
