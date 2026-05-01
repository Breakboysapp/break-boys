# Break Boys — Roadmap & Checklist

Living document. Tick boxes as work ships. Sequence is roughly priority-ordered
but can be reshuffled — each section is mostly independent.

---

## 0. Immediate (eBay)

Waiting on eBay developer approval (applied 2026-04-30).

- [ ] eBay sends production keyset
- [ ] Add `EBAY_APP_ID` to Vercel → Settings → Environment Variables
- [ ] Add `EBAY_CERT_ID` to Vercel → Settings → Environment Variables
- [ ] (Optional) Add `CRON_SECRET` to gate the daily cron endpoint
- [ ] Vercel → Deployments → Redeploy
- [ ] Open a product → Pricing section → click **Refresh from eBay** → wait ~2 min
- [ ] Verify Market $ column populates on the score card
- [ ] Verify daily cron is running (check Vercel cron logs after 24 h)

**Acceptance:** every product's score card shows real per-card market values;
per-team retail computes from the composite (content × market) blend.

---

## 1. PWA / Add-to-Home-Screen (~2 hours)

Goal: people can install the app on their iPhone/Android home screen without
going through app stores. Looks like a real app.

- [ ] Create `public/manifest.webmanifest` (name, short_name, icons, theme color)
- [ ] Generate PWA-spec icon set (192, 512, 1024 — derive from existing
      `app/icon.svg` BB monogram)
- [ ] iOS splash images (multiple sizes — Apple is fussy)
- [ ] Service worker for offline shell + asset caching (Next.js has
      `@serwist/next` or hand-rolled)
- [ ] `<link rel="manifest">` and Apple meta tags in `app/layout.tsx`
- [ ] Test "Add to Home Screen" on iOS Safari + Android Chrome
- [ ] Add an unobtrusive "Install Break Boys" banner that dismisses on close

**Acceptance:** opening `breakboys.app` in mobile Safari/Chrome offers an
install prompt; once installed, opens fullscreen with the BB icon, no browser
chrome.

---

## 2. Auth + User Collections (~2 days)

Foundation for the consumer-side product (collection tracker). Everything in
sections 3–5 depends on this.

- [ ] Install + configure NextAuth.js
- [ ] Add Google OAuth provider (cheapest, lowest friction)
- [ ] Optional: email magic-link provider as fallback
- [ ] Add `User` model in Prisma; tie sessions to it
- [ ] Replace `CURRENT_USER_ID = "local"` stub with real session lookup
      (`src/lib/user.ts`)
- [ ] Repurpose existing `UserCard` model for the collection (already has
      userId + cardId + status fields; add `condition`, `gradedBy`, `serial`
      for graded/numbered cards)
- [ ] `/collection` page — lists user's owned cards, sortable + filterable
- [ ] Per-card status toggles (Owned / Want / Have-Extra) on existing
      product/break pages
- [ ] Estimated total value across the collection (sum `card.marketValueCents`)
- [ ] Sign-in / sign-out UI in the global header

**Acceptance:** a user signs in with Google, marks a few cards as Owned across
products, and sees them rolled up on `/collection` with a total value.

---

## 3. Collection Import from Other Apps (~2 days)

Pulls users away from competitors by removing the "start over" friction. Each
adapter is small once auth + collection are in place.

- [ ] `POST /api/collection/import` — accepts CSV + a `source` param
      (`cardladder` | `collx` | `psa` | `ebay` | `beckett`)
- [ ] Card Ladder CSV adapter (their export format)
- [ ] CollX CSV adapter
- [ ] PSA Set Registry CSV adapter
- [ ] eBay seller-hub collection CSV adapter
- [ ] Fuzzy matching: import row → best-match card in our DB by player +
      year + set + card #
- [ ] Manual disambiguation UI for unmatched rows (show top 3 candidates)
- [ ] Import history / undo
- [ ] (Later) Beckett OPG xlsx adapter, Sportlots scraper

**Acceptance:** drag in a Card Ladder export, see >90% of cards correctly
mapped to our products, manually resolve the rest, total value reflects the
collection within 60 seconds end-to-end.

---

## 4. Image Scanning (~2 days for MVP, longer for production-grade)

Lowest-friction path: GPT-4o Vision for the first cut. Iterate based on what
fails.

- [ ] Set up OpenAI API key in Vercel env (`OPENAI_API_KEY`)
- [ ] Build server action that accepts an image, calls GPT-4o Vision,
      asks for `{ player, year, set, cardNumber, parallel }` JSON
- [ ] Match the parsed result against our card DB
- [ ] `/scan` page — camera capture or file upload, shows top 3 matches
- [ ] Manual "this is wrong, pick from list" fallback
- [ ] Add scanned card to user's collection on confirm
- [ ] Track scan accuracy metrics (manual override rate) in the DB so we
      know when to upgrade
- [ ] Honest UX copy: "AI-assisted scanning, beta — verify before saving"

**Stretch (when traction justifies):**

- [ ] Compare against Ludex API pricing/licensing
- [ ] Build per-set image fingerprint library for parallel disambiguation
- [ ] On-device CV (TensorFlow.js / MLKit) for offline scanning
- [ ] Multi-card batch scan (lay 9 cards on a table, scan once)

**Acceptance:** user takes a photo of a clean Topps Chrome base, gets the
right card identified within 2 seconds, one-tap adds it to their collection.

---

## 5. App Store Distribution (when ready)

Wrap the existing Next.js app with Capacitor. No rewrite. After the PWA is
solid, this is mostly packaging + store paperwork.

- [ ] Apple Developer account ($99/yr)
- [ ] Google Play Developer account ($25 one-time)
- [ ] Install Capacitor in the project
- [ ] iOS build: app icons, splash screens, privacy descriptions, App
      Store screenshots
- [ ] Android build: same
- [ ] App Store review submission (~7 day review)
- [ ] Play Store review submission (~2 day review)
- [ ] Plan a TestFlight / closed beta first to catch review-blocking issues

**Acceptance:** Break Boys is searchable + downloadable on both stores.

---

## Polish Backlog (small, ship when convenient)

- [ ] Open Graph image for `breakboys.app` so iMessage/Discord previews
      show the BB logo + tagline instead of a blank card
- [ ] Verify production `/api/products/[id]/checklist/from-url` works
      after the `serverExternalPackages` fix (test by adding a new product
      from the live site)
- [ ] Refresh "Coming Soon" products as Beckett publishes their xlsx
      files (re-run `seed-panini-nfl.ts` or one-off retries)
- [ ] Edit-mixer flow (PATCH endpoint exists; no UI yet)
- [ ] Per-team retail price computation for mixers (single mixer-wide
      box price → share by combined Break Score)
- [ ] Backfill release dates on any future imports (extend
      bulk-import.ts to set `releaseDate` from the xlsx upload path)
- [ ] Add Panini NBA + NHL + Soccer products via the same pattern as
      `seed-panini-nfl.ts`
- [ ] Add Topps NHL products (Upper Deck has the NHL license but Topps
      has some hockey-adjacent products)
- [ ] Calendar UI: month grid view alongside the list
- [ ] Mobile: hamburger menu on the global nav when more items are added

---

## Strategic Notes

**Don't build a custom CV model.** 3-6 months of work to barely match what's
free elsewhere. GPT-4o Vision + our checklist gets you 80% of the value at
1% of the cost. Iterate based on actual user failure cases, not assumed ones.

**Import is the moat.** The single biggest reason people don't try a new
collection app is "I have to manually re-enter everything." Shipping
adapters for Card Ladder, CollX, PSA, eBay puts Break Boys at the front of
that decision.

**Differentiator vs. Ludex/CollX:** they're consumer-only collection apps.
Break Boys is the *break-tracking* app that *also* has a collection. Score
cards, mixers, breaker-side workflow — none of those exist elsewhere.
Don't try to out-scan Ludex; double down on what they don't do.

**Monetization paths to consider** (not building yet, just flagging):

1. Free for buyers, $/mo for breakers running mixers (the side that
   makes money in a break already)
2. Affiliate links to eBay/Beckett/CardLadder (each transaction kicks
   back ~3-5%)
3. Premium scanning (more accurate model, batch scans)
4. Team-mode for break groups (shared mixers, leaderboards)
