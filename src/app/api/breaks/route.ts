import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { CURRENT_USER_ID } from "@/lib/user";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    productId?: string;
    teamsOwned?: string[];
  };
  if (!body.productId || !Array.isArray(body.teamsOwned)) {
    return NextResponse.json(
      { error: "productId and teamsOwned[] are required" },
      { status: 400 },
    );
  }
  const product = await prisma.product.findUnique({
    where: { id: body.productId },
  });
  if (!product) {
    return NextResponse.json({ error: "product not found" }, { status: 404 });
  }

  const existing = await prisma.userBreak.findFirst({
    where: { userId: CURRENT_USER_ID, productId: body.productId },
  });

  const teamsJson = JSON.stringify(body.teamsOwned);
  const userBreak = existing
    ? await prisma.userBreak.update({
        where: { id: existing.id },
        data: { teamsOwned: teamsJson },
      })
    : await prisma.userBreak.create({
        data: {
          userId: CURRENT_USER_ID,
          productId: body.productId,
          teamsOwned: teamsJson,
        },
      });

  return NextResponse.json(userBreak, { status: 201 });
}
