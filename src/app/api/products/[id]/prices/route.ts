import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type PriceUpdate = {
  team: string;
  wholesaleCents: number | null;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json()) as { prices?: PriceUpdate[] };
  if (!body.prices || !Array.isArray(body.prices)) {
    return NextResponse.json({ error: "prices array is required" }, { status: 400 });
  }

  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) {
    return NextResponse.json({ error: "product not found" }, { status: 404 });
  }

  await prisma.$transaction(
    body.prices.map((p) =>
      prisma.teamPrice.upsert({
        where: { productId_team: { productId: id, team: p.team } },
        update: { wholesaleCents: p.wholesaleCents },
        create: {
          productId: id,
          team: p.team,
          wholesaleCents: p.wholesaleCents,
        },
      }),
    ),
  );

  return NextResponse.json({ updated: body.prices.length });
}
