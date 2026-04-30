import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { CURRENT_USER_ID } from "@/lib/user";

const VALID_STATUSES = new Set(["owned", "want", "looking_for"]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json()) as { status?: string | null };

  const card = await prisma.card.findUnique({ where: { id } });
  if (!card) {
    return NextResponse.json({ error: "card not found" }, { status: 404 });
  }

  if (body.status === null || body.status === undefined || body.status === "") {
    await prisma.userCard
      .delete({ where: { userId_cardId: { userId: CURRENT_USER_ID, cardId: id } } })
      .catch(() => {});
    return NextResponse.json({ status: null });
  }

  if (!VALID_STATUSES.has(body.status)) {
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }

  const userCard = await prisma.userCard.upsert({
    where: { userId_cardId: { userId: CURRENT_USER_ID, cardId: id } },
    update: { status: body.status },
    create: { userId: CURRENT_USER_ID, cardId: id, status: body.status },
  });
  return NextResponse.json(userCard);
}
