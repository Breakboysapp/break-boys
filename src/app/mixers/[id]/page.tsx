import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  computeBreakdown,
  summarizeAlgorithmFor,
} from "@/lib/scoring";
import TeamBreakdownSheet from "@/app/products/[id]/TeamBreakdownSheet";
import DeleteMixerButton from "./DeleteMixerButton";

export const dynamic = "force-dynamic";

export default async function MixerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const mixer = await prisma.mixer.findUnique({
    where: { id },
    include: {
      products: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              sport: true,
              manufacturer: true,
              releaseDate: true,
              _count: { select: { cards: true } },
            },
          },
        },
      },
    },
  });
  if (!mixer) notFound();

  // Pull all cards across every product in the mixer. The score card and
  // team breakdown treat them as one unified set.
  const productIds = mixer.products.map((p) => p.productId);
  const cards = productIds.length
    ? await prisma.card.findMany({
        where: { productId: { in: productIds } },
        select: {
          team: true,
          playerName: true,
          cardNumber: true,
          variation: true,
          marketValueCents: true,
        },
      })
    : [];

  const algorithm = summarizeAlgorithmFor(cards);
  const teamBreakdown = computeBreakdown(cards, "team");
  const playerBreakdown = computeBreakdown(cards, "playerName");

  // Sports represented — used to stamp the header (mostly all from one sport
  // but mixers across sports are technically possible).
  const sports = Array.from(new Set(mixer.products.map((p) => p.product.sport)));

  return (
    <div className="space-y-10">
      {/* Hero */}
      <div className="relative rounded-2xl border border-slate-200 bg-white p-5 sm:p-8">
        <div className="absolute right-4 top-4 sm:right-6 sm:top-6">
          <DeleteMixerButton mixerId={mixer.id} />
        </div>
        <Link
          href="/mixers"
          className="text-[11px] font-bold uppercase tracking-tight-2 text-slate-500 hover:text-ink"
        >
          ← All mixers
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-bold uppercase tracking-tight-2 text-accent">
          <span>Mixer</span>
          {mixer.breakerHandle && (
            <>
              <span aria-hidden className="text-slate-400">
                ·
              </span>
              <span>@{mixer.breakerHandle}</span>
            </>
          )}
          {sports.map((s) => (
            <span key={s}>
              <span aria-hidden className="text-slate-400">
                ·
              </span>{" "}
              {s}
            </span>
          ))}
        </div>
        <h1 className="mt-1 text-2xl font-extrabold leading-tight tracking-tight-3 sm:text-4xl">
          {mixer.name}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
          <span>
            {mixer.products.length}{" "}
            {mixer.products.length === 1 ? "product" : "products"}
          </span>
          <span>
            {cards.length} {cards.length === 1 ? "card" : "cards"} combined
          </span>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {mixer.products.map((mp) => (
            <Link
              key={mp.productId}
              href={`/products/${mp.productId}`}
              className="rounded-md border border-slate-200 bg-bone px-3 py-1.5 text-[11px] font-semibold tracking-tight-2 text-slate-700 hover:border-ink hover:text-ink"
            >
              {mp.product.name}
              <span className="ml-1.5 text-slate-400">
                {mp.product._count.cards}
              </span>
            </Link>
          ))}
        </div>

        {cards.length > 0 && (
          <div className="mt-6">
            <Link
              href={`/mixers/${mixer.id}/break`}
              className="block w-full rounded-md bg-ink px-5 py-3 text-center text-sm font-bold uppercase tracking-tight-2 text-white hover:opacity-90 sm:inline-block sm:w-auto"
            >
              Start the mixer break →
            </Link>
          </div>
        )}
      </div>

      {cards.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500">
          No cards across the included products yet — they're either
          "Coming Soon" (no checklist) or empty.
        </div>
      ) : (
        <TeamBreakdownSheet
          buckets={algorithm}
          teamRows={teamBreakdown.rows}
          playerRows={playerBreakdown.rows}
          cards={cards.map((c) => ({
            team: c.team,
            playerName: c.playerName,
            cardNumber: c.cardNumber,
            variation: c.variation,
            marketValueCents: c.marketValueCents,
          }))}
        />
      )}
    </div>
  );
}
