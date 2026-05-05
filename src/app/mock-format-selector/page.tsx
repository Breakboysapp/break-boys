/**
 * MOCK PAGE — box-format selector design candidates.
 *
 * Four directions stacked top-to-bottom for direct comparison.
 * Sample data is real (from 2025 Bowman Draft Baseball, which has
 * all 5 formats: Hobby / Jumbo / Super Jumbo / Mega Box / Breaker
 * Delight) so the wrapping / density of each layout is honest.
 *
 * Once a direction is picked the chosen variant becomes the new
 * ProductFormatsBar implementation; this entire route is deleted.
 */
import { prisma } from "@/lib/prisma";
import OptionA from "./OptionA";
import OptionB from "./OptionB";
import OptionC from "./OptionC";
import OptionD from "./OptionD";

export const dynamic = "force-dynamic";

export default async function MockFormatSelectorPage() {
  const product = await prisma.product.findFirst({
    where: { name: "2025 Bowman Draft Baseball" },
    include: {
      formats: {
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      },
    },
  });
  const formats = (product?.formats ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    packsPerBox: f.packsPerBox,
    cardsPerPack: f.cardsPerPack,
    autosPerBox: f.autosPerBox,
    notes: f.notes,
  }));

  return (
    <div className="space-y-12">
      <header>
        <div className="text-[11px] font-bold uppercase tracking-tight-2 text-accent">
          Mock — Pick One
        </div>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight-3 sm:text-3xl">
          Box-format selector variants
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Four candidates for the format picker on the product page.
          Sample data is from{" "}
          <span className="font-semibold text-ink">
            {product?.name ?? "(no product)"}
          </span>{" "}
          ({formats.length} formats). Click into each option to feel
          the interaction. Tell me a letter and I&apos;ll wire it in
          and delete this route.
        </p>
      </header>

      {formats.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500">
          No formats found on the seed product. Run{" "}
          <code className="text-ink">
            scripts/seed-all-product-formats.ts --apply
          </code>{" "}
          and refresh.
        </div>
      ) : (
        <>
          <section className="space-y-3">
            <Caption
              letter="A"
              title="Pill row + details strip"
              notes="Same chip pattern as Active / Coming Soon tabs already on the home page. Active pill is filled black; others are outline. Stats + notes for the selected format land below. Wraps to a second line on narrow screens for products with many formats."
            />
            <OptionA formats={formats} />
          </section>

          <section className="space-y-3">
            <Caption
              letter="B"
              title="Tab strip with red underline"
              notes="Each format is a tab; active tab gets a thick red underline (matches the SCORE / VALUE active-sort highlight on the score card). Horizontally scrolls on mobile if there are too many tabs to fit on one line."
            />
            <OptionB formats={formats} />
          </section>

          <section className="space-y-3">
            <Caption
              letter="C"
              title="Inline mini cards (no separate details panel)"
              notes="Each format is its own small card with name + stats baked in. Active card has a red border. No separate stats/notes section — everything's in the cards. Most info-dense; takes the most vertical space when there are many formats."
            />
            <OptionC formats={formats} />
          </section>

          <section className="space-y-3">
            <Caption
              letter="D"
              title="Custom dropdown trigger (not native select)"
              notes="Single black button shows current format + caret. Click expands a styled menu (matches the existing Sort / Year / Manufacturer dropdowns). Most compact when collapsed; familiar interaction from the rest of the app."
            />
            <OptionD formats={formats} />
          </section>
        </>
      )}

      <footer className="rounded-2xl border-2 border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
        <p>
          Tell me a letter (A / B / C / D) and I&apos;ll wire that
          variant into ProductFormatsBar and delete this mock route.
        </p>
      </footer>
    </div>
  );
}

function Caption({
  letter,
  title,
  notes,
}: {
  letter: string;
  title: string;
  notes: string;
}) {
  return (
    <div className="border-l-4 border-accent pl-4">
      <div className="flex items-baseline gap-2 text-[11px] font-bold uppercase tracking-tight-2">
        <span className="rounded bg-accent px-1.5 py-0.5 text-white">
          Option {letter}
        </span>
        <span className="text-ink">{title}</span>
      </div>
      <p className="mt-1 max-w-2xl text-xs text-slate-500">{notes}</p>
    </div>
  );
}
