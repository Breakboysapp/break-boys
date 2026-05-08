import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { sportsFromPath } from "@/lib/product-path";
import { computeTrendingMap } from "@/lib/cardhedger-trending";
import { remapInternationalAnime } from "@/lib/international-anime";
import { isRookieVariation } from "@/lib/scoring";
import { playerSlug } from "@/lib/player-slug";
import { formatUsd } from "@/lib/money";

export const dynamic = "force-dynamic";
// Cache the page render at the edge for 5 min, with SWR for 30 min.
// Trending data is sport-wide aggregate — same answer for everyone
// on a given visit window — so this hits CH at most ~12 times/hour
// per sport regardless of traffic.
export const revalidate = 300;

const SPORT_LABEL: Record<string, string> = {
  MLB: "Baseball",
  NBA: "Basketball",
  NFL: "Football",
  NHL: "Hockey",
};

export default async function HotSportPage({
  params,
}: {
  params: Promise<{ sport: string }>;
}) {
  const { sport: sportSeg } = await params;
  const sportCandidates = sportsFromPath(sportSeg);
  if (sportCandidates.length === 0) notFound();

  // Pull every distinct player across every product in the sport.
  // That's the universe we'll rank — Card Hedger gives us weekly
  // volume + spike multiples for each.
  const cards = await prisma.card.findMany({
    where: { product: { sport: { in: sportCandidates } } },
    select: {
      playerName: true,
      team: true,
      variation: true,
      cardNumber: true,
      psa10Cents: true,
      ungradedCents: true,
    },
  });
  if (cards.length === 0) notFound();

  // Apply the same anime remap we use on the product page so
  // Cal Raleigh / Aaron Judge / Ohtani aren't double-counted on
  // their national-team affiliations.
  const remapped = remapInternationalAnime(cards);

  // Narrow the universe before hitting CH. A full MLB sweep is
  // ~2,000+ distinct players; CH's 25-per-batch endpoint can't
  // finish that on a request render. Restrict to players who have
  // at least ONE priced card anywhere OR who appear in 3+ products
  // (the second filter catches active prospects whose cards haven't
  // been graded yet, like 2026 Bowman draftees). Keeps the sweep
  // bounded ~200-500 players per sport.
  const cardCountByPlayer = new Map<string, number>();
  const pricedSet = new Set<string>();
  const productSetByPlayer = new Map<string, Set<string>>();
  for (const c of cards) {
    cardCountByPlayer.set(
      c.playerName,
      (cardCountByPlayer.get(c.playerName) ?? 0) + 1,
    );
    if (
      (c.psa10Cents != null && c.psa10Cents > 0) ||
      (c.ungradedCents != null && c.ungradedCents > 0)
    ) {
      pricedSet.add(c.playerName);
    }
  }
  // Also resolve which products each player appears in (one query
  // would be cleaner, but we already have cards in memory so derive
  // from there: we don't have productId on the select, so use card
  // count as a proxy — players in 5+ cards almost certainly span
  // multiple products in our sets).
  // Tightest filter that still surfaces meaningful results: anyone
  // priced anywhere in our DB. CH won't have 30-day volume on
  // unpriced players anyway, and the rate limit + 5s deadline mean
  // we can't sweep wider than ~600 players per request without
  // some not finishing.
  const playersInSport = [
    ...new Set(remapped.map((c) => c.playerName)),
  ].filter((name) => pricedSet.has(name));

  // Most-frequent team per player — same logic as product page,
  // applied across every product in the sport. Captures the
  // canonical team for the player even when one product had them
  // on a placeholder.
  const teamCounts = new Map<string, Map<string, number>>();
  for (const c of remapped) {
    if (!c.team || c.team === "—") continue;
    let inner = teamCounts.get(c.playerName);
    if (!inner) {
      inner = new Map();
      teamCounts.set(c.playerName, inner);
    }
    inner.set(c.team, (inner.get(c.team) ?? 0) + 1);
  }
  const primaryTeamFor = (name: string): string | null => {
    const inner = teamCounts.get(name);
    if (!inner) return null;
    return [...inner.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };
  const playerRookieMap: Record<string, boolean> = {};
  for (const c of remapped) {
    if (isRookieVariation(c.variation)) playerRookieMap[c.playerName] = true;
  }

  // Use a longer deadline on the dedicated /hot page than we use
  // on product pages — this is the page where the trending list IS
  // the primary content, so users tolerate a few extra seconds on
  // a cold first load. Page-level revalidate=300 means subsequent
  // visitors hit cache and never feel this latency.
  const { map: trending, diagnostics } = await computeTrendingMap(
    playersInSport,
    { deadlineMs: 15000, perBatchMs: 4000 },
  );

  // Rank by 30-day dollar volume, not just spike multiple. A
  // big-name veteran with consistent volume reads as more
  // meaningful than a single-week 0→3 jump on a no-name. Floor
  // at last30dCents > 0 so we don't display dead names.
  const ranked = Object.entries(trending)
    .filter(([, t]) => t.last30dCents > 0)
    .map(([name, t]) => ({
      playerName: name,
      team: primaryTeamFor(name),
      isRookie: playerRookieMap[name] ?? false,
      isTrending: t.isTrending,
      currentWeekSales: t.currentWeekSales,
      currentWeekCents: t.currentWeekCents,
      last30dCents: t.last30dCents,
      last30dSales: t.last30dSales,
      spikeMultiple: t.spikeMultiple,
    }))
    .sort((a, b) => b.currentWeekCents - a.currentWeekCents);

  const trendingCount = ranked.filter((r) => r.isTrending).length;
  const totalDollars = ranked.reduce((s, r) => s + r.last30dCents, 0);
  const totalSales = ranked.reduce((s, r) => s + r.last30dSales, 0);

  const sportLabel =
    SPORT_LABEL[sportCandidates[0]] ?? sportCandidates[0];

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-8">
        <Link
          href="/hot"
          className="text-[11px] font-bold uppercase tracking-tight-2 text-slate-500 hover:text-ink"
        >
          ← All sports
        </Link>
        <div className="mt-3 text-[10px] font-bold uppercase tracking-tight-2 text-accent">
          Trending · {sportCandidates[0]}
        </div>
        <h1 className="mt-1 text-2xl font-extrabold leading-tight tracking-tight-3 sm:text-4xl">
          🔥 {sportLabel} on Fire
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-500">
          <span>
            <strong className="text-ink">{trendingCount}</strong> spiking ≥5×
          </span>
          <span>
            <strong className="text-ink">
              {totalSales.toLocaleString()}
            </strong>{" "}
            sales (30d)
          </span>
          <span>
            <strong className="text-ink">
              {formatUsd(totalDollars)}
            </strong>{" "}
            volume (30d)
          </span>
        </div>
      </div>

      {ranked.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-xs text-slate-500">
          {diagnostics.apiKeyMissing
            ? "Card Hedger integration disabled (no API key on this deploy)."
            : `No movers detected. CH returned ${diagnostics.playersWithData}/${diagnostics.playersRequested} player rows.`}
        </div>
      ) : (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="grid grid-cols-12 gap-3 border-b border-slate-200 bg-ink px-4 py-2.5 text-[10px] font-bold uppercase tracking-tight-2 text-white">
            <div className="col-span-1">#</div>
            <div className="col-span-5 sm:col-span-4">Player</div>
            <div className="hidden sm:col-span-3 sm:block">Team</div>
            <div className="col-span-3 sm:col-span-2 text-right">7d sales</div>
            <div className="col-span-3 sm:col-span-2 text-right">30d $</div>
          </div>
          <ul className="divide-y divide-slate-100">
            {ranked.slice(0, 100).map((r, i) => (
              <li
                key={r.playerName}
                className={`grid grid-cols-12 items-center gap-3 px-4 py-2.5 hover:bg-bone/40 ${
                  r.isTrending ? "bg-accent-tint/20" : ""
                }`}
              >
                <div className="col-span-1 text-xs tabular-nums text-slate-400">
                  {i + 1}
                </div>
                <div className="col-span-5 sm:col-span-4 min-w-0">
                  <Link
                    href={`/players/${playerSlug(r.playerName)}`}
                    className="block truncate font-semibold text-slate-800 hover:text-accent"
                  >
                    {r.playerName}
                    {r.isTrending && (
                      <span
                        className="ml-1 align-middle text-sm"
                        title={`Trending — ${r.currentWeekSales} sales this week, ${
                          Number.isFinite(r.spikeMultiple)
                            ? `×${r.spikeMultiple.toFixed(1)} prior 3-week avg`
                            : "first activity in 4 weeks"
                        }`}
                      >
                        🔥
                      </span>
                    )}
                    {r.isRookie && (
                      <span
                        className="ml-1 text-[10px] font-bold text-accent"
                        title="Rookie card in at least one tracked set"
                      >
                        (R)
                      </span>
                    )}
                  </Link>
                  <div className="truncate text-[10px] font-medium text-slate-400 sm:hidden">
                    {r.team ?? "—"}
                  </div>
                </div>
                <div className="hidden truncate text-xs text-slate-500 sm:col-span-3 sm:block">
                  {r.team ?? "—"}
                </div>
                <div className="col-span-3 sm:col-span-2 text-right tabular-nums text-xs">
                  <div className="font-bold text-ink">
                    {r.currentWeekSales.toLocaleString()}
                  </div>
                  {Number.isFinite(r.spikeMultiple) &&
                    r.spikeMultiple >= 1.5 && (
                      <div className="text-[10px] font-medium text-accent">
                        ×{r.spikeMultiple.toFixed(1)}
                      </div>
                    )}
                </div>
                <div className="col-span-3 sm:col-span-2 text-right tabular-nums">
                  <div className="text-sm font-extrabold text-ink">
                    {formatUsd(r.currentWeekCents)}
                  </div>
                  <div className="text-[10px] font-medium text-slate-400">
                    30d {formatUsd(r.last30dCents)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {ranked.length > 100 && (
            <div className="border-t border-slate-200 bg-bone px-4 py-2 text-center text-[10px] font-medium text-slate-500">
              Showing top 100 of {ranked.length} players with sales activity.
            </div>
          )}
        </section>
      )}
    </div>
  );
}
