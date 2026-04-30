import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ebayConfigured, fetchCardValues } from "@/lib/sources/pricing/ebayCards";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const ACTIVE_WINDOW_DAYS = 90;

function authorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return true;
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${expected}`;
}

/**
 * Daily cron: refresh per-card market values for every active product.
 * "Active" = released in the last 90 days OR undated. Skips products with
 * no cards. Same gate (CRON_SECRET) as the team-level refresh route.
 */
async function refreshAll() {
  const cutoff = new Date(Date.now() - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const products = await prisma.product.findMany({
    where: {
      OR: [{ releaseDate: { gte: cutoff } }, { releaseDate: null }],
    },
    include: {
      cards: { select: { id: true, cardNumber: true, playerName: true } },
    },
  });

  const summary: Array<{
    productId: string;
    productName: string;
    cards: number;
    withValue: number;
    skipped?: string;
  }> = [];

  for (const product of products) {
    if (product.cards.length === 0) {
      summary.push({
        productId: product.id,
        productName: product.name,
        cards: 0,
        withValue: 0,
        skipped: "no cards",
      });
      continue;
    }
    try {
      const results = await fetchCardValues({
        productName: product.name,
        cards: product.cards.map((c) => ({
          cardId: c.id,
          cardNumber: c.cardNumber,
          playerName: c.playerName,
        })),
      });
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
        where: { id: product.id },
        data: { lastMarketRefreshAt: now },
      });
      summary.push({
        productId: product.id,
        productName: product.name,
        cards: results.length,
        withValue: results.filter((r) => r.medianCents != null).length,
      });
    } catch (err) {
      summary.push({
        productId: product.id,
        productName: product.name,
        cards: product.cards.length,
        withValue: 0,
        skipped: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return summary;
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!ebayConfigured()) {
    return NextResponse.json(
      {
        error:
          "eBay credentials not configured — set EBAY_APP_ID and EBAY_CERT_ID env vars",
      },
      { status: 503 },
    );
  }
  const summary = await refreshAll();
  return NextResponse.json({
    productsProcessed: summary.length,
    refreshedAt: new Date().toISOString(),
    summary,
  });
}

export async function GET(request: Request) {
  return POST(request);
}
