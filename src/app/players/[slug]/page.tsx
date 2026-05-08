import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { nameFromSlug, playerSlug } from "@/lib/player-slug";
import { formatUsd } from "@/lib/money";
import { getPlayerSalesStats } from "@/lib/sources/pricing/cardhedger";
import PlayerSalesChart from "./PlayerSalesChart";

export const dynamic = "force-dynamic";

/**
 * Per-player profile page — Card Ladder-style market index for a
 * single player.
 *
 * Data sources (intentionally layered, not replaced):
 *   - **Our DB** (PriceCharting-populated): every card in every product
 *     where this player appears, with PSA 10 / raw cents we already
 *     trust. Drives the set-by-set table and Top Cards list.
 *   - **Card Hedger** (`sales-stats-by-player`): bucketed sales count +
 *     dollar volume per player over the last N days. Drives the volume
 *     chart at the top — answers "is this player's market hot right
 *     now?" with real volume data, not snapshot diffs.
 *
 * Future layers (queued, not yet wired):
 *   - CH `card-search?player=X` → top cards across CH's catalog
 *   - CH `prices-by-card` per top card → daily price chart
 *   - CH `comps` per top card → recent sales tape
 *
 * Slug → playerName resolution: scan all distinct Card.playerName
 * values, find the one whose slug matches. We don't store a Player
 * table yet — Card.playerName IS the player identifier in our model.
 */
export default async function PlayerPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // Find the canonical playerName by scanning distinct values. Cheap
  // because we GROUP BY at the SQL level. Caps at ~10k players, which
  // is fine for the foreseeable scale.
  const allPlayers = await prisma.card.findMany({
    distinct: ["playerName"],
    select: { playerName: true },
  });
  const matched = allPlayers.find(
    (p) => playerSlug(p.playerName) === slug,
  );
  const playerName = matched?.playerName ?? null;

  if (!playerName) {
    return <NoPlayerFound slug={slug} />;
  }

  // Pull every card belonging to this player, with their product
  // metadata. Server-side join keeps the rendering simple — the page
  // is force-dynamic anyway so we don't need to worry about cache.
  const cards = await prisma.card.findMany({
    where: { playerName },
    include: {
      product: {
        select: {
          id: true,
          name: true,
          sport: true,
          releaseDate: true,
        },
      },
    },
    orderBy: [{ psa10Cents: "desc" }, { ungradedCents: "desc" }],
  });

  if (cards.length === 0) {
    return <NoPlayerFound slug={slug} />;
  }

  // Most-frequent team across the player's cards. Picks up the right
  // value even when a player appears across products under different
  // team names (e.g. mid-season trade) by counting, not first-wins.
  const teamCounts = new Map<string, number>();
  for (const c of cards) {
    if (!c.team || c.team === "—") continue;
    teamCounts.set(c.team, (teamCounts.get(c.team) ?? 0) + 1);
  }
  const primaryTeam =
    [...teamCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const sport = cards[0].product.sport;

  // Card Hedger sales-stats — bucketed weekly volume. Wrapped in a
  // try/catch so an outage on CH doesn't blank the whole page; the
  // chart just doesn't render.
  let salesStats: Awaited<ReturnType<typeof getPlayerSalesStats>>[number] | null = null;
  if (process.env.CARD_HEDGER_API) {
    try {
      const stats = await getPlayerSalesStats({
        players: [playerName],
        interval: "week",
        periods: 12,
        includeCurrent: true,
      });
      salesStats = stats[0] ?? null;
    } catch (e) {
      console.warn(`[player ${slug}] CH sales-stats failed:`, e);
    }
  }

  // Group cards by product for the set-by-set breakdown. Sort sets by
  // the highest PSA 10 in the set so the most-valuable sets bubble up.
  const cardsByProduct = new Map<string, typeof cards>();
  for (const c of cards) {
    const arr = cardsByProduct.get(c.productId) ?? [];
    arr.push(c);
    cardsByProduct.set(c.productId, arr);
  }
  const productGroups = [...cardsByProduct.entries()]
    .map(([productId, ps]) => ({
      product: ps[0].product,
      cards: ps,
      topPsa10Cents: Math.max(0, ...ps.map((c) => c.psa10Cents ?? 0)),
      pricedCount: ps.filter(
        (c) => (c.psa10Cents ?? 0) > 0 || (c.ungradedCents ?? 0) > 0,
      ).length,
    }))
    .sort((a, b) => b.topPsa10Cents - a.topPsa10Cents);

  // Cross-product top cards by PSA 10 value. Filtered to non-zero so
  // we don't lead with a wall of $0s on day-of-release products.
  const topCards = cards
    .filter((c) => (c.psa10Cents ?? 0) > 0)
    .slice(0, 10);

  return (
    <div className="space-y-8">
      {/* Hero */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-8">
        <Link
          href="/"
          className="text-[11px] font-bold uppercase tracking-tight-2 text-slate-500 hover:text-ink"
        >
          ← All products
        </Link>
        <div className="mt-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-tight-2 text-accent">
          {[sport, primaryTeam].filter(Boolean).join(" · ") || "Player"}
        </div>
        <h1 className="mt-1 text-2xl font-extrabold leading-tight tracking-tight-3 sm:text-4xl">
          {playerName}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
          <span>
            {cards.length} {cards.length === 1 ? "card" : "cards"} across{" "}
            {productGroups.length}{" "}
            {productGroups.length === 1 ? "set" : "sets"}
          </span>
          {topCards.length > 0 && (
            <span>
              Top PSA 10: {formatUsd(topCards[0].psa10Cents ?? 0)}
            </span>
          )}
        </div>
      </div>

      {/* Sales volume — CH-powered, weekly buckets */}
      {salesStats && salesStats.buckets.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-baseline justify-between">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-tight-2 text-accent">
                Market Activity
              </div>
              <div className="text-base font-extrabold tracking-tight-3 sm:text-lg">
                Weekly sales volume
              </div>
            </div>
            <div className="text-[10px] text-slate-500 sm:text-[11px]">
              Source: Card Hedger · last 12 weeks
            </div>
          </div>
          <div className="mt-4">
            <PlayerSalesChart buckets={salesStats.buckets} />
          </div>
        </section>
      )}

      {/* Top cards across all sets */}
      {topCards.length > 0 && (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 bg-bone px-4 py-2.5">
            <div className="text-[11px] font-bold uppercase tracking-tight-2 text-accent">
              Top Cards
            </div>
            <div className="text-sm font-extrabold leading-tight tracking-tight-3 sm:text-base">
              By PSA 10 value, all sets
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead className="bg-ink text-white">
                <tr>
                  <th className="w-10 px-3 py-2 text-left text-[10px] font-bold uppercase tracking-tight-2">
                    #
                  </th>
                  <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-tight-2">
                    Card
                  </th>
                  <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-tight-2">
                    Set
                  </th>
                  <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-tight-2">
                    PSA 10
                  </th>
                  <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-tight-2">
                    Raw
                  </th>
                </tr>
              </thead>
              <tbody>
                {topCards.map((c, i) => (
                  <tr
                    key={c.id}
                    className="[&>td]:border-b [&>td]:border-slate-100 bg-white"
                  >
                    <td className="px-3 py-2 text-xs tabular-nums text-slate-400">
                      {i + 1}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        {c.imageUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={c.imageUrl}
                            alt=""
                            className="h-9 w-7 shrink-0 rounded border border-slate-200 object-cover"
                            loading="lazy"
                          />
                        )}
                        <div className="min-w-0">
                          <div className="font-semibold tracking-tight-2 text-slate-800">
                            #{c.cardNumber}
                          </div>
                          <div className="truncate text-[11px] text-slate-500">
                            {c.variation ?? "Base"}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-[11px] text-slate-600">
                      <Link
                        href={`/products/${c.product.id}`}
                        className="hover:text-accent"
                      >
                        {c.product.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {(c.psa10Cents ?? 0) > 0 ? (
                        <span className="font-extrabold text-ink">
                          {formatUsd(c.psa10Cents ?? 0)}
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                      {(c.ungradedCents ?? 0) > 0
                        ? formatUsd(c.ungradedCents ?? 0)
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Set-by-set breakdown */}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 bg-bone px-4 py-2.5">
          <div className="text-[11px] font-bold uppercase tracking-tight-2 text-accent">
            Sets
          </div>
          <div className="text-sm font-extrabold leading-tight tracking-tight-3 sm:text-base">
            Where this player appears
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead className="bg-ink text-white">
              <tr>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-tight-2">
                  Set
                </th>
                <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-tight-2">
                  Cards
                </th>
                <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-tight-2">
                  Priced
                </th>
                <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-tight-2">
                  Top PSA 10
                </th>
                <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-tight-2">
                  Released
                </th>
              </tr>
            </thead>
            <tbody>
              {productGroups.map((g) => (
                <tr
                  key={g.product.id}
                  className="[&>td]:border-b [&>td]:border-slate-100 bg-white hover:bg-bone/40"
                >
                  <td className="px-3 py-2">
                    <Link
                      href={`/products/${g.product.id}`}
                      className="font-semibold tracking-tight-2 text-slate-800 hover:text-accent"
                    >
                      {g.product.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                    {g.cards.length}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                    {g.pricedCount}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {g.topPsa10Cents > 0 ? (
                      <span className="font-bold text-ink">
                        {formatUsd(g.topPsa10Cents)}
                      </span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                    {g.product.releaseDate
                      ? g.product.releaseDate.toISOString().slice(0, 10)
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function NoPlayerFound({ slug }: { slug: string }) {
  // Soft 404 — keep the URL workable so users can fix typos. Surfaces
  // the slug-derived guess so they see what was attempted.
  return (
    <div className="rounded-2xl border-2 border-dashed border-slate-300 bg-white p-12 text-center">
      <div className="text-[11px] font-bold uppercase tracking-tight-2 text-accent">
        Not found
      </div>
      <div className="mt-2 text-2xl font-extrabold tracking-tight-3">
        No cards for &ldquo;{nameFromSlug(slug)}&rdquo;
      </div>
      <p className="mx-auto mt-3 max-w-md text-sm text-slate-500">
        We don&apos;t have any cards under this player name in our checklist.
        Try the chase view on a product page and click a player there to land
        on their profile.
      </p>
      <Link
        href="/"
        className="mt-6 inline-block rounded-md bg-ink px-5 py-2.5 text-sm font-bold uppercase tracking-tight-2 text-white hover:opacity-90"
      >
        Back to products
      </Link>
    </div>
  );
}

