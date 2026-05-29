import Link from "next/link";
import { notFound } from "next/navigation";
import { getProductSleeperBoard } from "@/lib/cached-queries";
import {
  isRosterStale,
  refreshMilbRoster,
} from "@/lib/sleepers/refresh-roster";
import {
  areStatsStale,
  refreshMilbStats,
} from "@/lib/sleepers/refresh-stats";
import SleepersTable from "./SleepersTable";

/**
 * /products/[id]/sleepers — Pick-Your-Player decision board.
 *
 * Headline use case: Bowman 2026 PYP break. Host charges $X per
 * player slot. Buyer needs to know which players in the checklist
 * are actually worth chasing — beyond the obvious (Holliday,
 * Made, Griffin) — so they can find the AA hitter whose card
 * market hasn't caught up to his production.
 *
 * v1 (this page): join the product's checklist with MLB's current
 * MiLB roster + the existing card market. Surfaces level + team +
 * age per player, sortable by top-auto price. Already useful for
 * spotting "high market but no Pipeline rank" arbitrage.
 *
 * v2 (queued): per-player season stats (wRC+, FIP-) → Production
 * Index → Sleeper Score = Production / Market. That's the real
 * "playing well but market hasn't noticed" signal.
 *
 * Self-seeds the MilbRoster cache on first visit if empty or stale
 * (>24h). After that, reads from cache. Daily cron will land later.
 */
export const dynamic = "force-dynamic";

export default async function ProductSleepersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Seed roster + stats on cold start. The page is rendered server-
  // side so this happens before the user sees anything — first visit
  // is slower (~5-8s for both fetches in parallel) but every visit
  // after is fast (24h cache).
  let seedError: string | null = null;
  const [rosterStale, statsStale] = await Promise.all([
    isRosterStale(),
    areStatsStale(),
  ]);
  if (rosterStale || statsStale) {
    try {
      await Promise.all([
        rosterStale ? refreshMilbRoster() : Promise.resolve(),
        statsStale ? refreshMilbStats() : Promise.resolve(),
      ]);
    } catch (err) {
      seedError = err instanceof Error ? err.message : String(err);
    }
  }

  const board = await getProductSleeperBoard(id);
  if (!board) notFound();

  const { product, rows, unmatched } = board;
  const matched = rows.length - unmatched;
  const matchPct = rows.length > 0 ? Math.round((matched / rows.length) * 100) : 0;
  const ranked = rows.filter((r) => r.pipelineRank != null).length;
  const withProduction = rows.filter((r) => r.production != null).length;
  // Production sleeper = high production score, modest market. This
  // is the number that answers the user's original "playing well but
  // market hasn't noticed" question.
  const productionSleepers = rows.filter(
    (r) =>
      r.production != null &&
      r.production >= 65 &&
      (r.market ?? 0) <= 40 &&
      (r.topPriceCents ?? 0) > 0,
  ).length;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-tight-2 text-accent">
              Sleeper Board · {product.sport}
            </div>
            <h1 className="mt-1 text-2xl font-extrabold leading-tight tracking-tight-3 sm:text-4xl">
              {product.name}
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-500">
              Every player on this product&apos;s checklist joined with their{" "}
              <span className="font-bold text-ink">
                current MiLB level
              </span>{" "}
              and their card market. Built for Pick-Your-Player breaks —
              spot the AA bat whose auto hasn&apos;t priced him in yet.
            </p>
          </div>
          <Link
            href={`/products/${product.id}`}
            className="shrink-0 rounded-md border border-slate-300 px-3 py-1.5 text-[11px] font-bold uppercase tracking-tight-2 text-slate-600 hover:bg-slate-50"
          >
            ← Back
          </Link>
        </div>
      </div>

      {seedError && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-900">
          <span className="font-bold">Roster sync failed:</span> {seedError}{" "}
          — showing whatever roster data is cached.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          label="Players"
          value={rows.length.toLocaleString()}
          sub={`from ${rows.length === 0 ? 0 : "checklist"}`}
        />
        <KpiCard
          label="Roster match"
          value={`${matchPct}%`}
          sub={`${matched.toLocaleString()} of ${rows.length.toLocaleString()}`}
        />
        <KpiCard
          label="With stats"
          value={withProduction.toLocaleString()}
          sub={`${ranked} on Pipeline Top 100`}
        />
        <KpiCard
          label="Production sleepers"
          value={productionSleepers.toLocaleString()}
          sub="high prod · low market"
        />
      </div>

      <SleepersTable rows={rows} />
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="text-[10px] font-bold uppercase tracking-tight-2 text-slate-500">
        {label}
      </div>
      <div className="mt-1 truncate text-xl font-extrabold tracking-tight-3 text-ink sm:text-2xl">
        {value}
      </div>
      {sub && <div className="mt-1 text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}
