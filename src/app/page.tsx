import Link from "next/link";
import { prisma } from "@/lib/prisma";
import SearchFilters from "@/components/SearchFilters";
import SortSelector, { type SortOption } from "@/components/SortSelector";
import { extractYear, uniqueSorted } from "@/lib/search";

export const dynamic = "force-dynamic";

const SORT_OPTIONS: SortOption[] = [
  { value: "release-desc", label: "Newest release first" },
  { value: "release-asc", label: "Oldest release first" },
  { value: "name-asc", label: "Name A → Z" },
  { value: "cards-desc", label: "Most cards first" },
  { value: "created-desc", label: "Recently added" },
];

function applySort<
  T extends {
    name: string;
    releaseDate: Date | null;
    createdAt: Date;
    _count: { cards: number };
  },
>(rows: T[], sort: string): T[] {
  const out = [...rows];
  switch (sort) {
    case "release-asc":
      return out.sort((a, b) => {
        const aT = a.releaseDate?.getTime() ?? Infinity;
        const bT = b.releaseDate?.getTime() ?? Infinity;
        return aT - bT;
      });
    case "name-asc":
      return out.sort((a, b) => a.name.localeCompare(b.name));
    case "cards-desc":
      return out.sort((a, b) => b._count.cards - a._count.cards);
    case "created-desc":
      return out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    case "release-desc":
    default:
      return out.sort((a, b) => {
        const aT = a.releaseDate?.getTime() ?? -Infinity;
        const bT = b.releaseDate?.getTime() ?? -Infinity;
        return bT - aT;
      });
  }
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    year?: string;
    mfr?: string;
    sport?: string;
    sort?: string;
  }>;
}) {
  const params = await searchParams;
  const q = (params.q ?? "").trim().toLowerCase();
  const year = params.year ?? null;
  const mfr = params.mfr ?? null;
  const sport = params.sport ?? null;
  const sort = params.sort ?? "release-desc";

  // Pull all products — small set in MVP. Filter in memory so search can be
  // case-insensitive across SQLite/Postgres without provider-specific syntax.
  const all = await prisma.product.findMany({
    orderBy: [{ releaseDate: "desc" }, { createdAt: "desc" }],
    include: { _count: { select: { cards: true } } },
  });

  // Mixers — multi-product break sessions. Show them above products since
  // they're typically the active thing a breaker is running.
  const mixers = await prisma.mixer.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      products: {
        include: { product: { select: { name: true, _count: { select: { cards: true } } } } },
      },
    },
  });

  // Build chip values from the unfiltered set so options don't disappear when
  // a filter is active.
  const years = uniqueSorted(all.map((p) => extractYear(p.name)));
  const manufacturers = uniqueSorted(all.map((p) => p.manufacturer));
  const sports = uniqueSorted(all.map((p) => p.sport));

  const filtered = applySort(
    all.filter((p) => {
      if (year && extractYear(p.name) !== year) return false;
      if (mfr && p.manufacturer !== mfr) return false;
      if (sport && p.sport !== sport) return false;
      if (q) {
        const hay = `${p.name} ${p.manufacturer ?? ""} ${p.sport}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }),
    sort,
  );

  const activeFilters = [
    q && `"${q}"`,
    year,
    mfr,
    sport,
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-tight-2 text-accent">
            Break Products
          </div>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight-3 sm:text-4xl">
            Your Catalog
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {filtered.length === all.length
              ? `${all.length} ${all.length === 1 ? "product" : "products"} indexed`
              : `${filtered.length} of ${all.length} products${
                  activeFilters.length > 0 ? ` · ${activeFilters.join(" · ")}` : ""
                }`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SortSelector
            basePath="/"
            options={SORT_OPTIONS}
            selected={sort}
          />
          <Link
            href="/mixers/new"
            className="rounded-md border border-ink bg-white px-4 py-2.5 text-xs font-bold uppercase tracking-tight-2 text-ink hover:bg-ink hover:text-white sm:px-5 sm:py-3 sm:text-sm"
          >
            + Mixer
          </Link>
          <Link
            href="/products/new"
            className="rounded-md bg-ink px-4 py-2.5 text-xs font-bold uppercase tracking-tight-2 text-white hover:opacity-90 sm:px-5 sm:py-3 sm:text-sm"
          >
            + Product
          </Link>
        </div>
      </div>

      {/* Mixers (multi-product break sessions) live above the product list
          since they're typically the live thing a breaker is running. */}
      {mixers.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[11px] font-bold uppercase tracking-tight-2 text-accent">
              Mixers
            </h2>
            <span className="text-xs text-slate-500">
              {mixers.length} {mixers.length === 1 ? "mixer" : "mixers"}
            </span>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {mixers.map((m) => {
              const totalCards = m.products.reduce(
                (s, p) => s + p.product._count.cards,
                0,
              );
              return (
                <li key={m.id}>
                  <Link
                    href={`/mixers/${m.id}`}
                    className="group block h-full rounded-xl border border-slate-200 bg-white p-5 transition hover:-translate-y-0.5 hover:border-ink hover:shadow-lg"
                  >
                    <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-tight-2 text-accent">
                      <span>Mixer</span>
                      {m.breakerHandle && (
                        <>
                          <span aria-hidden className="text-slate-400">·</span>
                          <span>@{m.breakerHandle}</span>
                        </>
                      )}
                    </div>
                    <div className="text-base font-bold leading-tight tracking-tight-2">
                      {m.name}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {m.products.map((mp) => (
                        <span
                          key={mp.productId}
                          className="rounded bg-bone px-2 py-0.5 text-[10px] font-semibold text-slate-700"
                        >
                          {mp.product.name}
                        </span>
                      ))}
                    </div>
                    <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
                      <span>
                        {m.products.length} products · {totalCards} cards
                      </span>
                      <span className="font-semibold text-ink group-hover:text-accent">
                        Open →
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <SearchFilters
        basePath="/"
        searchPlaceholder="Search products by name…"
        initialQuery={params.q ?? ""}
        facets={[
          { label: "Year", paramKey: "year", values: years, selected: year },
          { label: "Sport", paramKey: "sport", values: sports, selected: sport },
          {
            label: "Manufacturer",
            paramKey: "mfr",
            values: manufacturers,
            selected: mfr,
          },
        ]}
      />

      {all.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-slate-300 bg-white p-16 text-center">
          <p className="text-base text-slate-600">No products yet.</p>
          <Link
            href="/products/new"
            className="mt-4 inline-block text-sm font-semibold text-accent hover:underline"
          >
            Create your first product →
          </Link>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-slate-300 bg-white p-12 text-center">
          <p className="text-base font-semibold text-slate-600">No matches.</p>
          <p className="mt-1 text-xs text-slate-500">
            Try clearing a filter or searching for a different term.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <li key={p.id}>
              <Link
                href={`/products/${p.id}`}
                className="group block h-full rounded-xl border border-slate-200 bg-white p-5 transition hover:-translate-y-0.5 hover:border-ink hover:shadow-lg"
              >
                <div className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-tight-2 text-slate-500">
                  {p.manufacturer && <span>{p.manufacturer}</span>}
                  <span>{p.sport}</span>
                  {p.releaseDate && (
                    <>
                      <span aria-hidden>·</span>
                      <span>{p.releaseDate.toISOString().slice(0, 10)}</span>
                    </>
                  )}
                </div>
                <div className="text-base font-bold leading-tight tracking-tight-2">
                  {p.name}
                </div>
                <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
                  {p._count.cards === 0 ? (
                    <span className="inline-flex items-center gap-1 rounded border border-accent/30 bg-accent/5 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-tight-2 text-accent">
                      Coming Soon
                    </span>
                  ) : (
                    <span>
                      {p._count.cards} {p._count.cards === 1 ? "card" : "cards"}
                    </span>
                  )}
                  <span className="font-semibold text-ink group-hover:text-accent">
                    Open →
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
