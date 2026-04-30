import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ebayConfigured, fetchCardValues } from "@/lib/sources/pricing/ebayCards";

// Per-card eBay queries are slow (~220ms × N cards). Allow up to 5 minutes.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return true;
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${expected}`;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!ebayConfigured()) {
    return NextResponse.json(
      {
        error:
          "eBay credentials not configured — set EBAY_APP_ID and EBAY_CERT_ID env vars (see README)",
      },
      { status: 503 },
    );
  }
  const { id } = await params;
  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      cards: {
        select: { id: true, cardNumber: true, playerName: true },
      },
    },
  });
  if (!product) {
    return NextResponse.json({ error: "product not found" }, { status: 404 });
  }
  if (product.cards.length === 0) {
    return NextResponse.json(
      { error: "no cards on the checklist yet — upload one first" },
      { status: 400 },
    );
  }

  let results;
  try {
    results = await fetchCardValues({
      productName: product.name,
      cards: product.cards.map((c) => ({
        cardId: c.id,
        cardNumber: c.cardNumber,
        playerName: c.playerName,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "refresh failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const now = new Date();
  let updated = 0;
  let nullified = 0;
  // Batched updates for SQLite performance.
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
    for (const r of slice) {
      if (r.medianCents != null) updated++;
      else nullified++;
    }
  }

  await prisma.product.update({
    where: { id },
    data: { lastMarketRefreshAt: now },
  });

  const totalSamples = results.reduce((s, r) => s + r.sampleSize, 0);
  return NextResponse.json({
    productId: id,
    productName: product.name,
    cardsQueried: results.length,
    cardsWithValue: updated,
    cardsThinMarket: nullified,
    totalSamples,
    refreshedAt: now.toISOString(),
  });
}
