/**
 * Favorite / unfavorite a product for the current user.
 *
 *   POST   /api/products/<id>/favorite  → mark favorited (idempotent)
 *   DELETE /api/products/<id>/favorite  → un-favorite
 *
 * Stores in UserFavoriteProduct keyed on (userId, productId). Until real
 * auth lands the userId stays as the "local" stub from src/lib/user.ts —
 * same pattern used by UserBreak / UserCard. After auth flips on, the
 * data already exists keyed on the right column and just starts being
 * scoped to the real user.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { CURRENT_USER_ID } from "@/lib/user";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // Idempotent: upsert so repeated POSTs don't error on the unique
  // (userId, productId) constraint.
  const fav = await prisma.userFavoriteProduct.upsert({
    where: { userId_productId: { userId: CURRENT_USER_ID, productId: id } },
    update: {},
    create: { userId: CURRENT_USER_ID, productId: id },
  });
  return NextResponse.json({ favorited: true, id: fav.id });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  await prisma.userFavoriteProduct
    .delete({
      where: { userId_productId: { userId: CURRENT_USER_ID, productId: id } },
    })
    .catch(() => {
      // P2025: record not found — already not favorited. No-op.
    });
  return NextResponse.json({ favorited: false });
}
