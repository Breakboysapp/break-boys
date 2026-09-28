# Gem Rate by Product — Scope

## Context
Gem rate (`popG10 / popTotal`) is currently surfaced **per player** inside a single product, via the ChaseScoreboard on each product detail page. We don't have a cross-product view yet — there's no way to compare "is 2025 Topps Chrome Football yielding more PSA 10s than 2024 Bowman?" without opening each product and eyeballing.

This doc scopes a new **catalog-wide gem-rate view** that rolls pop counts up to the `Product` level so products can be ranked / filtered by overall PSA 10 yield.

## Where it lives today

- **Computation pattern** — [src/lib/chase-rollup.ts:103-127](../src/lib/chase-rollup.ts) accumulates `popG10Sum` and `popTotalSum` per player, then divides at the end (`row.popTotalSum > 0 ? row.popG10Sum / row.popTotalSum : null`). Same math, different grouping key.
- **Raw data** — `Card.popG6..popG10`, `Card.popTotal`, all nullable (see [prisma/schema.prisma:65-75](../prisma/schema.prisma)). Snapshot, not time-series.
- **Existing product list pages** — `/products`, `/hot`, `/favorites` — none aggregate Card data beyond `_count: { cards: true }`. No precedent for product-level aggregates yet, so this view establishes the pattern.

## Concept
One row per Product, ranked best → worst by gem rate.

```
Gem rate (product) = Σ popG10  /  Σ popTotal  across all cards in the product
```

## Recommended placement
**New page: `/insights/gem-rates`** with a "Gem Rates" link in the top nav. Rationale:
- `/products` and `/favorites` are oriented around break-pricing decisions, not analytics — adding columns would crowd them.
- This view wants table chrome (sort, filter, search) that doesn't belong on a navigational page.
- Leaves room for sibling analytics pages later (`/insights/...`).

## Data layer
Add a cached server function `getProductGemRates()` to [src/lib/cached-queries.ts](../src/lib/cached-queries.ts), following the `unstable_cache` + tag pattern used elsewhere in that file.

```ts
const rows = await prisma.card.groupBy({
  by: ['productId'],
  _sum:   { popG10: true, popTotal: true },
  _count: { _all: true },        // cards-with-pop in the product
  where:  { popTotal: { gt: 0 } },
});
// Second query: fetch Product (name, sport, manufacturer, releaseDate) for those IDs.
// Compute gemRate = sumPopG10 / sumPopTotal in app code — matches chase-rollup pattern,
// avoids NUMERIC division in Postgres and keeps the null-guard consistent.
```

Cache tag: `gem-rates` (or co-tag with `products` so existing product-mutation revalidations bust it too).

## UI

### Table columns
| Product | Sport | Mfr | Released | Cards w/ pop | Σ Graded (popTotal) | Σ PSA 10 | **Gem rate %** | Coverage % |

- **Sort default:** gem rate desc.
- **Coverage %** = `cards-with-pop / total-cards-in-product`. Surfaces sparse-data products inline so a 100% gem rate on a 1-card sample doesn't mislead.
- **Min-sample filter dropdown:** ≥100 / ≥500 / ≥1000 graded. Default **≥100**.
- **Sport chip filter** — reuse the sport picker from `/hot`.
- **Manufacturer filter** — secondary, since manufacturer is nullable.
- **Search box** for product name.

### Top-of-page widgets
- **3 KPI cards** — products with pop data · total cards graded across catalog · weighted-overall gem rate.
- **Sport-grouped chart** — distribution / box-plot of product gem rates per sport (Chart.js, same dark theme as the Pipedrive YoY report). Lifts the page out of "table only".

## Critical files (touch list)
- **New:** `src/app/insights/gem-rates/page.tsx` — server component, calls the cached query, renders the table + KPIs + chart.
- **New:** `src/app/insights/gem-rates/GemRateTable.tsx` — client component, sort / filter / search.
- **Modify:** [src/lib/cached-queries.ts](../src/lib/cached-queries.ts) — add `getProductGemRates()`.
- **Modify:** top nav component (wherever `/products`, `/hot`, `/favorites` link from) — add "Gem Rates" entry.
- **Modify (optional):** product POST handler in [src/app/api/products/route.ts](../src/app/api/products/route.ts) — add `revalidateTag('gem-rates')` if not co-tagged.

## Open decisions
1. **Min-sample default** — ≥100 is a starting guess. Some niche products (parallels, low-print sets) may sit under 100 and still be meaningful. Revisit after seeing real distribution.
2. **Page route** — `/insights/gem-rates` vs. tab on `/products`. Recommending the former; flagging in case you'd rather keep analytics one click away from the catalog.
3. **Unreleased products** — hide if `popTotal = 0` (they will be, by definition). The `where: { popTotal: { gt: 0 } }` on the aggregation handles this implicitly.
4. **Per-format split** — a product can have Hobby/Jumbo/Mega Box `ProductFormat` rows, but pop data lives on `Card`, not format. Product-level only for now; format-level needs Card→Format tagging first (out of scope).

## Verification plan
- Spot-check one well-known product (e.g. a Topps Chrome Football release) — query the DB directly, compare to the page's number, eyeball against current per-player Chase Scoreboard sums on that product's detail page.
- Confirm null behavior — a product with all-null pop data should not appear in the list (filtered out by `popTotal > 0`), not show as `NaN%`.
- Confirm cache invalidation — adding/removing a card or refreshing pop counts on one product should bust the cached list within the existing revalidate path.
