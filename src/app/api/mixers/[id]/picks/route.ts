import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { CURRENT_USER_ID } from "@/lib/user";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json()) as { teamsOwned?: string[] };
  if (!body.teamsOwned || !Array.isArray(body.teamsOwned)) {
    return NextResponse.json({ error: "teamsOwned[] required" }, { status: 400 });
  }
  const mixer = await prisma.mixer.findUnique({ where: { id } });
  if (!mixer) {
    return NextResponse.json({ error: "mixer not found" }, { status: 404 });
  }
  const teamsJson = JSON.stringify(body.teamsOwned);
  const pick = await prisma.mixerPick.upsert({
    where: { mixerId_userId: { mixerId: id, userId: CURRENT_USER_ID } },
    update: { teamsOwned: teamsJson },
    create: {
      mixerId: id,
      userId: CURRENT_USER_ID,
      teamsOwned: teamsJson,
    },
  });
  return NextResponse.json(pick, { status: 201 });
}
