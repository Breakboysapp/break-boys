/**
 * Refresh per-card market values for one or more products, running locally
 * against whatever DATABASE_URL points at. Sidesteps Vercel's serverless
 * function timeout (Hobby = 60s) by running on your machine — useful for
 * the initial bulk refresh and for products with hundreds of cards.
 *
 * Requires:
 *   DATABASE_URL=postgres://...   (production DB)
 *   PRICECHARTING_TOKEN=...       (or EBAY_APP_ID/EBAY_CERT_ID for eBay fallback)
 *
 * Usage:
 *   npx tsx scripts/refresh-market-values.ts <productId>             # single product
 *   npx tsx scripts/refresh-market-values.ts --smallest              # smallest product (smoke test)
 *   npx tsx scripts/refresh-market-values.ts --all                   # every product
 *   npx tsx scripts/refresh-market-values.ts --recent                # last 90 days released or undated
 */
import { PrismaClient } from "@prisma/client";
import {
  activeMarketProvider,
  fetchCardValues,
  marketProviderLabel,
} from "../src/lib/sources/pricing/provider";

type Product = {
  id: string;
  name: string;
  cardCount: number;
};

async function pickProducts(
  prisma: PrismaClient,
  arg: string | undefined,
): Promise<Product[]> {
  if (!arg) {
    console.error(
      "Usage: tsx scripts/refresh-market-values.ts <productId | --smallest | --all | --recent>",
    );
    process.exit(1);
  }
  const all = await prisma.product.findMany({
    select: { id: true, name: true, releaseDate: true, _count: { select: { cards: true } } },
    orderBy: { name: "asc" },
  });
  const withCounts: Array<Product & { releaseDate: Date | null }> = all
    .map((p) => ({
      id: p.id,
      name: p.name,
      cardCount: p._count.cards,
      releaseDate: p.releaseDate,
    }))
    .filter((p) => p.cardCount > 0);

  if (arg === "--smallest") {
    withCounts.sort((a, b) => a.cardCount - b.cardCount);
    return withCounts.slice(0, 1);
  }
  if (arg === "--all") {
    return withCounts;
  }
  if (arg === "--recent") {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    return withCounts.filter(
      (p) => !p.releaseDate || p.releaseDate >= cutoff,
    );
  }
  // Treat as a product id
  const match = withCounts.find((p) => p.id === arg);
  if (!match) {
    console.error(`Product id not found (or has 0 cards): ${arg}`);
    process.exit(1);
  }
  return [match];
}

async function refreshOne(prisma: PrismaClient, productId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      cards: {
        select: {
          id: true,
          cardNumber: true,
          playerName: true,
          variation: true,
        },
      },
    },
  });
  if (!product) throw new Error("product not found");
  if (product.cards.length === 0) {
    console.log(`  (no cards — skip)`);
    return { hits: 0, total: 0 };
  }

  const start = Date.now();
  const results = await fetchCardValues({
    productName: product.name,
    cards: product.cards.map((c) => ({
      cardId: c.id,
      cardNumber: c.cardNumber,
      playerName: c.playerName,
      variation: c.variation,
    })),
  });
  const apiMs = Date.now() - start;

  // Write in batches of 50 — same as the Vercel route.
  const now = new Date();
  const BATCH = 50;
  for (let i = 0; i < results.length; i += BATCH) {
    const slice = results.slice(i, i + BATCH);
    await prisma.$transaction(
      slice.map((r) =>
        prisma.card.update({
          where: { id: r.cardId },
          data: {
            marketValueCents: r.medianCents,
            marketSampleSize: r.sampleSize,
            marketObservedAt: now,
          },
        }),
      ),
    );
  }
  await prisma.product.update({
    where: { id: productId },
    data: { lastMarketRefreshAt: now },
  });

  const hits = results.filter((r) => r.medianCents != null).length;
  const totalCents = results.reduce(
    (s, r) => s + (r.medianCents ?? 0),
    0,
  );
  const avgCents = hits > 0 ? Math.round(totalCents / hits) : 0;
  console.log(
    `  ${results.length} cards · ${hits} hits (${Math.round(
      (hits / results.length) * 100,
    )}%) · avg $${(avgCents / 100).toFixed(2)} · ${(apiMs / 1000).toFixed(1)}s`,
  );
  return { hits, total: results.length };
}

async function main() {
  const prisma = new PrismaClient();
  const provider = activeMarketProvider();
  if (!provider) {
    console.error(
      "No market provider configured — set PRICECHARTING_TOKEN or EBAY_APP_ID/EBAY_CERT_ID",
    );
    process.exit(1);
  }
  console.log(
    `Provider: ${marketProviderLabel(provider)}   DB: ${process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] ?? "(unknown)"}\n`,
  );

  const arg = process.argv[2];
  const products = await pickProducts(prisma, arg);
  console.log(`Refreshing ${products.length} product(s):\n`);

  let totalHits = 0;
  let totalCards = 0;
  for (const p of products) {
    console.log(`→ ${p.name} (${p.cardCount} cards)`);
    try {
      const r = await refreshOne(prisma, p.id);
      totalHits += r.hits;
      totalCards += r.total;
    } catch (err) {
      console.warn(
        `  failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  console.log(
    `\nTotal: ${totalHits}/${totalCards} cards matched (${
      totalCards > 0 ? Math.round((totalHits / totalCards) * 100) : 0
    }%)`,
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
