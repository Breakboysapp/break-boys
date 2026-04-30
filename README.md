# Break Boys

Track owned/wanted cards across sports-card break products.

## Local quick start

You'll need a Postgres connection string. Easiest free option: **Neon** —
[neon.tech](https://neon.tech) → create project → copy the pooled connection
string. Takes about 30 seconds.

```bash
cp .env.example .env
# paste the Neon URL into DATABASE_URL

npm install
npx prisma migrate dev      # creates schema in your Neon project
npx tsx scripts/bulk-import.ts   # re-seed the 20 product catalog from Beckett
npm run dev
```

Open http://localhost:3000.

## Deploy to Vercel (free)

1. **Push to GitHub.** From this directory:

   ```bash
   git add .
   git commit -m "initial"
   gh repo create break-boys --public --source . --push
   # or use the GitHub web UI to create a repo + run: git remote add origin <url> && git push -u origin main
   ```

2. **Create a Vercel project.** [vercel.com/new](https://vercel.com/new) →
   Import your repo. Framework auto-detects as Next.js.

3. **Provision Postgres.** In the Vercel project's *Storage* tab, click
   *Create Database* → *Neon* (free tier). Vercel auto-injects
   `DATABASE_URL` into the project's env vars.

4. **First deploy.** Vercel runs `npm run build` which calls
   `prisma generate` via the postinstall hook. The first deploy will
   complete but the DB is empty.

5. **Run migrations against the production DB.** Locally, with the same
   `DATABASE_URL` Vercel uses (copy it from Vercel → Settings → Environment
   Variables):

   ```bash
   DATABASE_URL="postgresql://..." npx prisma migrate deploy
   ```

6. **Seed the production catalog.** Same script as local, but pointed at
   the deployed URL:

   ```bash
   BASE_URL="https://your-app.vercel.app" npx tsx scripts/bulk-import.ts
   ```

   Re-runs the Beckett imports against the live API. ~3 minutes for the
   full catalog.

You're live. Share the `*.vercel.app` URL.

### Custom domain (optional)

In Vercel → Settings → Domains → add `break-boys.app` (or whatever you
buy). Vercel walks you through the DNS records. ~$12-30/year for the
domain itself; everything else stays free at this scale.

### eBay credentials in production

Add `EBAY_APP_ID`, `EBAY_CERT_ID` (and optionally `CRON_SECRET`) under the
Vercel project's *Environment Variables*. Redeploy. The daily cron in
`vercel.json` will refresh per-card market values automatically.

## Stack

- Next.js 15 (App Router, TypeScript)
- Prisma + Postgres (Neon recommended; works with any Postgres)
- Tailwind CSS
- papaparse + xlsx for checklist imports
- fast-xml-parser for the Cardboard Connection RSS calendar sync

## Repo layout

```
docs/SPEC.md                ← product spec
prisma/
  schema.prisma             ← Product, Card, TeamPrice, UserBreak, UserCard
  seed.ts
src/
  app/
    page.tsx                ← product list
    calendar/page.tsx       ← release calendar
    products/new/           ← create product
    products/[id]/          ← detail: checklist upload, team prices
    products/[id]/break/    ← team picker + have/want board
    api/                    ← route handlers (CSV upload, prices, breaks, status)
  lib/
    prisma.ts               ← shared client
    csv.ts                  ← papaparse wrapper
    money.ts                ← cents <-> dollars
    user.ts                 ← single-user stub (CURRENT_USER_ID = "local")
```

## Importing a checklist

Three options on every product detail page:

### 1. From a Beckett URL (recommended for major releases)

Paste a URL like `https://www.beckett.com/news/2024-topps-chrome-baseball-checklist/`. The importer:
1. Fetches the article HTML with a real browser User-Agent (Beckett 403s generic UAs).
2. Finds the `.xlsx` link inside the article (Beckett publishes structured Excel checklists, not scraped tables — much higher quality than HTML scraping).
3. Downloads the xlsx and parses every sheet (`Base`, `Autographs`, `Memorabilia`, `Inserts` — skipping `Teams` and `Master` summary tabs).
4. Tags rows with the sheet name as the `variation` (Base sheet → no variation; "RC" indicators preserved).

A real test against the 2024 Topps Chrome Baseball checklist URL imports **954 cards across 34 MLB teams**.

### 2. From a Google Sheets URL

Paste any Google Sheets share URL whose first sheet has columns `Team`, `Player`, `Card #` (and optionally `Parallel`). The importer auto-converts the URL to its CSV-export form. The sheet must be shared with "Anyone with the link." Useful when a breaker publishes a checklist as a Sheet.

### 3. From CSV (file upload or paste)

Required columns (case-insensitive, common aliases accepted): `Team`, `Player`, `Card #`. Optional: `Parallel` (alias of `Variation`).

```csv
Team,Player,Card #,Parallel
Yankees,Aaron Judge,1,
Yankees,Juan Soto,2,Refractor
Dodgers,Shohei Ohtani,10,
```

### Adding more importers

Drop a new file in [src/lib/sources/checklist/](./src/lib/sources/checklist/) implementing `ChecklistSource` (`canHandle(url)` + `importFrom(url)`), then register it in [src/lib/sources/checklist/index.ts](./src/lib/sources/checklist/index.ts). The dispatch route [/api/products/[id]/checklist/from-url](./src/app/api/products/[id]/checklist/from-url/route.ts) picks the first source that claims the URL, so order matters.

Verification scripts:
- `npm run test:beckett` — parse a downloaded `.xlsx` and report sections/teams/sample rows
- `npm run test:parser` — parser unit tests for the calendar feed
- `npm run test:sync` — calendar sync pipeline integration test

## Auth

MVP runs single-user. Every user-scoped row carries a `userId` defaulting to `"local"` (see `src/lib/user.ts`). To enable multi-user later: drop the `@default("local")` from `prisma/schema.prisma`, wire NextAuth, and replace `CURRENT_USER_ID` with the session's user id. No data migration required.

## Pricing model — fixed algorithm

The pricing algorithm is **deterministic** and lives entirely in [src/lib/scoring.ts](src/lib/scoring.ts). There are no per-product knobs, no UI sliders, and no manual overrides. The breaker controls one variable per product (box price) and one variable per team (wholesale = their cost contract). Everything else is algorithm output.

```
weight(card)        = lookup(prefix(card.cardNumber))   # see PREFIX_WEIGHTS in scoring.ts
contentScore(team)  = Σ weight(c) for c in team's cards
marketValue(team)   = Σ c.marketValueCents (cards with eBay data)

contentShare(team)  = contentScore / Σ contentScore
marketShare(team)   = marketValue / Σ marketValue
coverage(team)      = (cards with marketValue) / (total cards on team)
effAlpha(team)      = α + (1 - α) × (1 - coverage(team))     # α = PRICING_BLEND_ALPHA, fixed at 0.5

rawShare(team)      = effAlpha × contentShare + (1 - effAlpha) × marketShare
share(team)         = rawShare / Σ rawShare                  # re-normalize, sums to 1
retail(team)        = share(team) × Product.boxPriceCents
```

### Card-type weights (fixed)

Auto-classified by `cardNumber` prefix:

| Prefix | Type | Weight |
|---|---|---|
| `IVA-` | Ivory Auto | 15 |
| `PDPA-` | Pitch Black Dual Auto | 12 |
| `CBA-` | Chrome Black Auto | 10 |
| `SFA-` | Super Futures Auto | 8 |
| `PIA-` | Paint It Auto | 6 |
| `DAM-` `NOC-` `DOD-` `CBHA-` | Inserts | 4 |
| matches `AUTO` | generic Auto | 10 |
| any other alphabetic prefix | Insert (default) | 4 |
| numeric (e.g. `1`, `100`) | Base | 1 |

Tune the algorithm by editing the `PREFIX_WEIGHTS` table in [scoring.ts](src/lib/scoring.ts). Do not expose to the UI.

### Per-team coverage adjustment

When a team's cards have thin or absent eBay data, that team's effective α is pulled back toward content automatically. So a market refresh that only covers half the cards on a team still produces a sensible retail — it just leans more on the content score for that team. No manual fallback needed.

### What the user controls

- `Product.boxPriceCents` — total per-buyer slot price for one full break.
- `TeamPrice.wholesaleCents` — breaker's contract cost per team.

That's it. No weight editing, no blend slider, no retail override.

### eBay setup (one-time)

The "Refresh from eBay" button and the daily cron both need credentials.

1. Create a free account at [developer.ebay.com](https://developer.ebay.com/).
2. Go to *My Account → Application Keys* → *Production*. Generate a keyset if you don't have one.
3. Copy the **App ID** (Client ID) and **Cert ID** (Client Secret).
4. Add to `.env`:
   ```
   EBAY_APP_ID=YourAppID-Production-xxxx-xxxx-xxxx
   EBAY_CERT_ID=PRD-xxxxxxxxxxxx-xxxxxxxxxxxx-xxxxxxxx-xxxxxxxx
   ```
5. Restart the dev server.

That's it — no other config, no per-product setup. The "Refresh from eBay" button on every product page works immediately, and the [vercel.json](./vercel.json) cron refreshes every active product daily at 08:00 UTC in production.

### eBay caveats — read this

- The Browse API gives **active** listings (asking prices), not sold comps. Asking prices skew high (sellers list optimistically) but the *relative* shape across teams is what we use, and the absolute number is normalized away by the share-of-index math. With ~50–200 listings per team, the ranking is stable enough.
- Sold-comp data lives behind eBay's Marketplace Insights API, which requires per-app approval (apply at developer.ebay.com → Application Growth Check). Once approved, swap the URL in [src/lib/sources/pricing/ebay.ts](./src/lib/sources/pricing/ebay.ts) — the rest of the pipeline is identical.
- Rate limits: default Browse API quota is 5,000 calls/day. One product refresh = teams × 1 call (e.g. 35 for MLB). Daily cron over 5 active products ≈ 175 calls/day. Plenty of headroom.
- Skinny markets (e.g. obscure teams in obscure products) can return zero listings. Those teams get `valueIndex = 0` → no computed retail → falls back to the `Override` field if you've set one, otherwise displays as `—`.

## Calendar sync (Cardboard Connection)

The release calendar can be auto-populated from [Cardboard Connection's RSS feed](https://www.cardboardconnection.com/feed).

- **Manual sync**: hit the *Sync Cardboard Connection* button on `/calendar`.
- **Programmatic sync**: `POST /api/sync/cardboardconnection`.
- **Scheduled sync**: [vercel.json](./vercel.json) configures a daily cron at 06:00 UTC. On Vercel, set `CRON_SECRET` to gate the endpoint — the cron's `Authorization: Bearer <secret>` header will then be required.

### What the sync does

1. Fetches the RSS feed.
2. For each item, parses product name, manufacturer (Topps/Bowman/Panini/etc.), sport (MLB/NFL/NBA/NHL/Soccer/Racing/etc.), and release date — all from the article title and excerpt.
3. Upserts by `(source, externalId)` where `externalId` is the article slug.

### Heuristics & limits — read this

- **Release date** is extracted from prose like "Released on April 29, 2026" or "drops April 22, 2026". When the article doesn't state a date in a recognized form, the product lands with `releaseDate = null` and shows up under "Undated" on the calendar. Fix it manually in the DB or by editing the product (the only way today is `npx prisma studio`).
- **Manufacturer** is detected by keyword match (Bowman is preserved as its own brand even though Fanatics/Topps owns it now). Falls back to `null` if nothing matches.
- **Sport** detection is required — items with no detectable sport are skipped and reported in the sync result's `warnings` array.
- **Coverage**: the RSS feed surfaces ~20 most recent items. Running daily, you accumulate the calendar over time — a fresh deploy will only see the last week or so. To backfill historical releases, point the scraper at category pages later or import a CSV manually.
- **Source provenance**: scraped products have `source = "api:cardboardconnection"`. Manual edits via the UI overwrite source-driven fields, but the next sync will re-overwrite them. Mark the product manually if you want to lock its data.
- **ToS**: be polite — the scraper sets a descriptive User-Agent and Next's `revalidate: 3600` cache prevents hot-loop hits. If you scale, look for a partnership.

### Adding more sources

Drop another file in [src/lib/sources/](./src/lib/sources/) implementing `SourceProvider`, register it in [src/lib/sources/index.ts](./src/lib/sources/index.ts), and add an entry to `vercel.json`. Beckett is the obvious next one for checklists (which is where this is headed next, not the calendar).

## Future-readiness (not yet built)

- **Beckett checklists** — when a scraped product nears its release, fetch its checklist from Beckett and pre-populate `Card` rows.
- **Wholesale price tracking** from market data (eBay sold listings, etc.) → background job updating `TeamPrice.wholesaleCents`.
- **React Native client** → reuses the existing API routes.
