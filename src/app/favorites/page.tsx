/**
 * Favorites page — products the current user has pinned via the heart
 * button on a product page. Shares the visual pattern with the home
 * page's catalog grid (same product-card chrome) so users feel at
 * home; just filtered to favorites and dropping the search/filter
 * facets since the list is curated.
 *
 * No auth yet → all favorites are scoped to userId = "local". When
 * auth lands the same query just becomes per-real-user automatically.
 */
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { CURRENT_USER_ID } from "@/lib/user";

export const dynamic = "force-dynamic";

export default async function FavoritesPage() {
  const favs = await prisma.userFavoriteProduct.findMany({
    where: { userId: CURRENT_USER_ID },
    orderBy: { createdAt: "desc" },
    include: {
      product: {
        include: { _count: { select: { cards: true } } },
      },
    },
  });

  const products = favs.map((f) => f.product);

  return (
    <div className="space-y-8">
      <div>
        <div className="text-[11px] font-bold uppercase tracking-tight-2 text-accent">
          Favorites
        </div>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight-3 sm:text-4xl">
          Your favorites
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {products.length === 0
            ? "Tap the heart on any product page to pin it here."
            : `${products.length} ${
                products.length === 1 ? "product" : "products"
              } pinned`}
        </p>
      </div>

      {products.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-slate-300 bg-white p-12 text-center">
          <p className="text-base font-semibold text-slate-600">
            Nothing pinned yet.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Open any product and tap the ♥ in the top-right of the hero
            to add it to favorites.
          </p>
          <Link
            href="/"
            className="mt-4 inline-block text-sm font-semibold text-accent hover:underline"
          >
            Browse the catalog →
          </Link>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => (
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
                      <span>
                        {p.releaseDate.toISOString().slice(0, 10)}
                      </span>
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
                      {p._count.cards}{" "}
                      {p._count.cards === 1 ? "card" : "cards"}
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
