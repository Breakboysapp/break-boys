import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json()) as {
    name?: string;
    sport?: string;
    manufacturer?: string | null;
    releaseDate?: string | null;
    boxPriceCents?: number | null;
  };

  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) {
    return NextResponse.json({ error: "product not found" }, { status: 404 });
  }

  const updated = await prisma.product.update({
    where: { id },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.sport !== undefined ? { sport: body.sport } : {}),
      ...(body.manufacturer !== undefined ? { manufacturer: body.manufacturer } : {}),
      ...(body.releaseDate !== undefined
        ? { releaseDate: body.releaseDate ? new Date(body.releaseDate) : null }
        : {}),
      ...(body.boxPriceCents !== undefined
        ? { boxPriceCents: body.boxPriceCents }
        : {}),
    },
  });

  return NextResponse.json(updated);
}
