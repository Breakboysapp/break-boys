import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { sportsFromPath } from "@/lib/product-path";
import { remapInternationalAnime } from "@/lib/international-anime";
import { playerSlug } from "@/lib/player-slug";
import { formatUsd } from "@/lib/money";

export const dynamic = "force-dynamic";

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

  // Pull only the distinct player → team mapping for this sport.
  // We don't need every card here — we read trending data from
  // PlayerTrendingSnapshot (populated by the daily refresh-trending
  // cron). The cards lookup is just to display each player's team
  // + rookie tag alongside the trending row.
  const cards = await prisma.card.findMany({
    where: { product: { sport: { in: sportCandidates } } },
    select: {
      playerName: true,
      team: true,
      variation: true,
      cardNumber: true,
    },
  });
  if (cards.length === 0) notFound();

  // Apply the same anime remap we use on the product page so
  // Cal Raleigh / Aaron Judge / Ohtani aren't double-counted on
  // their national-team affiliations.
  const remapped = remapInternationalAnime(cards);

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
  // No rookie map at the sport-aggregate level. (R) is set-specific
  // (e.g. Yamamoto's 2024 Topps cards are correctly marked RC, but
  // by 2026 he's a sophomore — flagging him as a "rookie" on the
  // year-spanning hot list would be misleading). The product-page
  // chase view still surfaces (R) where it's accurate.

  // Read pre-computed trending data straight from PlayerTrendingSnapshot.
  // The refresh-trending cron writes here daily so the page render is
  // a single indexed Postgres query — no external API in the request
  // path, no rate-limit risk, no cold-load wait.
  const snapshots = await prisma.playerTrendingSnapshot.findMany({
    where: { sport: { in: sportCandidates } },
    orderBy: { last30dCents: "desc" },
    take: 200,
  });
  const lastCapturedAt = snapshots.reduce<Date | null>(
    (latest, s) =>
      latest == null || s.capturedAt > latest ? s.capturedAt : latest,
    null,
  );

  // Rank by 30-day dollar volume — already sorted by Postgres above.
  // Filter to players with non-zero volume + decorate with display
  // bits sourced from the cards table.
  const ranked = snapshots
    .filter((s) => s.last30dCents > 0)
    .map((s) => ({
      playerName: s.playerName,
      team: primaryTeamFor(s.playerName),
      isTrending: s.isTrending,
      currentWeekSales: s.currentWeekSales,
      currentWeekCents: s.currentWeekCents,
      last30dCents: s.last30dCents,
      last30dSales: s.last30dSales,
      // Snapshot stores Infinity as null; restore for the UI's
      // tooltip math. Frontend renders "new" instead of a number
      // when not finite.
      spikeMultiple: s.spikeMultiple ?? Infinity,
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
          {lastCapturedAt && (
            <span className="text-slate-400">
              · refreshed{" "}
              {new Date(lastCapturedAt).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
          )}
        </div>
      </div>

      {ranked.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-xs text-slate-500">
          {snapshots.length === 0
            ? "Trending data hasn't been refreshed for this sport yet. The daily refresh cron populates this table; check back after the next run."
            : "No movers with non-zero 30-day volume."}
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
