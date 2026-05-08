import Link from "next/link";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * /hot — sport picker for the trending players index. Each card
 * leads to /hot/<sport> which shows that sport's hottest movers
 * across every product, sourced from Card Hedger sales-stats.
 *
 * The list of sports comes from whatever's actually in the DB —
 * no hard-coding — so MLB / NBA / NFL / NHL / Golf / Soccer /
 * Racing / TCG all show up automatically when products exist.
 */
export default async function HotIndexPage() {
  const sports = await prisma.product.groupBy({
    by: ["sport"],
    _count: { _all: true },
    orderBy: { _count: { sport: "desc" } },
  });

  const SPORT_PATH: Record<string, string> = {
    MLB: "baseball",
    NBA: "basketball",
    NFL: "football",
    NHL: "hockey",
  };
  const SPORT_EMOJI: Record<string, string> = {
    MLB: "⚾",
    NBA: "🏀",
    NFL: "🏈",
    NHL: "🏒",
    Golf: "⛳",
    Soccer: "⚽",
    Racing: "🏎️",
    TCG: "🎴",
  };
  const SPORT_LABEL: Record<string, string> = {
    MLB: "Baseball",
    NBA: "Basketball",
    NFL: "Football",
    NHL: "Hockey",
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-8">
        <div className="text-[10px] font-bold uppercase tracking-tight-2 text-accent">
          Trending
        </div>
        <h1 className="mt-1 text-2xl font-extrabold leading-tight tracking-tight-3 sm:text-4xl">
          🔥 Who&apos;s On Fire
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-500">
          Players whose card sales spiked vs the prior 3-week
          baseline. Pick a sport.
        </p>
      </div>

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {sports.map((s) => {
          const path = SPORT_PATH[s.sport] ?? s.sport.toLowerCase();
          const emoji = SPORT_EMOJI[s.sport] ?? "🃏";
          return (
            <li key={s.sport}>
              <Link
                href={`/hot/${path}`}
                className="block rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-ink hover:shadow-md"
              >
                <div className="text-3xl leading-none">{emoji}</div>
                <div className="mt-2 text-base font-extrabold tracking-tight-3">
                  {SPORT_LABEL[s.sport] ?? s.sport}
                </div>
                <div className="mt-0.5 text-[10px] font-medium uppercase tracking-tight-2 text-slate-400">
                  {s._count._all} {s._count._all === 1 ? "product" : "products"}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
