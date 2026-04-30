import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { pickSource } from "@/lib/sources/checklist";

export const maxDuration = 60;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json()) as { url?: string; replace?: boolean };
  if (!body.url) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) {
    return NextResponse.json({ error: "product not found" }, { status: 404 });
  }

  const picked = pickSource(body.url);
  if (!picked) {
    return NextResponse.json(
      {
        error:
          "no importer matches that URL — supported: Beckett (beckett.com) and Google Sheets",
      },
      { status: 400 },
    );
  }

  let result;
  try {
    result = await picked.source.importFrom(picked.url);
  } catch (err) {
    const message = err instanceof Error ? err.message : "import failed";
    return NextResponse.json(
      { error: `${picked.source.label}: ${message}` },
      { status: 502 },
    );
  }

  await prisma.$transaction(async (tx) => {
    if (body.replace) {
      await tx.card.deleteMany({ where: { productId: id } });
    }
    await tx.card.createMany({
      data: result.rows.map((r) => ({
        productId: id,
        team: r.team,
        playerName: r.playerName,
        cardNumber: r.cardNumber,
        variation: r.variation ?? null,
      })),
    });
    const teams = Array.from(new Set(result.rows.map((r) => r.team)));
    for (const team of teams) {
      await tx.teamPrice.upsert({
        where: { productId_team: { productId: id, team } },
        update: {},
        create: { productId: id, team },
      });
    }
  });

  return NextResponse.json(
    {
      added: result.rows.length,
      source: picked.source.id,
      sourceUrl: result.sourceUrl,
      teams: Array.from(new Set(result.rows.map((r) => r.team))).length,
      notes: result.notes,
    },
    { status: 201 },
  );
}
