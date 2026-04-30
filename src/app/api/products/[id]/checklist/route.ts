import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseChecklist } from "@/lib/csv";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json()) as { csv?: string; replace?: boolean };
  if (!body.csv) {
    return NextResponse.json({ error: "csv is required" }, { status: 400 });
  }

  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) {
    return NextResponse.json({ error: "product not found" }, { status: 404 });
  }

  const rows = parseChecklist(body.csv);
  if (rows.length === 0) {
    return NextResponse.json(
      {
        error:
          "no rows parsed — make sure your CSV has Team, Player, and Card # columns",
      },
      { status: 400 },
    );
  }

  await prisma.$transaction(async (tx) => {
    if (body.replace) {
      await tx.card.deleteMany({ where: { productId: id } });
    }
    await tx.card.createMany({
      data: rows.map((r) => ({
        productId: id,
        team: r.team,
        playerName: r.playerName,
        cardNumber: r.cardNumber,
        variation: r.variation ?? null,
      })),
    });

    const teams = Array.from(new Set(rows.map((r) => r.team)));
    for (const team of teams) {
      await tx.teamPrice.upsert({
        where: { productId_team: { productId: id, team } },
        update: {},
        create: { productId: id, team },
      });
    }
  });

  return NextResponse.json({ added: rows.length }, { status: 201 });
}
