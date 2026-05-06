import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { listSources } from "@/lib/sources";
import SearchFilters from "@/components/SearchFilters";
import { extractYears, uniqueSorted } from "@/lib/search";
import SyncButton from "./SyncButton";

export const dynamic = "force-dynamic";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    year?: string;
    mfr?: string;
    sport?: string;
  }>;
}) {
  const params = await searchParams;
  const q = (params.q ?? "").trim().toLowerCase();
  const year = params.year ?? null;
  const mfr = params.mfr ?? null;
  const sport = params.sport ?? null;

  // Pull all products and filter in memory — same approach as the home page
  // for case-insensitive search compatibility across SQLite/Postgres.
  const all = await prisma.product.findMany({
    orderBy: [{ releaseDate: "asc" }, { name: "asc" }],
    include: { _count: { select: { cards: true } } },
  });

  const years = uniqueSorted(all.flatMap((p) => extractYears(p.name)));
  const manufacturers = uniqueSorted(all.map((p) => p.manufacturer));
  const sports = uniqueSorted(all.map((p) => p.sport));

  const products = all.filter((p) => {
    if (year && !extractYears(p.name).includes(year)) return false;
    if (mfr && p.manufacturer !== mfr) return false;
    if (sport && p.sport !== sport) return false;
    if (q) {
      const hay = `${p.name} ${p.manufacturer ?? ""} ${p.sport}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const dated = products.filter((p) => p.releaseDate);
  const undated = products.filter((p) => !p.releaseDate);
  const groups = new Map<string, typeof products>();
  for (const p of dated) {
    const d = p.releaseDate!;
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-tight-2 text-accent">
            Release Calendar
          </div>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight-3 sm:text-4xl">
            What's Dropping
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {products.length === all.length
              ? `${all.length} products on the calendar`
              : `${products.length} of ${all.length} products`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {listSources().map((s) => (
            <SyncButton
              key={s.id}
              provider={s.id.replace(/^api:/, "")}
              label={s.label}
            />
          ))}
        </div>
      </div>

      <SearchFilters
        basePath="/calendar"
        searchPlaceholder="Search calendar by product name…"
        initialQuery={params.q ?? ""}
        facets={[
          {
            label: "Sport",
            paramKey: "sport",
            values: sports,
            selected: sport,
            variant: "chips",
          },
          {
            label: "Year",
            paramKey: "year",
            values: years,
            selected: year,
            variant: "dropdown",
          },
          {
            label: "Manufacturer",
            paramKey: "mfr",
            values: manufacturers,
            selected: mfr,
            variant: "chips",
          },
        ]}
      />

      {products.length === 0 && (
        <div className="rounded-2xl border-2 border-dashed border-slate-300 bg-white p-12 text-center">
          <p className="text-base font-semibold text-slate-600">
            No products match.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Try clearing a filter, searching for a different term, or running a sync above.
          </p>
        </div>
      )}

      {Array.from(groups.entries()).map(([key, items]) => (
        <section key={key} className="space-y-2">
          <h2 className="text-[11px] font-bold uppercase tracking-tight-2 text-slate-500">
            {monthLabel(key)}
          </h2>
          <ul className="grid gap-2">
            {items.map((p) => (
              <li
                key={p.id}
                className="rounded-xl border border-slate-200 bg-white p-4 transition hover:-translate-y-0.5 hover:border-ink hover:shadow-md"
              >
                <Link
                  href={`/products/${p.id}`}
                  className="flex items-baseline justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-base font-bold tracking-tight-2">{p.name}</div>
                    <div className="text-xs text-slate-500">
                      {[
                        p.manufacturer,
                        p.sport,
                        p.releaseDate!.toISOString().slice(0, 10),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  <div className="shrink-0 text-xs text-slate-500">
                    {p._count.cards} cards
                    {p.source !== "manual" && (
                      <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-500">
                        {p.source.replace(/^api:/, "")}
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {undated.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-[11px] font-bold uppercase tracking-tight-2 text-slate-500">
            Undated
          </h2>
          <ul className="grid gap-2">
            {undated.map((p) => (
              <li
                key={p.id}
                className="rounded-xl border border-slate-200 bg-white p-4 transition hover:-translate-y-0.5 hover:border-ink hover:shadow-md"
              >
                <Link
                  href={`/products/${p.id}`}
                  className="flex items-baseline justify-between gap-3"
                >
                  <div>
                    <div className="text-base font-bold tracking-tight-2">{p.name}</div>
                    <div className="text-xs text-slate-500">
                      {[p.manufacturer, p.sport].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <div className="shrink-0 text-xs text-slate-500">
                    {p._count.cards} cards
                    {p.source !== "manual" && (
                      <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-500">
                        {p.source.replace(/^api:/, "")}
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function monthLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
