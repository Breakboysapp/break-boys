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
 * Homepage / favorites / calendar all read the same product list
 * (full catalog, light shape). One cache key serves all three; tag
 * `products` so mutations can bust it.
 */
export const getAllProductsLight = unstable_cache(
  async () => {
    return prisma.product.findMany({
      orderBy: [{ releaseDate: "desc" }, { createdAt: "desc" }],
      include: { _count: { select: { cards: true } } },
    });
  },
  ["all-products-light"],
  { revalidate: ONE_HOUR, tags: ["products"] },
);

/**
 * Product detail page — the big one. Product + all cards + team
 * prices + formats. Card list can be 1,200+ rows per product, so
 * this is the single biggest read in the app.
 *
 * Cache key includes the product id so each product gets its own
 * cache slot. Tagged with both `product-<id>` (for targeted bust)
 * and `products` (for global bust).
 */
export const getProductFullById = (id: string) =>
  unstable_cache(
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
export const getCrossProductPricedCards = (
  sport: string,
  players: string[],
) => {
  const fingerprint = [...players].sort().join("|").slice(0, 256);
  return unstable_cache(
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
};

/**
 * Card price snapshots for a product — feeds the per-player Trend
 * column. Snapshot rows only grow daily so an hour of cache is
 * fine.
 */
export const getCardSnapshotsForProduct = (productId: string) =>
  unstable_cache(
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

/**
 * Trending snapshots for a sport — backs /hot and /chase. Snapshot
 * data only refreshes nightly via the refresh-trending cron, so an
 * hour of cache is safe.
 */
export const getTrendingSnapshotsForSport = (sportCandidates: string[]) =>
  unstable_cache(
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

/**
 * Light card list for a sport — used by /hot/[sport] to resolve a
 * player's primary team. Returns just team + playerName + variation
 * + cardNumber, no price fields.
 */
export const getCardsLightForSport = (sportCandidates: string[]) =>
  unstable_cache(
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
