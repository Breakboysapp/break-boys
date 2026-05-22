import Link from "next/link";
import { getProspectSleeperIndex } from "@/lib/cached-queries";
import SleeperTable from "./SleeperTable";

/**
 * /prospects — the Sleeper Index.
 *
 * Joins each prospect on a published Top 100 list with their current
 * card market. Surfaces the guys raking in the minors whose card
 * market hasn't caught up yet:
 *
 *   SleeperScore = Quality / Market
 *
 *   Quality = 101 − rank      (rank 1 = 100, rank 100 = 1)
 *   Market  = log-blend of priced cards, normalized 0-100
 *
 * Ranking source is the MLB Pipeline Top 100, scraped weekly by
 * /api/cron/refresh-prospects (and on-demand from /admin/prospects).
 *
 * No paywall yet — the auth + Stripe layer ships once the math is
 * validated against a real list. Per the scope doc, eventually the
 * top 10 stays free + everything else gates.
 */
export const dynamic = "force-dynamic";

export default async function ProspectsPage() {
  const rows = await getProspectSleeperIndex("MLB");

  // Header KPIs surface the "is there even any data here?" answer at a
  // glance — until the cron runs (or someone hits Refresh on
  // /admin/prospects), every number is zero and the user lands on
  // a copy-driven empty state pointing them at the admin page.
  const totalRanked = rows.length;
  const withMarket = rows.filter((r) => r.market != null).length;
  const topSleeper = rows.find((r) => r.sleeper != null);
  const source = rows[0]?.source;
  const capturedAt = rows[0]?.capturedAt;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-8">
        <div className="text-[10px] font-bold uppercase tracking-tight-2 text-accent">
          Insights · MLB
        </div>
        <h1 className="mt-1 text-2xl font-extrabold leading-tight tracking-tight-3 sm:text-4xl">
          Sleeper Index
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-500">
          Top 100 prospects ranked by{" "}
          <span className="font-bold text-ink">Sleeper Score</span> —
          quality (their place on the published list) ÷ card market
          (how much the hobby has already priced them in). Higher = more
          undervalued.
        </p>
      </div>

      {totalRanked === 0 ? (
        <EmptyState />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiCard label="Ranked prospects" value={totalRanked.toLocaleString()} />
            <KpiCard
              label="With card market"
              value={`${withMarket} / ${totalRanked}`}
            />
            <KpiCard
              label="Top sleeper"
              value={topSleeper?.playerName ?? "—"}
              sub={
                topSleeper?.sleeper != null
                  ? `Score ${topSleeper.sleeper.toFixed(1)}`
                  : undefined
              }
            />
            <KpiCard
              label="Source"
              value={source ?? "—"}
              sub={
                capturedAt
                  ? `Captured ${new Date(capturedAt).toISOString().slice(0, 10)}`
                  : undefined
              }
            />
          </div>

          <SleeperTable rows={rows} />
        </>
      )}
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

function EmptyState() {
  return (
    <div className="rounded-2xl border-2 border-dashed border-slate-300 bg-white p-10 text-center">
      <div className="text-[11px] font-bold uppercase tracking-tight-2 text-accent">
        Empty
      </div>
      <div className="mt-2 text-2xl font-extrabold tracking-tight-3">
        No prospect rankings yet
      </div>
      <p className="mx-auto mt-3 max-w-md text-sm text-slate-500">
        Pulls the Top 100 from MLB Pipeline. Hit Refresh on the admin
        page to seed it — Sleeper Scores fill in automatically once the
        list lands.
      </p>
      <Link
        href="/admin/prospects"
        className="mt-5 inline-block rounded-md bg-ink px-5 py-2.5 text-sm font-bold uppercase tracking-tight-2 text-white hover:opacity-90"
      >
        Refresh from MLB →
      </Link>
    </div>
  );
}
