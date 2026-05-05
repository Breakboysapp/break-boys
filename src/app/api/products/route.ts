import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { detectManufacturer } from "@/lib/manufacturer";
import { defaultFormatsForProduct } from "@/lib/product-formats-defaults";

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

  // Auto-seed box formats based on the product's name. Without this,
  // every new product would land with an empty format list and the
  // user would have to fill it in manually — which they won't. The
  // heuristic in src/lib/product-formats-defaults.ts maps common
  // brand patterns (Bowman Draft, Topps Chrome, etc.) to their
  // canonical format sets; a terminal fallback ensures every product
  // gets at least a "Hobby" entry.
  const templates = defaultFormatsForProduct(name);
  if (templates.length > 0) {
    await prisma.productFormat.createMany({
      data: templates.map((t, i) => ({
        productId: product.id,
        name: t.name,
        packsPerBox: t.packsPerBox,
        cardsPerPack: t.cardsPerPack,
        autosPerBox: t.autosPerBox,
        notes: t.notes,
        position: i,
      })),
      skipDuplicates: true,
    });
  }

  return NextResponse.json(product, { status: 201 });
}
