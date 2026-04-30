import Link from "next/link";
import { prisma } from "@/lib/prisma";
import NewMixerForm from "./NewMixerForm";

export const dynamic = "force-dynamic";

export default async function NewMixerPage() {
  const products = await prisma.product.findMany({
    orderBy: [{ releaseDate: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      sport: true,
      manufacturer: true,
      releaseDate: true,
      _count: { select: { cards: true } },
    },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link
          href="/"
          className="text-[11px] font-bold uppercase tracking-tight-2 text-slate-500 hover:text-ink"
        >
          ← All products
        </Link>
        <div className="mt-2 text-[11px] font-bold uppercase tracking-tight-2 text-accent">
          Multi-Product Break
        </div>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight-3">
          New Mixer
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Combine 2+ products into one break — buyers pick a team and get every
          card from that team across all included products. One shared box
          price.
        </p>
      </div>
      <NewMixerForm products={products} />
    </div>
  );
}
