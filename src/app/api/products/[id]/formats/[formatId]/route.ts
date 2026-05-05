/**
 * Per-format PATCH (rename, edit fields) and DELETE (remove).
 *
 * PATCH accepts a partial body — only the fields actually present
 * get updated, so the inline editor on the product page can save
 * single-field changes without sending the whole row.
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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; formatId: string }> },
) {
  const { id, formatId } = await params;
  const body = (await request.json()) as Body;

  // Only include fields that were actually sent so we don't overwrite
  // existing values with null when the client sent a partial.
  const data: Body = {};
  if (body.name != null) data.name = body.name.trim();
  if ("packsPerBox" in body) data.packsPerBox = body.packsPerBox;
  if ("cardsPerPack" in body) data.cardsPerPack = body.cardsPerPack;
  if ("autosPerBox" in body) data.autosPerBox = body.autosPerBox;
  if ("notes" in body) data.notes = body.notes;
  if ("position" in body) data.position = body.position;

  try {
    const updated = await prisma.productFormat.update({
      where: { id: formatId, productId: id },
      data,
    });
    return NextResponse.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : "update failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; formatId: string }> },
) {
  const { id, formatId } = await params;
  await prisma.productFormat
    .delete({ where: { id: formatId, productId: id } })
    .catch(() => {
      // P2025: not found — already deleted.
    });
  return NextResponse.json({ deleted: true });
}
