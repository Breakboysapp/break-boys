import { notFound } from "next/navigation";
import Link from "next/link";
import {
  getCardSnapshotsForProduct,
  getCrossProductPricedCards,
  getProductFullById,
} from "@/lib/cached-queries";
import {
  PRICING_BLEND_ALPHA,
  computeBreakdown,
  isProspectCard,
  isRookieVariation,
  summarizeAlgorithmFor,
} from "@/lib/scoring";
import {
  buildPlayerInternationalMap,
  remapInternationalAnime,
} from "@/lib/international-anime";
import { rollupChasePlayers } from "@/lib/chase-rollup";
import { buildTeamExpandedRows } from "@/lib/team-expanded-rollup";
import ChecklistUpload from "./ChecklistUpload";
import TeamPriceEditor from "./TeamPriceEditor";
import FavoriteButton from "./FavoriteButton";
import ProductFormatsBar from "./ProductFormatsBar";

export const dynamic = "force-dynamic";

export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Cached full-product query — same shape as before but read via
  // unstable_cache (1h TTL). Each product gets its own cache slot
  // keyed on id, busted by mutations via revalidateTag('product-<id>').
  const product = await getProductFullById(id);
  if (!product) notFound();

  // Per-user favorited state moved to the client (<FavoriteButton/>
  // fetches its own state on mount via /api/products/[id]/favorite).
  // That keeps THIS page cacheable. The momentary unfilled-heart
  // before the client fetch lands is intentional and barely
  // perceptible (~50-100ms in practice).

  // Remap "Anime"-style insert cards that placed superstars on their
  // NATIONAL team affiliation (Cal Raleigh / USA, Ohtani / Japan, Soto
  // / Dominican Republic, etc.) back onto their MLB team. Keeps
  // anime cards counting toward the player's real team in the
  // scorecard rather than spawning one-off "USA" / "Japan" rows that
  // nobody buys into. The original country is preserved on
  // `internationalTeam` so the Chase view can surface "Anime: USA"
  // as a subtitle next to the player's name.
  const cards = remapInternationalAnime(product.cards);
  const playerInternationalMap = buildPlayerInternationalMap(cards);

  const algorithm = summarizeAlgorithmFor(cards);
  const teamBreakdown = computeBreakdown(cards, "team");
  const playerBreakdown = computeBreakdown(cards, "playerName");

  // Team Market Score — aggregates each team's roster of players by
  // their per-player marketScore (Card-Ladder-style blend on PSA 10
  // prices). Drives the new "Market" column on the Team Scoreboard.
  // Mirrors the Chase view's player rollup math: log(top + 1) * 0.6 +
  // log(median + 1) * 0.4, then sum unique player blends per team and
  // normalize across teams (top team = 100). Players with zero priced
  // cards contribute nothing — keeps the score honest about market data
  // coverage in this set.
  // Cross-product player market — the key piece for new products like
  // 2026 Bowman that have no in-set sales data yet. Pulls each player's
  // priced cards from EVERY product in the DB, so Judge / Ohtani / etc.
  // get scored from their full hobby footprint instead of going blank
  // because no 2026 Bowman card has traded yet. Rookies still rely on
  // their existing data (Bowman Draft, Topps Chrome) — which is exactly
  // how Card Ladder's player indexes work.
  const playersInProduct = [...new Set(cards.map((c) => c.playerName))];
  // Constrain the cross-product feed to products in the SAME sport.
  // Each sport has its own 100 — Ohtani topping MLB doesn't deflate
  // Mahomes on a football product page. Stops cross-sport scaling
  // weirdness without per-sport configuration; we just trust the
  // Product.sport tag we already have on every product.
  const playersGlobalCards = await getCrossProductPricedCards(
    product.sport,
    playersInProduct,
  );
  // Build a synthetic "card list" that mirrors product.cards but with
  // the player's TEAM from this product (so team aggregation still maps
  // correctly) and prices coming from the cross-product feed. Each
  // player contributes one synthetic card per priced card they have
  // anywhere in the DB.
  const teamByPlayer = new Map<string, string>();
  for (const c of cards) {
    if (c.team && c.team !== "—" && !teamByPlayer.has(c.playerName)) {
      teamByPlayer.set(c.playerName, c.team);
    }
  }
  const crossProductCards = playersGlobalCards
    .map((c) => ({
      team: teamByPlayer.get(c.playerName) ?? "—",
      playerName: c.playerName,
      psa10Cents: c.psa10Cents,
      ungradedCents: c.ungradedCents,
    }))
    .filter((c) => c.team !== "—");

  const teamMarketScores = computeTeamMarketScores(crossProductCards);

  // Shared helpers for the price-blend and trend math below. Hoisted
  // so they're available to the global player market computation,
  // the trend computation, AND the team aggregation.
  const RAW_TO_GRADED = 6;
  const eff = (psa: number | null, raw: number | null) =>
    Math.max(psa ?? 0, (raw ?? 0) * RAW_TO_GRADED);
  const medianFn = (a: number[]) => {
    if (a.length === 0) return 0;
    const s = [...a].sort((x, y) => x - y);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  // Per-player GLOBAL market score — Card-Ladder-style player index,
  // 0-100 normalized against the top player among those who appear in
  // this product. Same blend math the in-set marketScore uses
  // (log(top) × 0.6 + log(median) × 0.4) but sourced from the player's
  // priced cards across EVERY product, not just this one. Drives the
  // Chase view's marketScore so a brand-new product like 2026 Bowman
  // doesn't show empty rankings on release — Judge / Ohtani / Witt etc.
  // already have real market data from prior sets.
  const playerCrossPrices = new Map<string, number[]>();
  for (const c of playersGlobalCards) {
    const v = eff(c.psa10Cents, c.ungradedCents);
    if (v <= 0) continue;
    const arr = playerCrossPrices.get(c.playerName) ?? [];
    arr.push(v);
    playerCrossPrices.set(c.playerName, arr);
  }
  const playerCrossBlend = new Map<string, number>();
  for (const [name, prices] of playerCrossPrices) {
    const top = Math.max(...prices);
    const med = medianFn(prices);
    playerCrossBlend.set(name, Math.log(top + 1) * 0.6 + Math.log(med + 1) * 0.4);
  }
  const maxCrossBlend = Math.max(0, ...playerCrossBlend.values());
  // Pure-PC priced score 0-100. Kept as a separate map so we can
  // surface "Price" and "Activity" sub-signals in the chase tooltip
  // and so the legacy in-set fallback can use it when CH is offline.
  const playerPriceScores: Record<string, number> = {};
  if (maxCrossBlend > 0) {
    for (const [name, blend] of playerCrossBlend) {
      playerPriceScores[name] = Math.max(
        1,
        Math.round((blend / maxCrossBlend) * 100),
      );
    }
  }

  // Per-card price trend — % change in effective value from the
  // earliest snapshot to current. Powers the "Trend" column on the
  // Chase view. Snapshots only get written when a card's prices
  // actually move, so a card's earliest snapshot is its first
  // documented price; baselines accumulate naturally over time.
  // Empty until we have ≥2 snapshots per card; column fills in as
  // the cron runs each morning.
  const cardSnapshots = await getCardSnapshotsForProduct(product.id);
  const earliestSnapshot = new Map<
    string,
    {
      capturedAt: Date;
      psa10Cents: number | null;
      ungradedCents: number | null;
    }
  >();
  for (const s of cardSnapshots) {
    if (!earliestSnapshot.has(s.cardId)) {
      earliestSnapshot.set(s.cardId, s);
    }
  }
  const now = new Date();
  // Per-PLAYER trend — % change in the player's overall market (their
  // basket of priced cards), not just their top card. Mirrors how
  // Card Ladder publishes player indexes: the whole portfolio's
  // movement, weighted by chase value plus depth, not a single card's
  // sale.
  //
  // For each card belonging to the player:
  //   - "earlier" value = earliest CardPriceSnapshot if we have one,
  //     otherwise current value (no snapshot = no evidence of change)
  //   - "current" value = today's effective value
  // Player's market = top + median of those values across all priced
  // cards. Trend = % change of that market figure.
  // Reuse the hoisted medianFn helper.
  const cardsByPlayer = new Map<string, typeof cards>();
  for (const c of cards) {
    const arr = cardsByPlayer.get(c.playerName) ?? [];
    arr.push(c);
    cardsByPlayer.set(c.playerName, arr);
  }
  const playerTrends: Record<string, number | null> = {};
  for (const [playerName, playerCards] of cardsByPlayer) {
    const currentValues: number[] = [];
    const earlierValues: number[] = [];
    for (const c of playerCards) {
      const current = eff(c.psa10Cents, c.ungradedCents);
      if (current <= 0) continue; // not priced — skip
      currentValues.push(current);
      const snap = earliestSnapshot.get(c.id);
      const earlier = snap
        ? eff(snap.psa10Cents, snap.ungradedCents)
        : current;
      earlierValues.push(earlier);
    }
    if (currentValues.length === 0 || earlierValues.length === 0) {
      playerTrends[playerName] = null;
      continue;
    }
    const earlierMarket =
      Math.max(...earlierValues) + medianFn(earlierValues);
    const currentMarket =
      Math.max(...currentValues) + medianFn(currentValues);
    if (earlierMarket <= 0 || earlierMarket === currentMarket) {
      playerTrends[playerName] = null;
      continue;
    }
    playerTrends[playerName] =
      ((currentMarket - earlierMarket) / earlierMarket) * 100;
  }
  // Set-wide max snapshot age, used to label the trend column with the
  // actual time span we're showing ("15D Trend" / "1D Trend").
  const trendMaxDays = [...earliestSnapshot.values()].reduce(
    (max, s) => {
      const d = (now.getTime() - s.capturedAt.getTime()) / 86_400_000;
      return Math.max(max, d);
    },
    0,
  );
  // Convert team market scores → ordinal ranks. The 0-100 normalized
  // score read as "team #9 has 9/100 worth of market value" which made
  // 9th place look almost worthless even when the roster had a real
  // chase rookie. A 1-of-N rank communicates ordering without implying
  // exponential gaps. Ties get the same rank only when both are zero
  // (filtered out below); otherwise tiebreak alphabetically so rank
  // assignment is deterministic across renders.
  const teamMarketRanks = new Map<string, number>();
  const sortedTeams = [...teamMarketScores.entries()]
    .filter(([, score]) => score > 0)
    .sort(
      ([a, sa], [b, sb]) =>
        sb - sa || a.localeCompare(b),
    );
  sortedTeams.forEach(([team], i) => {
    teamMarketRanks.set(team, i + 1);
  });
  const totalRankedTeams = teamMarketRanks.size;

  // Inject marketRank (primary) + raw marketScore (tooltip / tiebreak)
  // into each team breakdown row. Keys by team name so re-ordering /
  // filtering on the client doesn't drift.
  for (const r of teamBreakdown.rows) {
    (r as Record<string, unknown>).marketScore =
      teamMarketScores.get(r.name) ?? 0;
    (r as Record<string, unknown>).marketRank =
      teamMarketRanks.get(r.name) ?? null;
  }

  // Per-player "is rookie?" map. A player is a rookie in this product
  // if ANY of their cards carries the Beckett rookie tag. Detection
  // logic in isRookieVariation — explicitly excludes mixed-class
  // subsets ("Rookie and Veteran") so veterans on those subsets
  // (e.g. Nick Kurtz in 2026 Bowman) don't get tagged as rookies.
  const playerRookieMap: Record<string, boolean> = {};
  for (const c of cards) {
    if (isRookieVariation(c.variation)) {
      playerRookieMap[c.playerName] = true;
    }
  }

  // Per-player "is prospect?" map. Bowman-only — prospect lines are the
  // headline content of every Bowman product (BP-, BCP-, CPA-, etc.) and
  // veterans appear on regular numbered cards. A player is flagged as
  // prospect when every card in this product carrying their name sits on
  // a prospect line; that filters out veterans who happen to have a
  // single prospect-y insert appearance and keeps minor-leaguers /
  // draftees marked even when they have multiple parallel cards.
  // Other product lines (Topps Chrome, Panini Prizm, etc.) skip this
  // computation — they don't have a prospect concept the same way, so
  // the map stays empty and no (P) markers render.
  // CH trending was previously fetched here in the SSR critical
  // path, blocking page render until 354 player batches returned.
  // Now deferred to a client-side fetch via /api/products/[id]/trending
  // — the page renders immediately with PC-only Overall scores; the
  // client blends in CH activity once the API returns. Hot This Week
  // shows a "loading" state until the client fetch resolves.
  const playerTrendingMap: Record<
    string,
    {
      isTrending: boolean;
      currentWeekSales: number;
      spikeMultiple: number;
      currentWeekCents: number;
      last30dCents: number;
      last30dSales: number;
    }
  > = {};
  const trendingDiagnostics = undefined;

  // Initial Overall = 100% PC priced score. Client-side merge in
  // TeamPriceEditor applies the 0.55 / 0.45 PC + CH blend once the
  // /api/products/[id]/trending response lands. This way the chase
  // view renders immediately with reasonable scores; CH activity
  // smoothly upgrades them after first paint.
  const playerGlobalScores: Record<string, number> = {};
  const allPlayerNames = new Set<string>([...Object.keys(playerPriceScores)]);
  for (const name of allPlayerNames) {
    const price = playerPriceScores[name] ?? 0;
    const activity = 0;
    const PRICE_WEIGHT = 1;
    const ACTIVITY_WEIGHT = 0;
    const blended = price * PRICE_WEIGHT + activity * ACTIVITY_WEIGHT;
    if (blended > 0) {
      playerGlobalScores[name] = Math.max(1, Math.round(blended));
    }
  }

  const isBowmanProduct = /bowman/i.test(product.name);
  const playerProspectMap: Record<string, boolean> = {};
  if (isBowmanProduct) {
    const totalsByPlayer = new Map<
      string,
      { total: number; prospect: number }
    >();
    for (const c of cards) {
      const t = totalsByPlayer.get(c.playerName) ?? { total: 0, prospect: 0 };
      t.total++;
      if (isProspectCard(c.cardNumber, c.variation)) t.prospect++;
      totalsByPlayer.set(c.playerName, t);
    }
    for (const [name, { total, prospect }] of totalsByPlayer) {
      // All-or-nothing: every card a player has in this set must be on a
      // prospect line. Catches both pure-prospect rookies (Holliday: BP-1,
      // BCP-1, CPA-EH) and avoids false-positives on veterans who happen
      // to land on a prospect-themed insert.
      if (total > 0 && prospect === total) {
        playerProspectMap[name] = true;
      }
    }
  }

  // Build the "Hot This Week" feed from the trending map, ranked by
  // current-week dollar volume so the meaningful spikes lead. Caps
  // at 8 entries — anything beyond that is more noise than signal at
  // the product-page level. Most-frequent team across the player's
  // cards in this product surfaces alongside the name. Rookie /
  // prospect markers reuse the maps we just built above.
  const teamCountByPlayer = new Map<string, Map<string, number>>();
  for (const c of cards) {
    if (!c.team || c.team === "—") continue;
    let inner = teamCountByPlayer.get(c.playerName);
    if (!inner) {
      inner = new Map();
      teamCountByPlayer.set(c.playerName, inner);
    }
    inner.set(c.team, (inner.get(c.team) ?? 0) + 1);
  }
  const primaryTeamFor = (name: string): string | null => {
    const inner = teamCountByPlayer.get(name);
    if (!inner) return null;
    return (
      [...inner.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    );
  };
  const hotThisWeek = Object.entries(playerTrendingMap)
    .filter(([, t]) => t.isTrending)
    .map(([name, t]) => ({
      playerName: name,
      team: primaryTeamFor(name),
      currentWeekSales: t.currentWeekSales,
      currentWeekCents: t.currentWeekCents,
      spikeMultiple: t.spikeMultiple,
      isRookie: playerRookieMap[name] ?? false,
      isProspect: playerProspectMap[name] ?? false,
    }))
    .sort((a, b) => b.currentWeekCents - a.currentWeekCents)
    .slice(0, 8);

  const totalContentScore = teamBreakdown.rows.reduce(
    (s, r) => s + r.totalScore,
    0,
  );
  const cardsWithMarket = cards.filter(
    (c) => c.marketValueCents != null && c.marketValueCents > 0,
  ).length;

  // Server-side chase rollup. Replaces what used to be a per-card
  // array shipped to ChaseScoreboard for client-side rollup. On
  // 2026 Bowman this dropped the HTML payload from ~1.18 MB to a
  // tiny fraction (Mobile Safari load fix).
  const chasePlayers = rollupChasePlayers(
    cards.map((c) => ({
      playerName: c.playerName,
      team: c.team,
      isRookie: isRookieVariation(c.variation),
      cardNumber: c.cardNumber,
      variation: c.variation,
      ungradedCents: c.ungradedCents,
      psa10Cents: c.psa10Cents,
      printRun: c.printRun,
      popG10: c.popG10,
      popTotal: c.popTotal,
      imageUrl: c.imageUrl,
    })),
  );
  const hasInSetPriceData = cards.some(
    (c) => c.psa10Cents != null && c.psa10Cents > 0,
  );

  // Product-wide gem rate — Σ popG10 / Σ popTotal across every card with
  // pop data. Weighted by total graded count, so a card with 5,000 graded
  // matters more than a 1-card sample. Null when no card has pop data
  // yet (chip just doesn't render). Same math the per-player Chase
  // Scoreboard uses, summed one level up.
  let popG10Sum = 0;
  let popTotalSum = 0;
  for (const c of cards) {
    if (c.popTotal != null && c.popTotal > 0) {
      popG10Sum += c.popG10 ?? 0;
      popTotalSum += c.popTotal;
    }
  }
  const overallGemRate = popTotalSum > 0 ? popG10Sum / popTotalSum : null;

  // Pre-compute the team-expanded player sub-rows server-side. Each
  // entry is a small per-team list keyed by the team name; replaces
  // the prior approach of shipping the entire 1,200+ card array to
  // the client just so it could group on click. Big payload win
  // alongside the chase rollup.
  const bucketWeightByLabel = new Map(
    algorithm.map((b) => [b.label, b.weight]),
  );
  const teamExpandedRows = buildTeamExpandedRows(
    cards.map((c) => ({
      team: c.team,
      playerName: c.playerName,
      cardNumber: c.cardNumber,
      variation: c.variation,
    })),
    bucketWeightByLabel,
  );
  const hasTeams = product.teamPrices.length > 0;
  // Two flavors of "not yet released":
  //   - hasNoChecklist: empty product, replace scoreboard with the
  //     placeholder banner.
  //   - isComingSoon (badge only): release date is null or future AND
  //     either the status is announced (pre-loaded checklist case) or
  //     the product has no cards yet. Mirrors the homepage filter so
  //     the hero pill matches the tab a user just clicked through
  //     from. Status alone isn't enough — most existing products
  //     default to "announced" but are released; the date guard
  //     prevents every page from showing the Coming Soon pill.
  const hasNoChecklist = product._count.cards === 0;
  const releaseInFutureOrUnknown =
    product.releaseDate == null || product.releaseDate > new Date();
  const isComingSoon =
    hasNoChecklist ||
    (product.releaseStatus === "announced" && releaseInFutureOrUnknown);

  return (
    <div className="space-y-10">
      {/* Hero header */}
      <div className="relative rounded-2xl border border-slate-200 bg-white p-5 sm:p-8">
        {/* Favorite toggle, top-right of the hero. Saved per-user (still
            stubbed to "local" until auth lands) — surfaced under the
            Favorites link in the global nav. */}
        <div className="absolute right-4 top-4 sm:right-6 sm:top-6">
          <FavoriteButton productId={product.id} />
        </div>
        <Link
          href="/"
          className="text-[11px] font-bold uppercase tracking-tight-2 text-slate-500 hover:text-ink"
        >
          ← All products
        </Link>
        <div className="mt-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-tight-2 text-accent">
          {[product.manufacturer, product.sport].filter(Boolean).join(" · ")}
        </div>
        <h1 className="mt-1 text-2xl font-extrabold leading-tight tracking-tight-3 sm:text-4xl">
          {product.name}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
          {product.releaseDate && (
            <span>Released {product.releaseDate.toISOString().slice(0, 10)}</span>
          )}
          <span>
            {product._count.cards} {product._count.cards === 1 ? "card" : "cards"}
          </span>
        </div>

        {hasTeams && !isComingSoon && (
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link
              href={`/products/${product.id}/break`}
              className="block w-full rounded-md bg-ink px-5 py-3 text-center text-sm font-bold uppercase tracking-tight-2 text-white hover:opacity-90 sm:inline-block sm:w-auto"
            >
              Start a break →
            </Link>
          </div>
        )}
        {isComingSoon && (
          <div className="mt-6 inline-flex items-center gap-2 rounded-md border border-accent/30 bg-accent/5 px-3 py-1.5 text-[11px] font-bold uppercase tracking-tight-2 text-accent">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            Coming Soon
          </div>
        )}
      </div>

      {/* Overall gem rate — Σ popG10 / Σ popTotal across every card in
          the product that has pop data. One canonical "how often does
          this product yield a PSA 10?" number, surfaced prominently so
          you don't have to drill into the per-player Chase Scoreboard
          to read it. Silently absent on products without pop data
          (mostly unreleased / not-yet-backfilled sets); the slot
          collapses cleanly without leaving a "—%" gap. */}
      {overallGemRate != null && (
        <div
          className="rounded-2xl border border-slate-200 bg-white p-5"
          title={`${popG10Sum.toLocaleString()} PSA 10s out of ${popTotalSum.toLocaleString()} graded cards across every card in this product with pop data`}
        >
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-tight-2 text-accent">
                Overall gem rate
              </div>
              <div className="mt-1 text-4xl font-extrabold tracking-tight-3 text-ink sm:text-5xl">
                {(overallGemRate * 100).toFixed(1)}%
              </div>
            </div>
            <div className="text-right text-[11px] leading-snug text-slate-500">
              <div>
                <span className="font-bold text-ink">
                  {popG10Sum.toLocaleString()}
                </span>{" "}
                PSA 10s
              </div>
              <div>
                of{" "}
                <span className="font-bold text-ink">
                  {popTotalSum.toLocaleString()}
                </span>{" "}
                graded cards
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Box format selector — compact native <select> dropdown.
          Pre-seeded for every product based on its name pattern
          (src/lib/product-formats-defaults.ts), so users never see
          an empty editor; they just pick the format they care about
          and read the inline summary. Notes still live in the DB but
          aren't surfaced here — kept the bar minimal per the user's
          ask. */}
      {product.formats.length > 0 && (
        <ProductFormatsBar
          formats={product.formats.map((f) => ({
            id: f.id,
            name: f.name,
            packsPerBox: f.packsPerBox,
            cardsPerPack: f.cardsPerPack,
            autosPerBox: f.autosPerBox,
          }))}
        />
      )}

      {hasNoChecklist ? (
        <ComingSoon productId={product.id} />
      ) : (
        <>
          {/*
            Render the scoreboard section for any product with a
            checklist, regardless of whether teams have been wired up.
            PriceCharting-imported products start with all cards under a
            placeholder "—" team but already have psa10Cents data, so
            their Chase Scoreboard is the immediately useful view; the
            Team Scoreboard renders one degenerate "—" row, which is
            ugly but doesn't block the user from seeing Chase. Manually-
            uploaded products with real teams render Team Scoreboard
            fully and don't show Chase (no PriceCharting data on them
            yet — fixed when we merge the importer match logic next).
            Announced products with a pre-loaded checklist (cards > 0)
            still render the scoreboard — only `hasNoChecklist` flips us
            to the placeholder.
          */}
          {!hasNoChecklist && (
            <section className="space-y-3">
              <TeamPriceEditor
                productId={product.id}
                initialBoxPriceCents={product.boxPriceCents}
                blendAlpha={PRICING_BLEND_ALPHA}
                totalContentScore={totalContentScore}
                cardsWithMarket={cardsWithMarket}
                cardCount={product._count.cards}
                lastMarketRefreshAt={product.lastMarketRefreshAt?.toISOString() ?? null}
                algorithm={algorithm}
                teamBreakdownRows={teamBreakdown.rows}
                playerBreakdownRows={playerBreakdown.rows}
                chasePlayers={chasePlayers}
                hasInSetPriceData={hasInSetPriceData}
                teamExpandedRows={teamExpandedRows}
                hotThisWeek={hotThisWeek}
                trendingDiagnostics={trendingDiagnostics}
                playerGlobalScores={playerGlobalScores}
                playerInternationalMap={playerInternationalMap}
                playerProspectMap={playerProspectMap}
                playerRookieMap={playerRookieMap}
                playerTrendingMap={playerTrendingMap}
                playerTrends={playerTrends}
                totalRankedTeams={totalRankedTeams}
                trendDays={trendMaxDays}
              />
            </section>
          )}

          {/* Checklist import lives at the bottom — once the product is
              loaded, this is rarely interacted with, so it shouldn't dominate
              the top of the page. Collapsed by default. */}
          <details className="rounded-2xl border border-slate-200 bg-white">
            <summary className="cursor-pointer px-5 py-3 text-[11px] font-bold uppercase tracking-tight-2 text-slate-500 hover:text-ink">
              Checklist · {product._count.cards} cards · re-import or replace
            </summary>
            <div className="border-t border-slate-200 p-5">
              <ChecklistUpload
                productId={product.id}
                hasExistingCards={product._count.cards > 0}
              />
            </div>
          </details>
        </>
      )}
    </div>
  );
}

/**
 * Compute a 0-100 Market Score per team. The Chase view's per-player
 * marketScore uses a log-compressed blend (good for normalizing the
 * spread to a tidy 0-100 scale) — but log compression is the wrong
 * choice when AGGREGATING players within a team, because it makes
 * stars and benchwarmers contribute similar amounts. ("$50 nobody"
 * blend ≈ 8.5; "$13k chase rookie" blend ≈ 14.1 — only 1.7× more.)
 * That math punishes star-heavy teams and rewards long-tail rosters.
 *
 * For team aggregation we use RAW cents instead. Per-player weight =
 * top PSA 10 + median PSA 10. Sum that across the team's roster, then
 * normalize across teams so the top team in the set = 100. Stars
 * dominate the way the user expects: Pirates with Seth Hernandez at
 * $6,843 outweighs the entire Rockies roster of ~$50-3,900 cards even
 * before Konnor Griffin is added in. Long tails of cheap players don't
 * pile up to outrank concentrated value.
 *
 * Players with no priced cards contribute zero — coverage gaps don't
 * unfairly punish a team, they just leave headroom.
 */
function computeTeamMarketScores(
  cards: Array<{
    team: string;
    playerName: string;
    psa10Cents: number | null;
    ungradedCents: number | null;
  }>,
): Map<string, number> {
  // Per-card "effective" value = max of actual PSA 10 and a raw-derived
  // estimate (raw × multiplier). Lets cards that PC has raw comps for
  // but no graded comps yet (e.g. Jamie Arnold's BD-30 Black /1 at
  // $3K raw, no PSA 10 listed) still contribute to the player's
  // marketScore. Multiplier 6 is conservative — high-end rookie autos
  // often sell at 10-15x raw graded, but we'd rather under-estimate
  // chase value than over-inflate cards that haven't actually traded
  // graded.
  const RAW_TO_GRADED_MULT = 6;
  const effectiveCents = (c: {
    psa10Cents: number | null;
    ungradedCents: number | null;
  }) => {
    const psa = c.psa10Cents ?? 0;
    const raw = (c.ungradedCents ?? 0) * RAW_TO_GRADED_MULT;
    return Math.max(psa, raw);
  };

  const playerPrices = new Map<string, number[]>();
  const playerTeam = new Map<string, string>();
  for (const c of cards) {
    const v = effectiveCents(c);
    if (v > 0) {
      const arr = playerPrices.get(c.playerName) ?? [];
      arr.push(v);
      playerPrices.set(c.playerName, arr);
    }
    if (c.team && c.team !== "—" && !playerTeam.has(c.playerName)) {
      playerTeam.set(c.playerName, c.team);
    }
  }
  function median(a: number[]): number {
    if (a.length === 0) return 0;
    const s = [...a].sort((x, y) => x - y);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  // Per-player value = top PSA 10 + median PSA 10. Top is the chase
  // signal; median grounds it so an anomalous /1 sale doesn't fully
  // dominate over a player with deep priced data.
  const playerValue = new Map<string, number>();
  for (const [name, prices] of playerPrices.entries()) {
    playerValue.set(name, Math.max(...prices) + median(prices));
  }
  // Team aggregation models break-room economics: a roster with 2-3
  // genuine stars is meaningfully different from one with a single
  // chase + filler. So we count the top THREE players each at full
  // weight (chase tier), then long-tail depth (4th+) at 15% as a
  // tiebreaker.
  //
  // Examples on prod (Topps Chrome 2025):
  //   Yankees (Rice $5k + Judge $4k + Volpe ~$2k) gets credit for
  //     all 3 stars instead of just Rice.
  //   Athletics (Kurtz $35k + small) still leads decisively because
  //     Kurtz alone outweighs other teams' top three combined —
  //     that's a genuinely runaway market, not a formula artifact.
  //   Dodgers (Ohtani $16k + Sasaki $7k + Hyeseong $2.5k) climbs
  //     because all three stars now count.
  //
  // The 3-stars cutoff matches the natural shape of break rooms:
  // most teams have 0-3 names worth chasing, the rest is filler. If
  // a future set has >3 chase-tier players on one team (super-stacked
  // roster) the long tail at 15% still rewards that depth, just at a
  // lower marginal rate.
  const STAR_TIER_SIZE = 3;
  const DEPTH_WEIGHT = 0.15;
  const teamPlayers = new Map<string, number[]>();
  for (const [name, value] of playerValue.entries()) {
    const team = playerTeam.get(name);
    if (!team) continue;
    const arr = teamPlayers.get(team) ?? [];
    arr.push(value);
    teamPlayers.set(team, arr);
  }
  const teamRaw = new Map<string, number>();
  for (const [team, values] of teamPlayers.entries()) {
    const sorted = [...values].sort((a, b) => b - a);
    const stars = sorted
      .slice(0, STAR_TIER_SIZE)
      .reduce((s, v) => s + v, 0);
    const tail = sorted
      .slice(STAR_TIER_SIZE)
      .reduce((s, v) => s + v, 0);
    teamRaw.set(team, stars + DEPTH_WEIGHT * tail);
  }
  const max = Math.max(0, ...teamRaw.values());
  const out = new Map<string, number>();
  if (max === 0) return out;
  for (const [team, raw] of teamRaw.entries()) {
    out.set(team, Math.max(1, Math.round((raw / max) * 100)));
  }
  return out;
}

/**
 * Placeholder shown when a product has no cards on its checklist yet —
 * either we couldn't find an xlsx on Beckett (product not yet released),
 * or it's a manually-created product the user hasn't loaded yet.
 *
 * Keeps the checklist import UI accessible below the banner so the user can
 * retry once Beckett (or another source) publishes the data.
 */
function ComingSoon({ productId }: { productId: string }) {
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border-2 border-dashed border-slate-300 bg-white p-12 text-center">
        <div className="text-[11px] font-bold uppercase tracking-tight-2 text-accent">
          Status
        </div>
        <div className="mt-2 text-3xl font-extrabold tracking-tight-3">
          CHECKLIST COMING SOON
        </div>
        <p className="mx-auto mt-3 max-w-md text-sm text-slate-500">
          We couldn&apos;t find a published checklist for this product yet.
          Beckett and other sources usually post the full <code>.xlsx</code>{" "}
          closer to release date — we&apos;ll pick it up automatically. If you
          already have one, you can upload a CSV below.
        </p>
      </div>
      <details className="rounded-2xl border border-slate-200 bg-white">
        <summary className="cursor-pointer px-5 py-3 text-[11px] font-bold uppercase tracking-tight-2 text-slate-500">
          Have a CSV? Upload it now
        </summary>
        <div className="border-t border-slate-200 p-5">
          <ChecklistUpload productId={productId} hasExistingCards={false} />
        </div>
      </details>
    </div>
  );
}

