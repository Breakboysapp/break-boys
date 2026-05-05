/**
 * MOCK PAGE — sport-quick-jump button variants for visual review.
 *
 * Four candidate designs stacked top-to-bottom so the user can compare
 * and pick one. Once a direction is chosen, the chosen variant moves
 * into src/app/page.tsx (just below the "Full Catalog" header) and
 * this entire route is deleted.
 *
 * Each option's section labels itself + has a brief note so the
 * tradeoffs are visible alongside the visuals.
 *
 * Buttons are real links — tap any to filter the home page by that
 * sport, so you can sanity-check the landing experience too.
 */
import Link from "next/link";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const SPORTS = [
  { sport: "NFL", abbr: "NFL", label: "Football" },
  { sport: "NBA", abbr: "NBA", label: "Basketball" },
  { sport: "MLB", abbr: "MLB", label: "Baseball" },
] as const;

export default async function MockSportButtonsPage() {
  // Real product counts so the buttons feel grounded.
  const counts = await prisma.product.groupBy({
    by: ["sport"],
    _count: { _all: true },
  });
  const countBySport = new Map(counts.map((c) => [c.sport, c._count._all]));

  return (
    <div className="space-y-12">
      <header>
        <div className="text-[11px] font-bold uppercase tracking-tight-2 text-accent">
          Mock — Pick One
        </div>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight-3 sm:text-3xl">
          Sport quick-jump button variants
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Four candidates for the new sport buttons that will sit below
          the &quot;Full Catalog&quot; header on the home page. Pick the
          one (or hybrid) you want and I&apos;ll wire it into the home
          page and delete this route.
        </p>
      </header>

      {/* Option A: Loud sport colors */}
      <section className="space-y-3">
        <Caption
          letter="A"
          title="Loud sport colors"
          notes="Maximum visual variation. Each sport gets its real-world signature color (NFL green, NBA orange, MLB navy). Instantly recognizable but breaks the all-red-and-black brand palette."
        />
        <div className="grid gap-3 sm:grid-cols-3">
          {SPORTS.map((s) => (
            <Link
              key={`A-${s.sport}`}
              href={`/?sport=${encodeURIComponent(s.sport)}`}
              className={`group flex h-32 flex-col justify-between rounded-2xl p-5 text-white transition hover:-translate-y-0.5 hover:shadow-xl ${
                s.sport === "NFL"
                  ? "bg-emerald-600 hover:bg-emerald-500"
                  : s.sport === "NBA"
                    ? "bg-orange-500 hover:bg-orange-400"
                    : "bg-blue-700 hover:bg-blue-600"
              }`}
            >
              <div className="flex items-baseline justify-between">
                <span className="text-3xl font-black tracking-tight-3">
                  {s.abbr}
                </span>
                <span className="text-[11px] font-bold uppercase tracking-tight-2 opacity-80">
                  {countBySport.get(s.sport) ?? 0} products
                </span>
              </div>
              <div className="text-sm font-bold uppercase tracking-tight-2">
                Break {s.sport} Products
                <span aria-hidden className="ml-1 transition group-hover:translate-x-1 inline-block">
                  →
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Option B: Minimalist dark cards */}
      <section className="space-y-3">
        <Caption
          letter="B"
          title="Minimalist brand-consistent (dark + red accent)"
          notes="All three cards same dark style. Just sport name differentiates. Cleanest, most on-brand, but doesn't add the visual variation you mentioned."
        />
        <div className="grid gap-3 sm:grid-cols-3">
          {SPORTS.map((s) => (
            <Link
              key={`B-${s.sport}`}
              href={`/?sport=${encodeURIComponent(s.sport)}`}
              className="group relative flex h-32 flex-col justify-between overflow-hidden rounded-2xl border border-white/10 bg-ink p-5 text-white transition hover:-translate-y-0.5 hover:border-accent hover:shadow-xl"
            >
              {/* Red diagonal stripe — brand accent */}
              <div
                aria-hidden
                className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rotate-45 bg-accent opacity-90"
              />
              <div className="relative flex items-baseline justify-between">
                <span className="text-3xl font-black tracking-tight-3">
                  {s.abbr}
                </span>
                <span className="text-[11px] font-bold uppercase tracking-tight-2 text-white/60">
                  {countBySport.get(s.sport) ?? 0}
                </span>
              </div>
              <div className="relative text-sm font-bold uppercase tracking-tight-2">
                Break {s.sport} Products
                <span aria-hidden className="ml-1 inline-block text-accent transition group-hover:translate-x-1">
                  →
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Option C: Subtle sport iconography */}
      <section className="space-y-3">
        <Caption
          letter="C"
          title="Subtle sport iconography"
          notes="Light/cream cards with a faint sport-themed SVG pattern (football laces, basketball lines, baseball stitches). Information-forward, less colorful, doesn't fight your existing palette."
        />
        <div className="grid gap-3 sm:grid-cols-3">
          {SPORTS.map((s) => (
            <Link
              key={`C-${s.sport}`}
              href={`/?sport=${encodeURIComponent(s.sport)}`}
              className="group relative flex h-32 flex-col justify-between overflow-hidden rounded-2xl border border-slate-200 bg-bone p-5 text-ink transition hover:-translate-y-0.5 hover:border-ink hover:shadow-xl"
            >
              {/* Faint sport-themed SVG decoration in the corner */}
              <div
                aria-hidden
                className="pointer-events-none absolute -right-6 -top-6 h-32 w-32 text-slate-200 opacity-80"
              >
                {s.sport === "NFL" && (
                  <svg viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="2">
                    <ellipse cx="50" cy="50" rx="38" ry="22" transform="rotate(-25 50 50)" />
                    <line x1="40" y1="42" x2="60" y2="58" />
                    <line x1="38" y1="48" x2="46" y2="52" />
                    <line x1="48" y1="46" x2="56" y2="54" />
                    <line x1="54" y1="50" x2="62" y2="56" />
                  </svg>
                )}
                {s.sport === "NBA" && (
                  <svg viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="50" cy="50" r="34" />
                    <path d="M16 50 H 84" />
                    <path d="M50 16 V 84" />
                    <path d="M22 30 Q 50 50, 22 70" />
                    <path d="M78 30 Q 50 50, 78 70" />
                  </svg>
                )}
                {s.sport === "MLB" && (
                  <svg viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="50" cy="50" r="34" />
                    <path d="M22 30 Q 50 50, 22 70" strokeDasharray="3 3" />
                    <path d="M78 30 Q 50 50, 78 70" strokeDasharray="3 3" />
                  </svg>
                )}
              </div>
              <div className="relative flex items-baseline justify-between">
                <span className="text-3xl font-black tracking-tight-3">
                  {s.abbr}
                </span>
                <span className="text-[11px] font-bold uppercase tracking-tight-2 text-slate-500">
                  {countBySport.get(s.sport) ?? 0} products
                </span>
              </div>
              <div className="relative text-sm font-bold uppercase tracking-tight-2 text-slate-700 group-hover:text-accent">
                Break {s.label}
                <span aria-hidden className="ml-1 inline-block transition group-hover:translate-x-1">
                  →
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Option D: Premium gradient (Fanatics-style) */}
      <section className="space-y-3">
        <Caption
          letter="D"
          title="Premium sport gradient"
          notes="Each card uses a sport color fading into black. Atmospheric, the most 'app-store-screenshot' look. Splits the difference between A's loudness and B's restraint."
        />
        <div className="grid gap-3 sm:grid-cols-3">
          {SPORTS.map((s) => (
            <Link
              key={`D-${s.sport}`}
              href={`/?sport=${encodeURIComponent(s.sport)}`}
              className={`group relative flex h-32 flex-col justify-between overflow-hidden rounded-2xl border border-white/10 p-5 text-white transition hover:-translate-y-0.5 hover:border-white/30 hover:shadow-xl ${
                s.sport === "NFL"
                  ? "bg-gradient-to-br from-emerald-700 via-emerald-900 to-ink"
                  : s.sport === "NBA"
                    ? "bg-gradient-to-br from-orange-500 via-orange-800 to-ink"
                    : "bg-gradient-to-br from-blue-600 via-blue-900 to-ink"
              }`}
            >
              {/* Subtle radial gloss for depth */}
              <div
                aria-hidden
                className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl"
              />
              <div className="relative flex items-baseline justify-between">
                <span className="text-3xl font-black tracking-tight-3">
                  {s.abbr}
                </span>
                <span className="text-[11px] font-bold uppercase tracking-tight-2 opacity-80">
                  {countBySport.get(s.sport) ?? 0} products
                </span>
              </div>
              <div className="relative text-sm font-bold uppercase tracking-tight-2">
                Break {s.sport} Products
                <span aria-hidden className="ml-1 transition group-hover:translate-x-1 inline-block">
                  →
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Option E: Loud sport colors WITH prominent icons */}
      <section className="space-y-3">
        <Caption
          letter="E"
          title="Loud sport colors + prominent icon"
          notes="Same loud color palette as Option A, but with a big sport-themed SVG (football, basketball, baseball) anchored to the right side of each card. The icon dominates the visual; the sport name and CTA sit beside it."
        />
        <div className="grid gap-3 sm:grid-cols-3">
          {SPORTS.map((s) => (
            <Link
              key={`E-${s.sport}`}
              href={`/?sport=${encodeURIComponent(s.sport)}`}
              className={`group relative flex h-36 items-center gap-4 overflow-hidden rounded-2xl p-5 text-white transition hover:-translate-y-0.5 hover:shadow-xl ${
                s.sport === "NFL"
                  ? "bg-emerald-600 hover:bg-emerald-500"
                  : s.sport === "NBA"
                    ? "bg-orange-500 hover:bg-orange-400"
                    : "bg-blue-700 hover:bg-blue-600"
              }`}
            >
              <div className="relative z-10 flex min-w-0 flex-1 flex-col justify-between self-stretch">
                <span className="text-[11px] font-bold uppercase tracking-tight-2 opacity-80">
                  {countBySport.get(s.sport) ?? 0} products
                </span>
                <div>
                  <div className="text-3xl font-black leading-none tracking-tight-3">
                    {s.abbr}
                  </div>
                  <div className="mt-2 text-xs font-bold uppercase tracking-tight-2">
                    Break {s.sport} Products
                    <span aria-hidden className="ml-1 inline-block transition group-hover:translate-x-1">
                      →
                    </span>
                  </div>
                </div>
              </div>
              {/* Big sport icon, anchored right. Slight oversize + clip
                  so the icon feels like it's pushing out of the card. */}
              <div
                aria-hidden
                className="pointer-events-none absolute -right-4 top-1/2 h-32 w-32 -translate-y-1/2 text-white/25 transition group-hover:text-white/35"
              >
                {s.sport === "NFL" && (
                  <svg viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="3">
                    <ellipse cx="50" cy="50" rx="40" ry="24" transform="rotate(-25 50 50)" />
                    <line x1="38" y1="42" x2="62" y2="58" />
                    <line x1="34" y1="48" x2="44" y2="52" />
                    <line x1="46" y1="46" x2="54" y2="54" />
                    <line x1="56" y1="50" x2="66" y2="56" />
                  </svg>
                )}
                {s.sport === "NBA" && (
                  <svg viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="3">
                    <circle cx="50" cy="50" r="38" />
                    <path d="M12 50 H 88" />
                    <path d="M50 12 V 88" />
                    <path d="M22 28 Q 50 50, 22 72" />
                    <path d="M78 28 Q 50 50, 78 72" />
                  </svg>
                )}
                {s.sport === "MLB" && (
                  <svg viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="3">
                    <circle cx="50" cy="50" r="38" />
                    <path d="M22 28 Q 50 50, 22 72" strokeDasharray="4 3" />
                    <path d="M78 28 Q 50 50, 78 72" strokeDasharray="4 3" />
                  </svg>
                )}
              </div>
            </Link>
          ))}
        </div>
      </section>

      <footer className="rounded-2xl border-2 border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
        <p>
          Tell me which letter (or hybrid — e.g. &quot;A but with B&apos;s
          card height&quot;) you want and I&apos;ll wire it into the home
          page and delete this route.
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
