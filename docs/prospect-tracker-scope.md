# Prospect Tracker — Scope

## TL;DR

A standalone analytical product — **prospects.breakboys.app**, freemium with a paid tier — that ranks MLB prospects by a **Sleeper Score**: high on-field quality + low card market value. Surfaces guys raking in AA whose Bowman Chrome auto is still $8.

- **Repo:** convert `Breaking app` to a pnpm/Turborepo monorepo; add `apps/prospects` alongside `apps/break-boys`. Share Prisma schema + MLB Stats API adapter + auth lib as workspace packages.
- **Deploy:** subdomain `prospects.breakboys.app`, same Vercel team, same Neon DB.
- **Auth/billing:** Clerk + Stripe Subscriptions.
- **Pricing model:** freemium. Top 10 of the Sleeper Index + 1 player detail/day free; full index, unlimited details, watchlist, alerts behind paywall.
- **v1 estimate:** ~14–15 working days.

## Why this is a separate product (and a separate audience)

| Break Boys today | Prospect Tracker |
|---|---|
| Buyers / break-room customers picking team slots | Analytical hobby buyers picking sleeper prospects |
| Decision: "is this team worth $40?" | Decision: "is this rookie auto a buy at $12?" |
| Inputs: checklist + team prices | Inputs: MiLB performance + card market |
| Free, single-user, stub auth | Paid SaaS, multi-user, real auth |
| Lives at `breakboys.app` | Lives at `prospects.breakboys.app` |

The two share *data* (PC prices, pop counts, card market) but their UX, audience, and pricing structure diverge enough that bolting Prospect Tracker into Break Boys as a nested view would compromise both.

## The headline metric: Sleeper Score

```
SleeperScore = ProspectQualityIndex  /  MarketValueIndex
```

| Quality | Market | Sleeper Score | Read |
|---|---|---|---|
| 80 (raking) | 20 (no market yet) | **4.0** | High — buy now |
| 60 (solid) | 90 (Sasaki tier) | 0.67 | Low — market knows |
| 40 (meh) | 10 (anonymous) | 4.0 | Trap — not actually good |
| 80 (raking) | 80 (top 10 ranked) | 1.0 | Fair value |

Filter the index to `Quality ≥ 50` by default so it surfaces "good prospects with cheap cards" rather than "cheap cards from non-prospects."

### ProspectQualityIndex (0–100)

| Component | Weight | Source |
|---|---|---|
| Age-adjusted MiLB performance | 50% | MLB Stats API — wRC+ for hitters, FIP- for pitchers, normalized within level + age cohort |
| Level reached | 20% | Highest level played this season — Rookie 1, A 2, A+ 3, AA 5, AAA 8 (exponential — reaching AA is a real filter) |
| Pedigree | 15% | Draft round (top-3 round = 100, undrafted = 0) OR international bonus tier OR Top 100 ranking if present |
| Recent trend | 15% | Last-30-game wRC+ / FIP- vs season — captures hot streaks the market hasn't priced in |

Pitchers and hitters use parallel scoring (FIP- replaces wRC+, K-BB% replaces walk rate). Two-way players: take the max.

### MarketValueIndex (0–100)

```
MarketValueIndex = normalize( log(top_card_psa10 + 1) × 0.6
                            + log(median_priced_card + 1) × 0.4 )
```

Direct port of the existing `marketScore` math from [`src/lib/chase-rollup.ts`](../src/lib/chase-rollup.ts), normalized across the prospect universe so the top-priced prospect = 100.

## Three flavors of sleeper

| View | Filter | What it catches |
|---|---|---|
| 💎 **Pure Sleeper** | Quality ≥ 50, Market ≤ 30, no trending spike | Genuinely under-the-radar — the buy-low list |
| 📈 **Quiet Riser** | Quality ≥ 60, Market ≤ 50, mild spike (1.5–3×) | Early movers — market starting to notice |
| ⚡ **Hot Mover** | Quality ≥ 50, recent spike ≥ 3× | Defensive list — "did I miss it?" |

Tabs on `/` switch between them. Default: 💎 Pure Sleeper.

## Architecture: monorepo + shared workspace packages

```
breakboys-monorepo/
  apps/
    break-boys/         ← current Next app, moved here
    prospects/          ← new Next app, prospects.breakboys.app
  packages/
    db/                 ← Prisma schema + generated client (single source of truth)
    stats-mlb/          ← MLB Stats API adapter (used by prospects cron)
    pricing-pc/         ← PriceCharting adapter (already exists; lift out of break-boys)
    auth/               ← Clerk-wrapped helpers (only prospects uses today)
    ui/                 ← Shared Tailwind tokens, design primitives if we want symmetry
  prisma/
    schema.prisma       ← lives in packages/db, both apps import @breakboys/db
  package.json          ← pnpm workspaces root
  turbo.json            ← Turborepo pipeline
```

Both apps deploy as separate Vercel projects pointing at the same monorepo, with `Root Directory` set per project (`apps/break-boys` and `apps/prospects`). Both use the same `DATABASE_URL` (existing Neon). New tables (MilbPlayer, MilbStatLine, Subscription) added to the shared Prisma schema; both apps generate types from the same `@breakboys/db` package.

**Migration plan for the monorepo conversion:**
1. Create `packages/db` skeleton, move `prisma/` into it, expose `@breakboys/db` export of `prisma` client.
2. Move `src/lib/sources/pricing/` into `packages/pricing-pc`.
3. Move `src/` into `apps/break-boys/src/`. Update imports.
4. Verify Break Boys still builds + deploys against the new layout (this is a no-functional-change refactor — should ship as one PR).
5. *Then* start building `apps/prospects` against those packages.

Pre-work for steps 1–4 is roughly **1.5 days**. The rest of the timeline below assumes that's done.

## Auth + billing (Clerk + Stripe)

- **Clerk** handles login, social auth, password reset, and exposes a `useUser()` hook. Hosted UI for sign-up means we don't build forms.
- **Stripe Subscriptions** for the paid tier. One product, one $X/mo price. Webhook → `Subscription` table → middleware checks `user.subscription.status === 'active'` to gate paid routes.

```prisma
// packages/db/schema.prisma — additions
model User {
  id           String   @id @default(cuid())
  clerkId      String   @unique
  email        String   @unique
  createdAt    DateTime @default(now())
  subscription Subscription?
  watchlist    WatchlistEntry[]
  dailyUsage   DailyUsage[]
}

model Subscription {
  id                    String   @id @default(cuid())
  userId                String   @unique
  stripeCustomerId      String   @unique
  stripeSubscriptionId  String   @unique
  status                String   // 'active' | 'trialing' | 'past_due' | 'canceled'
  currentPeriodEnd      DateTime
  user                  User     @relation(fields: [userId], references: [id])
}

model WatchlistEntry {
  id             String   @id @default(cuid())
  userId         String
  playerSlug     String
  createdAt      DateTime @default(now())
  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([userId, playerSlug])
}

model DailyUsage {
  id           String   @id @default(cuid())
  userId       String
  date         DateTime @db.Date                  // YYYY-MM-DD bucket
  detailViews  Int      @default(0)
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([userId, date])
}
```

`DailyUsage` is the freemium meter: free tier gets 1 detail page/day, paid users skip the check.

## Freemium gating

| Surface | Free | Paid |
|---|---|---|
| Home / `Sleeper Index` table | Top 10 rows visible, rest blurred with "Unlock 100+ more →" CTA | Full table, all filters work |
| Player detail page | 1 per day, then paywall card replaces detail content | Unlimited |
| Hot Mover / Quiet Riser tabs | Locked (paywall pill on tab) | Unlocked |
| Watchlist | — | Yes |
| Stat history beyond current season | — | Yes |
| Email alerts on watchlist spikes | — | Yes |
| Public landing + pricing page | Yes | Yes |

Free tier gives enough surface for SEO + viral sharing ("hey check out this Sleeper Index on prospects.breakboys.app"). Paywall converts engaged users.

## Where the existing building blocks help

| Already in `Breaking app` | Reuse for prospects |
|---|---|
| `isProspectCard()` in [`src/lib/scoring.ts`](../src/lib/scoring.ts) | Bowman prospect universe definition |
| `playerProspectMap` rollup in [`src/app/products/[id]/page.tsx`](../src/app/products/%5Bid%5D/page.tsx) | Lift to cross-product version |
| `normalizeKey()` in [`src/lib/player-name-normalize.ts`](../src/lib/player-name-normalize.ts) | Joining MiLB stats by name |
| `getCrossProductPricedCards()` in [`src/lib/cached-queries.ts`](../src/lib/cached-queries.ts) | Per-prospect card market |
| `log(top) × 0.6 + log(median) × 0.4` in [`src/lib/chase-rollup.ts`](../src/lib/chase-rollup.ts) | MarketValueIndex math |
| `PlayerTrendingSnapshot` + [`refresh-trending`](../src/app/api/cron/refresh-trending/route.ts) | Spike detection for tab classification |
| `unstable_cache` + `reviveDates()` + `revalidateTag` pattern in [`src/lib/cached-queries.ts`](../src/lib/cached-queries.ts) | Apply identically in `apps/prospects` |

These all live in `apps/break-boys/src/lib/...` post-refactor. Anything reused cross-app moves into a workspace package; everything else stays put and the prospects app imports from the package.

## What's not in the DB yet — MLB Stats API integration

`https://statsapi.mlb.com/api/v1/sports/<id>/stats?...`

| Sport ID | Level |
|---|---|
| 11 | AAA |
| 12 | AA |
| 13 | A+ |
| 14 | A |
| 16 | Rookie / Complex |

Free, public, no auth, no rate limit. Returns per-player season splits (AVG/OBP/SLG/K%/BB%/wOBA + counting stats for wRC+ derivation). Includes pitcher stats (IP/K/BB/H/HR → derive FIP- in app).

**New package:** `packages/stats-mlb` — fetches + parses + typed rows. Mirrors the shape of `packages/pricing-pc`.

**New tables (in `packages/db`):**
```prisma
model MilbPlayer {
  id              String   @id @default(cuid())
  mlbamId         Int      @unique          // canonical MLB Stats API ID
  fullName        String
  normalizedName  String                    // joins to Card.playerName via normalizeKey()
  birthDate       DateTime
  position        String                    // "RHP" | "OF" | etc.
  bats            String?
  throws          String?
  draftRound      Int?
  draftYear       Int?
  isActive        Boolean  @default(true)   // false once they appear on MLB roster
  stats           MilbStatLine[]
  @@index([normalizedName])
}

model MilbStatLine {
  id              String     @id @default(cuid())
  playerId        String
  season          Int
  level           String                    // "AAA" | "AA" | "A+" | "A" | "ROK"
  team            String
  capturedAt      DateTime   @default(now())
  // Hitter
  pa              Int?
  avg             Float?
  obp             Float?
  slg             Float?
  hr              Int?
  bbPct           Float?
  kPct            Float?
  wrcPlus         Int?
  // Pitcher
  ip              Float?
  era             Float?
  fipMinus        Int?
  kPer9           Float?
  bbPer9          Float?
  player          MilbPlayer @relation(fields: [playerId], references: [id], onDelete: Cascade)
  @@index([playerId, season])
}
```

**Cron:** `apps/prospects/src/app/api/cron/refresh-milb-stats/route.ts` — daily, auth pattern lifted from `apps/break-boys`'s refresh-pricecharting. Pulls every level, upserts MilbPlayer + MilbStatLine. Flips `isActive=false` for any mlbamId now appearing on a sport=1 (MLB) roster. Solves the Sasaki-is-still-listed-as-prospect problem.

## Quality score function

`packages/quality/src/index.ts` — pure function, no I/O:

```ts
computeProspectQuality({
  age: number,
  level: 'ROK' | 'A' | 'A+' | 'AA' | 'AAA',
  hitterStats?: { wrcPlus: number | null, paInSeason: number },
  pitcherStats?: { fipMinus: number | null, ipInSeason: number },
  draftRound: number | null,
  top100Rank: number | null,
  recent30dWrcPlus: number | null,
}): { score: number; components: { agePerf: number; level: number; pedigree: number; recentTrend: number } }
```

Returns 0–100 + per-component breakdown so the UI can show *why* the score is what it is. Goes in its own package so both apps could read it (and so we can unit-test it independent of Next).

## UI

### `/` index (the Sleeper Index)

```
┌─────────────────────────────────────────────────────────────────────┐
│ PROSPECTS · Sleeper Index               Sign in  ·  Upgrade ↗       │
│ Quality vs. market — guys raking in the minors whose cards          │
│ haven't moved yet.                                                  │
│                                                                     │
│ [ 💎 Pure Sleeper ] [ 📈 Quiet Riser 🔒 ] [ ⚡ Hot Mover 🔒 ]         │
│                                                                     │
│ [Search 🔍] [Level ▾ AA+] [Position ▾ All] [Quality ≥ ▾ 50]         │
│                                                                     │
│ # │ Player          │ Age/Lvl │ Quality │ Market │ Sleeper │ Why    │
│ 1 │ Bryce Eldridge  │ 21/AAA  │ 78      │ 22     │ 3.5     │ wRC+   │
│   │                  │         │         │        │         │ 162    │
│ 2 │ Sebastian Walcott│ 19/AA   │ 81      │ 28     │ 2.9     │ 19yo   │
│ 3 │ Carson Williams │ 22/AA   │ 73      │ 26     │ 2.8     │ 32 HR  │
│ … │                                                                 │
│ 10│ Termarr Johnson │ 22/AA   │ 65      │ 24     │ 2.7     │ K-BB%  │
│ ──────────────────────────────────────────────────────────────────  │
│ ▓▓▓▓▓ Unlock 100+ more → ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓            │
│ [ Start free trial ]                                                │
└─────────────────────────────────────────────────────────────────────┘
```

Free: top 10 rows + Pure Sleeper tab + filters work. Paid: full list + all 3 tabs unlocked.

Columns: Player → /player/[slug], Age/Level, Quality (tooltip: per-component breakdown), Market (tooltip: top card + median priced), Sleeper (color-coded ≥3.0 green / 1.5–3.0 neutral / <1.5 gray), Why (one-token highlight).

### `/player/[slug]` detail

Free tier: first detail/day works, subsequent same-day visits show paywall card instead.

```
┌───────────────────────────────────────────────────────────────┐
│ ← Sleeper Index                                               │
│ GIANTS · 1B                                                   │
│ Bryce Eldridge                          [ ❤ Watchlist 🔒 ]    │
│ 21 yo · AAA Sacramento · drafted 2023 r1                      │
│                                                               │
│ ┌─ Sleeper Score 3.5 ───────────────────────────────────────┐ │
│ │ Quality 78    /  Market 22                                 │ │
│ │ Age-adj perf  82  (wRC+ 162 at 21 yo in AAA)              │ │
│ │ Level         80  (AAA — the test before MLB)             │ │
│ │ Pedigree      70  (R1, 2023, #16 overall)                 │ │
│ │ Recent trend  74  (wRC+ 174 last 30)                      │ │
│ │ Market: top card 2024 Bowman Chrome BCP-50 PSA 10 $180 ·  │ │
│ │ median priced $14 · 4 priced cards in 3 products           │ │
│ └───────────────────────────────────────────────────────────┘ │
│                                                               │
│ ┌─ This season ─────────────────────────────────────────────┐ │
│ │ AAA · 78 G · 312 PA · .291/.388/.567                       │ │
│ │ 22 HR · 13.5% BB · 22.1% K · 162 wRC+                      │ │
│ │ Last 30: .315/.420/.640 · 8 HR · 174 wRC+                  │ │
│ └───────────────────────────────────────────────────────────┘ │
│                                                               │
│ ┌─ Card portfolio ──────────────────────────────────────────┐ │
│ │ Product          Card #   Variation        PSA 10    Raw  │ │
│ │ 2024 Bowman Chrm BCP-50   1st Bowman       $180      $12  │ │
│ │ 2024 Bowman Chrm BCP-50   Refractor        $42       —    │ │
│ │ …                                                          │ │
│ └───────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
```

## Critical files (touch list)

**Monorepo pre-work (one PR, no functional change to Break Boys)**
- Create `packages/db`, `packages/pricing-pc`, `packages/stats-mlb` (empty stub), `packages/quality` (empty stub), `packages/auth` (empty stub).
- Move existing `Breaking app/src/` → `apps/break-boys/src/`.
- Move `Breaking app/prisma/` → `packages/db/prisma/`.
- Wire pnpm workspaces + Turborepo.
- Re-deploy Break Boys to confirm zero regressions.

**Prospects app, new**
- `apps/prospects/src/app/page.tsx` — Sleeper Index, server-rendered.
- `apps/prospects/src/app/SleeperTable.tsx` — client component, tabs + sort + filter + search.
- `apps/prospects/src/app/player/[slug]/page.tsx` — per-prospect detail page.
- `apps/prospects/src/app/api/cron/refresh-milb-stats/route.ts` — daily ingest.
- `apps/prospects/src/app/api/stripe/webhook/route.ts` — Stripe webhook handler.
- `apps/prospects/src/middleware.ts` — Clerk middleware + paywall checks.
- `apps/prospects/src/app/pricing/page.tsx` — public pricing page.
- `apps/prospects/src/app/(marketing)/` — landing page + meta.

**Shared package additions**
- `packages/db/prisma/schema.prisma` — `MilbPlayer`, `MilbStatLine`, `User`, `Subscription`, `WatchlistEntry`, `DailyUsage`.
- `packages/stats-mlb/src/index.ts` — MLB Stats API adapter + types.
- `packages/quality/src/index.ts` — `computeProspectQuality()` pure function + tests.
- `packages/auth/src/index.ts` — Clerk wrappers + `requirePaid()` helper.

**Break Boys side, modify**
- [`src/app/api/cron/refresh-pricecharting/route.ts`](../src/app/api/cron/refresh-pricecharting/route.ts) — `revalidateTag('prospects')` after writes (cache buster for cross-app share).
- [`src/app/api/products/[id]/checklist/route.ts`](../src/app/api/products/%5Bid%5D/checklist/route.ts) — same.

## Out of scope (for v1)

1. **Prospect rankings ingest** (MLB Pipeline / FanGraphs / Baseball America Top 100). The quality score gets *most* of the way there using MiLB stats + pedigree + age/level alone. v2 paste-from-page flow (~1 day) slots in as a tiebreaker / pedigree boost.
2. **NFL / NBA / NHL prospect equivalents.** Each sport's "prospect" concept and stats sources differ. MLB only for v1.
3. **Email alerts on watchlist spikes.** Watchlist UI ships v1; alert delivery (Resend / Postmark) deferred to v1.1.
4. **Per-prospect price history chart.** Already on `/chase` per-card in Break Boys; per-prospect (portfolio-level Card-Ladder-style index) is v2.
5. **Game logs.** v1 detail shows season + last-30 splits. Game logs deferred.
6. **Two-way player handling beyond `max(hitter, pitcher)`.** Rare at MiLB; the simple max is fine.

## Open decisions

1. **Price point.** No firm number yet. Hobby SaaS comparable: Card Ladder Pro = $20/mo. Recommend $12/mo intro, $19/mo standard. Revisit after landing-page conversion testing.
2. **Free-tier daily limit.** 1 detail/day is the recommendation. Could be 3 — open to data. Easy to tune via `DailyUsage` cap constant.
3. **Trial window.** Stripe trial = 14 days, no card required, OR card required + 7 days. Recommending 14-day no-card to lower friction; we can tighten if conversion drops below ~10%.
4. **Quality floor default.** 50 — keeps the list to ~75–150 prospects across MLB, manageable. 40 surfaces more deep cuts + more noise. Revisit post-ingest.
5. **wRC+ derivation.** MLB Stats API doesn't return wRC+ directly. Two paths:
   - Compute per the FanGraphs formula (`((wOBA − lgwOBA) / wOBAscale + lgR_PA) / lgR_PA × 100`) — exact, need league-average inputs hardcoded per level.
   - Use the proxy `(player wOBA / level avg wOBA) × 100`. Rougher, off ~5%.
   - Recommending the proxy for v1; revisit if the index ranks badly.
6. **Universe definition.** Once MiLB stats are loaded we have *two* universes (Bowman-derived + MLB-Stats-API-derived). Recommend **union**, with a "Has card market?" toggle defaulted on so pure card-marketless guys still surface as sleeper candidates with "—" in the Market column.

## Verification plan

1. **Monorepo conversion regression-tests** — Break Boys deploys + every existing feature works identically post-refactor.
2. **Known true positives** — top of Pure Sleeper list contains 1–2 names with sub-$30 Bowman Chrome autos that the hobby has been quietly buzzing about (Latin American risers, mid-season pop-up bats).
3. **Known false positives filtered out** — Sasaki / Eldridge / Walcott tier (high quality + high market) sits *low* on Pure Sleeper, not high.
4. **Quality math** — manually compute one prospect's score, compare to the page.
5. **Graduation** — pick a 2025 rookie now on an MLB roster (Skenes); after the next stats cron, his `isActive=false` and he disappears from `/`.
6. **Paywall gating** — free user can see top 10 only; 11th row blurs; tab switch shows lock pill.
7. **Daily detail-view limit** — free user visits 2 detail pages → second one shows paywall.
8. **Stripe webhook end-to-end** — test subscription via Stripe test mode; user gets paid status within 5 seconds of checkout completion.
9. **Cache invalidation cross-app** — new Bowman checklist imported on Break Boys → `/` on prospects reflects new universe within seconds.

## Estimated time

| Layer | Days |
|---|---|
| Monorepo conversion + zero-regression deploy of Break Boys | 1.5 |
| `packages/db` schema additions (MilbPlayer, MilbStatLine, User, Subscription, WatchlistEntry, DailyUsage) + migration | 0.5 |
| `packages/stats-mlb` adapter + daily cron + MiLB ingest verification | 1.5 |
| `packages/quality` quality-score function + unit tests | 1 |
| Clerk auth setup + `apps/prospects` middleware + sign-up flow | 1 |
| Stripe Subscriptions + webhook + paywall middleware + pricing page | 2 |
| Sleeper Index page + filters + tabs + freemium gating | 1.5 |
| Per-prospect detail page + freemium daily-limit | 1.5 |
| Watchlist (no notifications) | 0.5 |
| Marketing landing + meta + OG tags + Plausible/analytics | 1.5 |
| Polish, copy, cache-bust wiring, manual QA | 1.5 |
| **Total v1** | **~14 working days** |
