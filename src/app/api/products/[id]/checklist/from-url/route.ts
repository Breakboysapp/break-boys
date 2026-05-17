import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import { pickSource } from "@/lib/sources/checklist";
import {
  buildCanonicalMap,
  canonicalize,
} from "@/lib/player-name-normalize";

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

  // Snapshot the existing canonical player-name spellings before
  // the import. For each incoming row, if a canonical form already
  // exists for the lowercased name, use it — otherwise the new
  // spelling becomes the canonical going forward. Prevents future
  // case-collision dupes ("LeBron James" vs "Lebron James") from
  // creeping back in via fresh imports.
  const canonicalMap = await buildCanonicalMap(prisma);

  // Run the heavy work OUTSIDE Prisma's default transaction (5s
  // timeout). A Beckett checklist of ~1000 cards + ~30 team upserts
  // serially would routinely tip past that — surfaced as a silent
  // 500 on the Hoops import. With an explicit timeout, we can fit
  // up to 30s of DB work inside one consistent transaction; that's
  // ample headroom even for the largest checklists we've seen
  // (2025 Bowman Draft at 7k+ rows).
  await prisma.$transaction(
    async (tx) => {
      if (body.replace) {
        await tx.card.deleteMany({ where: { productId: id } });
      }
      await tx.card.createMany({
        data: result.rows.map((r) => ({
          productId: id,
          team: r.team,
          playerName: canonicalize(r.playerName, canonicalMap),
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
    },
    { timeout: 30_000, maxWait: 5_000 },
  );

  // Bust the cached product detail + global product list so the
  // newly-imported cards show up immediately instead of waiting
  // for the 1-hour TTL.
  revalidateTag(`product-${id}`);
  revalidateTag("products");

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
