import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ebayConfigured, fetchValueIndexes } from "@/lib/sources/pricing/ebay";

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
 * Refresh value indexes for every "active" product — released in the last
 * 90 days, or undated (still upcoming). Skips products with no teams.
 *
 * Hooked to a Vercel Cron in vercel.json. Use CRON_SECRET to protect.
 */
async function refreshAll() {
  const cutoff = new Date(Date.now() - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const products = await prisma.product.findMany({
    where: {
      OR: [{ releaseDate: { gte: cutoff } }, { releaseDate: null }],
    },
    include: { teamPrices: true },
  });

  const summary: Array<{
    productId: string;
    productName: string;
    teams: number;
    samples: number;
    skipped?: string;
  }> = [];

  for (const product of products) {
    if (product.teamPrices.length === 0) {
      summary.push({
        productId: product.id,
        productName: product.name,
        teams: 0,
        samples: 0,
        skipped: "no teams",
      });
      continue;
    }
    const teams = product.teamPrices.map((p) => p.team);
    try {
      const indexes = await fetchValueIndexes({ productName: product.name, teams });
      const now = new Date();
      await prisma.$transaction(
        indexes.map((r) =>
          prisma.teamPrice.update({
            where: { productId_team: { productId: product.id, team: r.team } },
            data: {
              valueIndexCents: r.valueIndexCents,
              indexSampleSize: r.sampleSize,
              lastIndexedAt: now,
            },
          }),
        ),
      );
      summary.push({
        productId: product.id,
        productName: product.name,
        teams: indexes.length,
        samples: indexes.reduce((s, r) => s + r.sampleSize, 0),
      });
    } catch (err) {
      summary.push({
        productId: product.id,
        productName: product.name,
        teams: product.teamPrices.length,
        samples: 0,
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

// Vercel Cron uses GET with the Authorization header.
export async function GET(request: Request) {
  return POST(request);
}
