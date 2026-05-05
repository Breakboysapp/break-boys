/**
 * Product format CRUD — POST creates, the parameterized route handles
 * PATCH/DELETE per format.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Body = {
  name?: string;
  packsPerBox?: number | null;
  cardsPerPack?: number | null;
  autosPerBox?: number | null;
  notes?: string | null;
  position?: number;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json()) as Body;
  const name = (body.name ?? "").trim();
  if (!name) {
    return NextResponse.json(
      { error: "name is required" },
      { status: 400 },
    );
  }

  // Position: append to the end by default — count existing formats
  // and use that as the new position so the row lands at the right.
  const existingCount = await prisma.productFormat.count({
    where: { productId: id },
  });

  try {
    const format = await prisma.productFormat.create({
      data: {
        productId: id,
        name,
        packsPerBox: body.packsPerBox ?? null,
        cardsPerPack: body.cardsPerPack ?? null,
        autosPerBox: body.autosPerBox ?? null,
        notes: body.notes ?? null,
        position: body.position ?? existingCount,
      },
    });
    return NextResponse.json(format);
  } catch (err) {
    // Most likely failure: unique (productId, name) — duplicate format.
    const message = err instanceof Error ? err.message : "create failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
