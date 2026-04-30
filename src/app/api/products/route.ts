import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { detectManufacturer } from "@/lib/manufacturer";

export async function GET() {
  const products = await prisma.product.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { cards: true } } },
  });
  return NextResponse.json(products);
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    name?: string;
    sport?: string;
    manufacturer?: string | null;
    releaseDate?: string | null;
  };
  if (!body.name || !body.sport) {
    return NextResponse.json({ error: "name and sport are required" }, { status: 400 });
  }
  const name = body.name.trim();
  // If the caller didn't supply a manufacturer, auto-detect from the name.
  // Topps / Bowman / Panini / etc. are baked into manufacturer.ts so the
  // home-page chip filter always has a value to match.
  const manufacturer =
    body.manufacturer === undefined
      ? detectManufacturer(name)
      : body.manufacturer || null;
  const product = await prisma.product.create({
    data: {
      name,
      sport: body.sport.trim(),
      manufacturer,
      releaseDate: body.releaseDate ? new Date(body.releaseDate) : null,
    },
  });
  return NextResponse.json(product, { status: 201 });
}
