import Link from "next/link";
import { prisma } from "@/lib/prisma";
import MixerListItem from "./MixerListItem";

export const dynamic = "force-dynamic";

export default async function MixersPage() {
  const mixers = await prisma.mixer.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      products: {
        include: {
          product: {
            select: { name: true, _count: { select: { cards: true } } },
          },
        },
      },
    },
  });

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-tight-2 text-accent">
            Multi-Product Breaks
          </div>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight-3 sm:text-4xl">
            Mixers
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {mixers.length === 0
              ? "Combine multiple products into one break — buyers pick a team and pull cards from every product at once."
              : `${mixers.length} ${mixers.length === 1 ? "mixer" : "mixers"}`}
          </p>
        </div>
        <Link
          href="/mixers/new"
          className="rounded-md bg-ink px-5 py-3 text-xs font-bold uppercase tracking-tight-2 text-white hover:opacity-90 sm:text-sm"
        >
          + New Mixer
        </Link>
      </div>

      {mixers.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-slate-300 bg-white p-12 text-center">
          <p className="text-base font-semibold text-slate-600">
            No mixers yet.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Pick 2+ products and combine them into one break session.
          </p>
          <Link
            href="/mixers/new"
            className="mt-4 inline-block text-sm font-semibold text-accent hover:underline"
          >
            Create your first mixer →
          </Link>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {mixers.map((m) => {
            const totalCards = m.products.reduce(
              (s, p) => s + p.product._count.cards,
              0,
            );
            return (
              <MixerListItem
                key={m.id}
                id={m.id}
                name={m.name}
                breakerHandle={m.breakerHandle}
                productCount={m.products.length}
                totalCards={totalCards}
                productNames={m.products.map((p) => p.product.name)}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}
