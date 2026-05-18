import { getProductGemRates } from "@/lib/cached-queries";
import GemRateTable from "./GemRateTable";

export const dynamic = "force-dynamic";

/**
 * /insights/gem-rates — catalog-wide gem-rate roll-up.
 *
 * One row per product; cards w/ pop counts summed up to the product
 * level, then divided to produce a gem-rate percentage. Server reads
 * via the cached getProductGemRates() so this view is essentially
 * free on cache hits.
 *
 * Layout: three KPI cards on top (catalog-wide totals) + the
 * sortable/filterable table below. Sport-grouped distribution
 * chart from the scope doc is intentionally deferred — table
 * carries 90% of the value and ships clean.
 */
export default async function GemRatesPage() {
  const rows = await getProductGemRates();

  // Catalog-wide KPIs. Weighted overall gem rate = Σ popG10 / Σ popTotal
  // across every priced card in every product — NOT an average of
  // per-product percentages (that would give a Topps Chrome /1 sample
  // the same weight as a 10k-card Bowman).
  const productsWithPop = rows.length;
  const totalGraded = rows.reduce((s, r) => s + r.popTotal, 0);
  const totalGem10 = rows.reduce((s, r) => s + r.popG10, 0);
  const weightedGemRate = totalGraded > 0 ? totalGem10 / totalGraded : 0;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-8">
        <div className="text-[10px] font-bold uppercase tracking-tight-2 text-accent">
          Insights
        </div>
        <h1 className="mt-1 text-2xl font-extrabold leading-tight tracking-tight-3 sm:text-4xl">
          Gem Rates
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-500">
          Catalog-wide PSA 10 yield per product — sum of every card&apos;s
          gem-10 pop divided by total graded pop. Higher = more
          gem-worthy hits per box opened.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard
          label="Products w/ pop data"
          value={productsWithPop.toLocaleString()}
        />
        <KpiCard
          label="Cards graded (catalog)"
          value={totalGraded.toLocaleString()}
        />
        <KpiCard
          label="Weighted overall gem rate"
          value={`${(weightedGemRate * 100).toFixed(1)}%`}
        />
      </div>

      <GemRateTable rows={rows} />
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="text-[10px] font-bold uppercase tracking-tight-2 text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-2xl font-extrabold tracking-tight-3 text-ink">
        {value}
      </div>
    </div>
  );
}
