import { getProspectSleeperIndex } from "@/lib/cached-queries";
import { refreshMlbPipelineTop100 } from "@/lib/prospects/refresh";
import SleeperTable from "./SleeperTable";

/**
 * /prospects — the Sleeper Index.
 *
 * Joins each prospect on MLB Pipeline's published Top 100 with their
 * current card market. Surfaces the guys raking in the minors whose
 * card market hasn't caught up yet:
 *
 *   SleeperScore = Quality / Market
 *
 *   Quality = 101 − rank      (rank 1 = 100, rank 100 = 1)
 *   Market  = log-blend of priced cards, normalized 0-100
 *
 * Data is owned end-to-end by the app — no manual ingestion surface.
 * The weekly /api/cron/refresh-prospects cron keeps the list fresh,
 * and on cold-start (empty table) we self-seed inline below so the
 * first visit never sees an empty page.
 *
 * Each refresh carries forward the prior `rank` as `previousRank` so
 * the table can render an ↑N / ↓N / NEW chip per row.
 */
export const dynamic = "force-dynamic";

export default async function ProspectsPage() {
  let rows = await getProspectSleeperIndex("MLB");

  // Self-seed on cold start. After this lands the weekly cron owns
  // freshness; this path only fires when the table is genuinely empty
  // (fresh deploy, freshly-wiped staging DB).
  let seedError: string | null = null;
  if (rows.length === 0) {
    try {
      await refreshMlbPipelineTop100();
      rows = await getProspectSleeperIndex("MLB");
    } catch (err) {
      seedError = err instanceof Error ? err.message : String(err);
    }
  }

  const totalRanked = rows.length;
  const withMarket = rows.filter((r) => r.market != null).length;
  const topSleeper = rows.find((r) => r.sleeper != null);
  const climbers = rows.filter(
    (r) => r.movement != null && r.movement > 0,
  ).length;
  const fallers = rows.filter(
    (r) => r.movement != null && r.movement < 0,
  ).length;
  const newEntries = rows.filter((r) => r.previousRank == null).length;
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
          quality (their place on MLB Pipeline&apos;s published Top 100)
          ÷ card market (how much the hobby has already priced them in).
          Higher = more undervalued.
        </p>
        {capturedAt && (
          <p className="mt-2 text-[11px] text-slate-400">
            MLB Pipeline · captured{" "}
            {new Date(capturedAt).toLocaleDateString(undefined, {
              year: "numeric",
              month: "short",
              day: "numeric",
            })}
          </p>
        )}
      </div>

      {totalRanked === 0 ? (
        <FetchFailedState message={seedError} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiCard
              label="Ranked"
              value={totalRanked.toLocaleString()}
              sub={`${withMarket} with card market`}
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
              label="Movement"
              value={`↑${climbers} · ↓${fallers}`}
              sub={
                newEntries > 0 ? `${newEntries} new this week` : undefined
              }
            />
            <KpiCard
              label="Coverage"
              value={`${Math.round((withMarket / totalRanked) * 100)}%`}
              sub="of Top 100 has a tracked market"
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

function FetchFailedState({ message }: { message: string | null }) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-slate-300 bg-white p-10 text-center">
      <div className="text-[11px] font-bold uppercase tracking-tight-2 text-accent">
        Couldn&apos;t load Top 100
      </div>
      <div className="mt-2 text-2xl font-extrabold tracking-tight-3">
        MLB Pipeline didn&apos;t respond
      </div>
      <p className="mx-auto mt-3 max-w-md text-sm text-slate-500">
        We try to fetch this list automatically. If you&apos;re seeing
        this, the upstream source was unreachable on this load — refresh
        the page in a few seconds.
      </p>
      {message && (
        <pre className="mx-auto mt-3 max-w-md overflow-x-auto rounded bg-slate-50 p-2 text-left text-[10px] text-slate-500">
          {message}
        </pre>
      )}
    </div>
  );
}
