import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { CURRENT_USER_ID } from "@/lib/user";

export async function GET() {
  const mixers = await prisma.mixer.findMany({
    where: { userId: CURRENT_USER_ID },
    orderBy: { createdAt: "desc" },
    include: {
      products: { include: { product: { select: { id: true, name: true, sport: true } } } },
      _count: { select: { products: true } },
    },
  });
  return NextResponse.json(mixers);
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    name?: string;
    breakerHandle?: string | null;
    boxPriceCents?: number | null;
    productIds?: string[];
  };
  if (!body.name || !body.name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!body.productIds || !Array.isArray(body.productIds) || body.productIds.length < 2) {
    return NextResponse.json(
      { error: "pick at least 2 products to mix" },
      { status: 400 },
    );
  }
  // Validate product IDs exist
  const found = await prisma.product.findMany({
    where: { id: { in: body.productIds } },
    select: { id: true },
  });
  if (found.length !== body.productIds.length) {
    return NextResponse.json(
      { error: "one or more product ids are unknown" },
      { status: 400 },
    );
  }
  const mixer = await prisma.mixer.create({
    data: {
      userId: CURRENT_USER_ID,
      name: body.name.trim(),
      breakerHandle: body.breakerHandle?.trim() || null,
      boxPriceCents: body.boxPriceCents ?? null,
      products: {
        create: body.productIds.map((id) => ({ productId: id })),
      },
    },
  });
  return NextResponse.json(mixer, { status: 201 });
}
