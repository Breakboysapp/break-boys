import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ebayConfigured, fetchValueIndexes } from "@/lib/sources/pricing/ebay";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return true;
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${expected}`;
}

async function refreshOne(productId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { teamPrices: true },
  });
  if (!product) return { error: "product not found" as const, status: 404 };
  if (product.teamPrices.length === 0) {
    return { error: "no teams on this product yet — upload a checklist first" as const, status: 400 };
  }

  const teams = product.teamPrices.map((p) => p.team);
  const indexes = await fetchValueIndexes({ productName: product.name, teams });

  const now = new Date();
  await prisma.$transaction(
    indexes.map((r) =>
      prisma.teamPrice.update({
        where: { productId_team: { productId, team: r.team } },
        data: {
          valueIndexCents: r.valueIndexCents,
          indexSampleSize: r.sampleSize,
          lastIndexedAt: now,
        },
      }),
    ),
  );

  return {
    productId,
    productName: product.name,
    teams: indexes.length,
    totalSamples: indexes.reduce((s, r) => s + r.sampleSize, 0),
    refreshedAt: now.toISOString(),
  };
}

/** POST /api/products/[id]/value-index/refresh — refresh one product. */
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
  try {
    const result = await refreshOne(id);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "refresh failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
