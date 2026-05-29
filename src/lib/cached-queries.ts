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
 * slice when they want immediate freshness — e.g. the prospects
 * refresh, the pricing cron, and the favorites endpoint.
 */

import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import {
  productionBreakdown,
  type ProductionBreakdown,
} from "@/lib/sleepers/refresh-stats";

const ONE_HOUR = 3600;

// Per-group production helpers. Each returns the full breakdown
// (score + per-component contributions) so the UI can render the
// "OPS +30 · K% -18 · Age +5 = 67"-style tooltip on the Production
// cell. Two-way callers run both and keep the higher score.
function computeHitterBreakdown(args: {
  level: string;
  age: number | null;
  plateAppearances: number | null;
  ops: number | null;
  strikeOuts: number | null;
  baseOnBalls: number | null;
}): ProductionBreakdown | null {
  return productionBreakdown({ group: "hitting", ...args });
}
function computePitcherBreakdown(args: {
  level: string;
  age: number | null;
  inningsPitched: number | null;
  era: number | null;
  strikeOuts: number | null;
  baseOnBalls: number | null;
}): ProductionBreakdown | null {
  return productionBreakdown({ group: "pitching", ...args });
}

function formatOps(ops: number | null): string {
  if (ops == null) return "—";
  // .261 style — leading dot, three-decimal precision.
  const s = ops.toFixed(3);
  return s.startsWith("0") ? s.slice(1) : s;
}
function formatEra(era: number | null): string {
  if (era == null) return "—";
  return era.toFixed(2);
}

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
 * Sleeper Index — the headline query for /prospects.
 *
 * Joins the published ProspectRanking universe against each player's
 * card market (every priced card across every product in the same
 * sport). Computes quality + market + sleeper score in app code so
 * the formula stays readable and easy to tune. Returns one row per
 * ranked prospect, sorted by sleeper score desc.
 *
 *   Quality = 101 − rank             (rank 1 → 100, rank 100 → 1)
 *   Market  = normalize(
 *               log(top_psa10 + 1) * 0.6 + log(median_priced + 1) * 0.4
 *             )                        (0-100, top prospect = 100)
 *   Sleeper = Quality / Market         (higher = more undervalued)
 *
 * "Effective" price per card = max(psa10, raw × 6) — matches the
 * existing chase-rollup math so a card with a known raw comp but no
 * graded comp still contributes to the player's market signal.
 *
 * Cached 1h, tagged 'prospects' + 'products' (since the market half
 * of the score reads from card prices, mutations on either side
 * should bust this cache).
 */
const _getProspectSleeperIndexRaw = unstable_cache(
  async (sport: string) => {
    const rankings = await prisma.prospectRanking.findMany({
      where: { sport },
      orderBy: { rank: "asc" },
    });
    if (rankings.length === 0) return [];

    // Single read of every priced card in the sport, scoped to the
    // players on the ranking list. Avoids fetching the whole Card
    // table on big sports.
    const normalizedNames = rankings.map((r) => r.normalizedName);
    const pricedCards = await prisma.card.findMany({
      where: {
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

    // Bucket cards by normalized player name. normalizeKey() is the
    // same canonicalizer the importer uses on writes, so the DB and
    // the ranking list join cleanly even when one source spells the
    // player "Junior Caminero" and the other "Junior Caminero".
    // Note: normalizeKey is duplicated here vs. importing the helper
    // because cached-queries.ts is intentionally framework-free —
    // the helper file also has a heavier DB-dependent build function
    // we don't need.
    const norm = (s: string) =>
      s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const RAW_TO_GRADED = 6;
    const eff = (psa: number | null, raw: number | null) =>
      Math.max(psa ?? 0, (raw ?? 0) * RAW_TO_GRADED);
    const median = (a: number[]) => {
      if (a.length === 0) return 0;
      const s = [...a].sort((x, y) => x - y);
      const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    };
    const byPlayer = new Map<string, number[]>();
    for (const c of pricedCards) {
      const v = eff(c.psa10Cents, c.ungradedCents);
      if (v <= 0) continue;
      const k = norm(c.playerName);
      const arr = byPlayer.get(k) ?? [];
      arr.push(v);
      byPlayer.set(k, arr);
    }

    // Per-player market blend before normalization. Direct port of the
    // chase-rollup formula — log compression so a $50k chase card
    // doesn't fully dominate over depth + median signal.
    const rawBlend = new Map<string, number>();
    for (const [k, prices] of byPlayer) {
      const top = Math.max(...prices);
      const med = median(prices);
      rawBlend.set(k, Math.log(top + 1) * 0.6 + Math.log(med + 1) * 0.4);
    }
    const maxBlend = Math.max(0, ...rawBlend.values());

    // Final per-prospect row. Quality from rank, market normalized
    // 0-100, sleeper score from the ratio. Cards-without-market get
    // market = null (rendered as "—" + sleeper = null on the UI side)
    // rather than market = 0 — dividing by zero would push every no-
    // market prospect to Infinity and crowd out the actual sleepers.
    const rows = rankings.map((r) => {
      const blend = rawBlend.get(r.normalizedName) ?? 0;
      const market =
        maxBlend > 0 && blend > 0
          ? Math.max(1, Math.round((blend / maxBlend) * 100))
          : null;
      const quality = Math.max(1, 101 - r.rank);
      const sleeper =
        market != null && market > 0 ? quality / market : null;
      // movement: positive = climbed (lower rank #), negative = fell.
      // null = no prior snapshot (first appearance on the list).
      const movement =
        r.previousRank != null ? r.previousRank - r.rank : null;
      return {
        rank: r.rank,
        previousRank: r.previousRank,
        movement,
        playerName: r.playerName,
        normalizedName: r.normalizedName,
        position: r.position,
        org: r.org,
        level: r.level,
        age: r.age,
        source: r.source,
        capturedAt: r.capturedAt,
        quality,
        market,
        sleeper,
        pricedCardCount: byPlayer.get(r.normalizedName)?.length ?? 0,
      };
    });

    // Sort by sleeper score desc, treating null sleeper (no card market)
    // as last so the "actual sleeper" view leads with quality+market
    // matches. Tie-break by rank.
    rows.sort((a, b) => {
      const av = a.sleeper ?? -Infinity;
      const bv = b.sleeper ?? -Infinity;
      if (av !== bv) return bv - av;
      return a.rank - b.rank;
    });
    return rows;
  },
  ["prospect-sleeper-index"],
  { revalidate: ONE_HOUR, tags: ["prospects", "products"] },
);
export async function getProspectSleeperIndex(sport: string = "MLB") {
  return reviveDates(await _getProspectSleeperIndexRaw(sport));
}

/**
 * Per-product sleeper board — joins one product's checklist with the
 * MLB roster cache and the existing card-market math, returning one
 * row per distinct player in the product.
 *
 * Powers /products/[id]/sleepers. The headline use case is a Bowman
 * 2026 buyer in a Pick-Your-Player break: every prospect in the
 * checklist with their current MiLB level/org/age and their card
 * market — so they can spot the AA hitter whose Bowman auto hasn't
 * priced him in yet.
 *
 * Stats-driven Production Index ships in phase 2; for now `production`
 * is null and the table just surfaces market + level. The shape is
 * already wired so phase 2 is purely a backfill.
 *
 * Cached 30m, tagged 'products' + 'milb-roster' — bust on either
 * checklist mutations or a roster refresh.
 */
const _getProductSleeperBoardRaw = unstable_cache(
  async (productId: string) => {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, name: true, sport: true },
    });
    if (!product) return null;

    // Distinct players in this product's checklist. Pull the raw rows
    // so we can bucket priced cards by normalized name below.
    const cards = await prisma.card.findMany({
      where: { productId },
      select: {
        playerName: true,
        psa10Cents: true,
        ungradedCents: true,
      },
    });
    if (cards.length === 0) return { product, rows: [], unmatched: 0 };

    const norm = (s: string) =>
      s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

    // Per-player market blend — mirrors getProspectSleeperIndex so a
    // player's market read is consistent across surfaces. Eff price
    // = max(psa10, raw × 6) to bring raw comps into the same scale.
    const RAW_TO_GRADED = 6;
    const eff = (psa: number | null, raw: number | null) =>
      Math.max(psa ?? 0, (raw ?? 0) * RAW_TO_GRADED);
    const median = (a: number[]) => {
      if (a.length === 0) return 0;
      const s = [...a].sort((x, y) => x - y);
      const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    };

    type PlayerAgg = {
      playerName: string;
      normalizedName: string;
      cardCount: number;
      prices: number[];
    };
    const byPlayer = new Map<string, PlayerAgg>();
    for (const c of cards) {
      const key = norm(c.playerName);
      const agg = byPlayer.get(key) ?? {
        playerName: c.playerName,
        normalizedName: key,
        cardCount: 0,
        prices: [],
      };
      agg.cardCount += 1;
      const v = eff(c.psa10Cents, c.ungradedCents);
      if (v > 0) agg.prices.push(v);
      byPlayer.set(key, agg);
    }

    // Roster lookup keyed by normalized name. Roster is small (~8k
    // rows) and read-once per request — no need for batched WHERE IN.
    const rosterRows = await prisma.milbRoster.findMany({
      select: {
        normalizedName: true,
        level: true,
        teamName: true,
        position: true,
        age: true,
        mlbPlayerId: true,
      },
    });
    const rosterByName = new Map(
      rosterRows.map((r) => [r.normalizedName, r]),
    );

    // Stat lines for every player on the roster. One read keyed on
    // mlbPlayerId — we'll bucket by (id, group) below so two-way
    // players surface both.
    const playerIds = rosterRows.map((r) => r.mlbPlayerId);
    const statLines =
      playerIds.length > 0
        ? await prisma.milbStatLine.findMany({
            where: { mlbPlayerId: { in: playerIds } },
            select: {
              mlbPlayerId: true,
              group: true,
              level: true,
              age: true,
              gamesPlayed: true,
              plateAppearances: true,
              ops: true,
              avg: true,
              homeRuns: true,
              inningsPitched: true,
              era: true,
              strikeOuts: true,
              baseOnBalls: true,
            },
          })
        : [];
    type StatLine = (typeof statLines)[number];
    const statsByPlayerId = new Map<number, { hitting?: StatLine; pitching?: StatLine }>();
    for (const s of statLines) {
      const existing = statsByPlayerId.get(s.mlbPlayerId) ?? {};
      if (s.group === "hitting") existing.hitting = s;
      else if (s.group === "pitching") existing.pitching = s;
      statsByPlayerId.set(s.mlbPlayerId, existing);
    }

    // Pipeline rank lookup — same shape, lets us surface "ranked vs
    // unranked" on the page so the user can filter out the
    // already-obvious chases (Holliday, Made, etc.).
    const rankings = await prisma.prospectRanking.findMany({
      where: { sport: product.sport, source: "mlb-pipeline" },
      select: { normalizedName: true, rank: true },
    });
    const rankByName = new Map(rankings.map((r) => [r.normalizedName, r.rank]));

    // Normalize market across this product so the values are
    // comparable within the break. Top guy in the product = 100.
    const rawBlend = new Map<string, number>();
    for (const [k, agg] of byPlayer) {
      if (agg.prices.length === 0) continue;
      const top = Math.max(...agg.prices);
      const med = median(agg.prices);
      rawBlend.set(k, Math.log(top + 1) * 0.6 + Math.log(med + 1) * 0.4);
    }
    const maxBlend = Math.max(0, ...rawBlend.values());

    const rows = [...byPlayer.values()].map((agg) => {
      const roster = rosterByName.get(agg.normalizedName);
      const rank = rankByName.get(agg.normalizedName) ?? null;
      const topPrice = agg.prices.length > 0 ? Math.max(...agg.prices) : null;
      const medPrice =
        agg.prices.length > 0 ? Math.round(median(agg.prices)) : null;
      const blend = rawBlend.get(agg.normalizedName) ?? 0;
      const market =
        maxBlend > 0 && blend > 0
          ? Math.max(1, Math.round((blend / maxBlend) * 100))
          : null;

      // Stat join + Production Index. Two-way players get both groups
      // and we surface whichever gives the higher signal — matches how
      // a buyer thinks about it ("what's he actually good at?").
      const stats = roster ? statsByPlayerId.get(roster.mlbPlayerId) : undefined;
      let production: number | null = null;
      let productionParts: ProductionBreakdown["parts"] | null = null;
      let statSummary: {
        group: "hitting" | "pitching";
        line: string;
        gamesPlayed: number;
      } | null = null;
      if (stats?.hitting && roster) {
        const h = stats.hitting;
        const breakdown = computeHitterBreakdown({
          level: roster.level,
          age: roster.age,
          plateAppearances: h.plateAppearances,
          ops: h.ops,
          strikeOuts: h.strikeOuts,
          baseOnBalls: h.baseOnBalls,
        });
        if (breakdown != null) {
          production = breakdown.score;
          productionParts = breakdown.parts;
          // Hitter stat line surfaces K% — the new signal v2 layered in.
          // ".810 OPS · 24% K · 8 HR" reads at a glance whether the
          // bat has plate discipline or is a feast/famine swinger.
          const kPct =
            h.plateAppearances && h.plateAppearances > 0
              ? `${Math.round(((h.strikeOuts ?? 0) / h.plateAppearances) * 100)}%`
              : "—";
          statSummary = {
            group: "hitting",
            line: `${formatOps(h.ops)} OPS · ${kPct} K · ${h.homeRuns ?? 0} HR`,
            gamesPlayed: h.gamesPlayed,
          };
        }
      }
      if (stats?.pitching && roster) {
        const p = stats.pitching;
        const breakdown = computePitcherBreakdown({
          level: roster.level,
          age: roster.age,
          inningsPitched: p.inningsPitched,
          era: p.era,
          strikeOuts: p.strikeOuts,
          baseOnBalls: p.baseOnBalls,
        });
        if (
          breakdown != null &&
          (production == null || breakdown.score > production)
        ) {
          production = breakdown.score;
          productionParts = breakdown.parts;
          // Pitcher stat line: ERA · K/9. K/9 is the readable
          // velocity-of-strikeouts number scouts use.
          const k9 =
            p.inningsPitched && p.inningsPitched > 0
              ? ((p.strikeOuts ?? 0) / p.inningsPitched) * 9
              : null;
          statSummary = {
            group: "pitching",
            line: `${formatEra(p.era)} ERA · ${k9 != null ? k9.toFixed(1) : "—"} K/9`,
            gamesPlayed: p.gamesPlayed,
          };
        }
      }

      // Sleeper Score = Production ÷ Market. High = playing well,
      // market hasn't priced him in. Falls back to null when either
      // signal is missing.
      const sleeper =
        production != null && market != null && market > 0
          ? Math.round((production / market) * 100) / 100
          : null;

      return {
        playerName: agg.playerName,
        normalizedName: agg.normalizedName,
        cardCount: agg.cardCount,
        topPriceCents: topPrice,
        medianPriceCents: medPrice,
        market,
        matched: roster != null,
        level: roster?.level ?? null,
        teamName: roster?.teamName ?? null,
        position: roster?.position ?? null,
        age: roster?.age ?? null,
        mlbPlayerId: roster?.mlbPlayerId ?? null,
        pipelineRank: rank,
        production,
        productionParts,
        sleeper,
        statLine: statSummary?.line ?? null,
        statGroup: statSummary?.group ?? null,
        gamesPlayed: statSummary?.gamesPlayed ?? null,
      };
    });

    // Sort by sleeper score desc by default — that's the headline
    // signal. Players without a sleeper number sort last by top price.
    rows.sort((a, b) => {
      const av = a.sleeper ?? -Infinity;
      const bv = b.sleeper ?? -Infinity;
      if (av !== bv) return bv - av;
      return (b.topPriceCents ?? 0) - (a.topPriceCents ?? 0);
    });

    const unmatched = rows.filter((r) => !r.matched).length;
    return { product, rows, unmatched };
  },
  // v2 cache key — a prior cache entry from Phase 1 (no roster/stats
  // joined) was being served past the refresh that should have busted
  // it, because revalidateTag is a no-op when called inside a render.
  // Bumping the key guarantees a clean rebuild on next read.
  // v3: production index reweighted (K%, BB%, stagnation, asymmetric
  // K/BB), and rows now carry productionParts for the tooltip. Bump
  // bypasses v2 cache so the new math takes effect on first visit.
  ["product-sleeper-board", "v3"],
  { revalidate: 30 * 60, tags: ["products", "milb-roster", "milb-stats"] },
);
export async function getProductSleeperBoard(productId: string) {
  const result = await _getProductSleeperBoardRaw(productId);
  return result ? reviveDates(result) : null;
}

/**
 * Light card list for a sport — used by /hot/[sport] to resolve a
 * player's primary team. Returns just team + playerName + variation
 * + cardNumber, no price fields.
 */
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
