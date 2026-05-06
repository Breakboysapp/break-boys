import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  PRICING_BLEND_ALPHA,
  computeBreakdown,
  summarizeAlgorithmFor,
} from "@/lib/scoring";
import { CURRENT_USER_ID } from "@/lib/user";
import ChecklistUpload from "./ChecklistUpload";
import TeamPriceEditor from "./TeamPriceEditor";
import FavoriteButton from "./FavoriteButton";
import ProductFormatsBar from "./ProductFormatsBar";

export const dynamic = "force-dynamic";

export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      teamPrices: { orderBy: { team: "asc" } },
      cards: {
        select: {
          cardNumber: true,
          team: true,
          playerName: true,
          variation: true,
          marketValueCents: true,
          // PriceCharting per-card data — feeds the Chase scoreboard.
          // All optional; products that haven't been imported through
          // scripts/import-pricecharting-set.ts have these as null and
          // the Chase toggle stays hidden.
          ungradedCents: true,
          psa10Cents: true,
          psa9Cents: true,
          printRun: true,
          imageUrl: true,
          popG10: true,
          popTotal: true,
        },
      },
      formats: {
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      },
      _count: { select: { cards: true } },
    },
  });
  if (!product) notFound();

  // Favorited state for the heart toggle in the hero. One small query;
  // the Product page is force-dynamic anyway so per-request is fine.
  const favorite = await prisma.userFavoriteProduct.findUnique({
    where: {
      userId_productId: { userId: CURRENT_USER_ID, productId: product.id },
    },
    select: { id: true },
  });
  const isFavorited = favorite != null;

  const algorithm = summarizeAlgorithmFor(product.cards);
  const teamBreakdown = computeBreakdown(product.cards, "team");
  const playerBreakdown = computeBreakdown(product.cards, "playerName");
  const totalContentScore = teamBreakdown.rows.reduce(
    (s, r) => s + r.totalScore,
    0,
  );
  const cardsWithMarket = product.cards.filter(
    (c) => c.marketValueCents != null && c.marketValueCents > 0,
  ).length;
  const hasTeams = product.teamPrices.length > 0;
  const isComingSoon = product._count.cards === 0;

  return (
    <div className="space-y-10">
      {/* Hero header */}
      <div className="relative rounded-2xl border border-slate-200 bg-white p-5 sm:p-8">
        {/* Favorite toggle, top-right of the hero. Saved per-user (still
            stubbed to "local" until auth lands) — surfaced under the
            Favorites link in the global nav. */}
        <div className="absolute right-4 top-4 sm:right-6 sm:top-6">
          <FavoriteButton
            productId={product.id}
            initialFavorited={isFavorited}
          />
        </div>
        <Link
          href="/"
          className="text-[11px] font-bold uppercase tracking-tight-2 text-slate-500 hover:text-ink"
        >
          ← All products
        </Link>
        <div className="mt-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-tight-2 text-accent">
          {[product.manufacturer, product.sport].filter(Boolean).join(" · ")}
        </div>
        <h1 className="mt-1 text-2xl font-extrabold leading-tight tracking-tight-3 sm:text-4xl">
          {product.name}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
          {product.releaseDate && (
            <span>Released {product.releaseDate.toISOString().slice(0, 10)}</span>
          )}
          <span>
            {product._count.cards} {product._count.cards === 1 ? "card" : "cards"}
          </span>
        </div>

        {hasTeams && !isComingSoon && (
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link
              href={`/products/${product.id}/break`}
              className="block w-full rounded-md bg-ink px-5 py-3 text-center text-sm font-bold uppercase tracking-tight-2 text-white hover:opacity-90 sm:inline-block sm:w-auto"
            >
              Start a break →
            </Link>
          </div>
        )}
        {isComingSoon && (
          <div className="mt-6 inline-flex items-center gap-2 rounded-md border border-accent/30 bg-accent/5 px-3 py-1.5 text-[11px] font-bold uppercase tracking-tight-2 text-accent">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            Coming Soon
          </div>
        )}
      </div>

      {/* Box format selector — compact native <select> dropdown.
          Pre-seeded for every product based on its name pattern
          (src/lib/product-formats-defaults.ts), so users never see
          an empty editor; they just pick the format they care about
          and read the inline summary. Notes still live in the DB but
          aren't surfaced here — kept the bar minimal per the user's
          ask. */}
      {product.formats.length > 0 && (
        <ProductFormatsBar
          formats={product.formats.map((f) => ({
            id: f.id,
            name: f.name,
            packsPerBox: f.packsPerBox,
            cardsPerPack: f.cardsPerPack,
            autosPerBox: f.autosPerBox,
          }))}
        />
      )}

      {isComingSoon ? (
        <ComingSoon productId={product.id} />
      ) : (
        <>
          {/*
            Render the scoreboard section for any product with a
            checklist, regardless of whether teams have been wired up.
            PriceCharting-imported products start with all cards under a
            placeholder "—" team but already have psa10Cents data, so
            their Chase Scoreboard is the immediately useful view; the
            Team Scoreboard renders one degenerate "—" row, which is
            ugly but doesn't block the user from seeing Chase. Manually-
            uploaded products with real teams render Team Scoreboard
            fully and don't show Chase (no PriceCharting data on them
            yet — fixed when we merge the importer match logic next).
          */}
          {!isComingSoon && (
            <section className="space-y-3">
              <TeamPriceEditor
                productId={product.id}
                initialBoxPriceCents={product.boxPriceCents}
                blendAlpha={PRICING_BLEND_ALPHA}
                totalContentScore={totalContentScore}
                cardsWithMarket={cardsWithMarket}
                cardCount={product._count.cards}
                lastMarketRefreshAt={product.lastMarketRefreshAt?.toISOString() ?? null}
                algorithm={algorithm}
                teamBreakdownRows={teamBreakdown.rows}
                playerBreakdownRows={playerBreakdown.rows}
                cards={product.cards.map((c) => ({
                  team: c.team,
                  playerName: c.playerName,
                  cardNumber: c.cardNumber,
                  variation: c.variation,
                  marketValueCents: c.marketValueCents,
                }))}
                chaseCards={product.cards.map((c) => ({
                  playerName: c.playerName,
                  team: c.team,
                  cardNumber: c.cardNumber,
                  variation: c.variation,
                  ungradedCents: c.ungradedCents,
                  psa10Cents: c.psa10Cents,
                  psa9Cents: c.psa9Cents,
                  printRun: c.printRun,
                  imageUrl: c.imageUrl,
                  popG10: c.popG10,
                  popTotal: c.popTotal,
                }))}
              />
            </section>
          )}

          {/* Checklist import lives at the bottom — once the product is
              loaded, this is rarely interacted with, so it shouldn't dominate
              the top of the page. Collapsed by default. */}
          <details className="rounded-2xl border border-slate-200 bg-white">
            <summary className="cursor-pointer px-5 py-3 text-[11px] font-bold uppercase tracking-tight-2 text-slate-500 hover:text-ink">
              Checklist · {product._count.cards} cards · re-import or replace
            </summary>
            <div className="border-t border-slate-200 p-5">
              <ChecklistUpload
                productId={product.id}
                hasExistingCards={product._count.cards > 0}
              />
            </div>
          </details>
        </>
      )}
    </div>
  );
}

/**
 * Placeholder shown when a product has no cards on its checklist yet —
 * either we couldn't find an xlsx on Beckett (product not yet released),
 * or it's a manually-created product the user hasn't loaded yet.
 *
 * Keeps the checklist import UI accessible below the banner so the user can
 * retry once Beckett (or another source) publishes the data.
 */
function ComingSoon({ productId }: { productId: string }) {
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border-2 border-dashed border-slate-300 bg-white p-12 text-center">
        <div className="text-[11px] font-bold uppercase tracking-tight-2 text-accent">
          Status
        </div>
        <div className="mt-2 text-3xl font-extrabold tracking-tight-3">
          CHECKLIST COMING SOON
        </div>
        <p className="mx-auto mt-3 max-w-md text-sm text-slate-500">
          We couldn't find a published checklist for this product yet. Beckett
          and other sources usually post the full <code>.xlsx</code> closer to
          release date. Try again later, or paste a URL below if you've found
          one elsewhere.
        </p>
      </div>
      <details className="rounded-2xl border border-slate-200 bg-white">
        <summary className="cursor-pointer px-5 py-3 text-[11px] font-bold uppercase tracking-tight-2 text-slate-500">
          Have a checklist URL? Import it now
        </summary>
        <div className="border-t border-slate-200 p-5">
          <ChecklistUpload productId={productId} hasExistingCards={false} />
        </div>
      </details>
    </div>
  );
}

