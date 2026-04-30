import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { CURRENT_USER_ID } from "@/lib/user";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json()) as {
    name?: string;
    breakerHandle?: string | null;
    boxPriceCents?: number | null;
    productIds?: string[];
  };
  const mixer = await prisma.mixer.findUnique({ where: { id } });
  if (!mixer) {
    return NextResponse.json({ error: "mixer not found" }, { status: 404 });
  }
  await prisma.mixer.update({
    where: { id },
    data: {
      ...(body.name !== undefined ? { name: body.name.trim() } : {}),
      ...(body.breakerHandle !== undefined
        ? { breakerHandle: body.breakerHandle?.trim() || null }
        : {}),
      ...(body.boxPriceCents !== undefined
        ? { boxPriceCents: body.boxPriceCents }
        : {}),
    },
  });
  if (body.productIds && Array.isArray(body.productIds)) {
    if (body.productIds.length < 2) {
      return NextResponse.json(
        { error: "pick at least 2 products to mix" },
        { status: 400 },
      );
    }
    // Replace the product set
    await prisma.mixerProduct.deleteMany({ where: { mixerId: id } });
    await prisma.mixerProduct.createMany({
      data: body.productIds.map((pid) => ({ mixerId: id, productId: pid })),
    });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  await prisma.mixer.delete({ where: { id } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
