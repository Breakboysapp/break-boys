import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSource } from "@/lib/sources";
import type { SyncResult } from "@/lib/sources/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return true;
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${expected}`;
}

async function runSync(slug: string): Promise<SyncResult> {
  const provider = getSource(slug);
  if (!provider) {
    throw new Response(JSON.stringify({ error: `unknown provider: ${slug}` }), {
      status: 404,
    });
  }

  const items = await provider.fetch();
  const result: SyncResult = {
    fetched: items.length,
    created: 0,
    updated: 0,
    skipped: 0,
    warnings: [],
  };

  for (const item of items) {
    if (!item.sport) {
      result.skipped++;
      result.warnings.push(`Skipped (no sport detected): ${item.name}`);
      continue;
    }

    // Lookup pass 1: native (source, externalId) — fast path for products
    // this provider previously created.
    let existing = await prisma.product.findUnique({
      where: {
        source_externalId: { source: provider.id, externalId: item.externalId },
      },
    });

    // Lookup pass 2: name + sport. Catches the case where a product was
    // hand-seeded (source="manual") and the cron then sees an article
    // about the same product. Without this fallback, the cron would
    // create a shadow row every time it runs — exactly the duplicate
    // bug that was surfacing as "Coming Soon" tiles next to populated
    // ones with the same name.
    if (!existing) {
      existing = await prisma.product.findFirst({
        where: { name: item.name, sport: item.sport },
      });
      if (existing) {
        result.warnings.push(
          `Adopted manual product: ${item.name} (was source="${existing.source}")`,
        );
      }
    }

    if (existing) {
      await prisma.product.update({
        where: { id: existing.id },
        data: {
          name: item.name,
          sport: item.sport,
          manufacturer: item.manufacturer ?? existing.manufacturer,
          releaseDate: item.releaseDate ?? existing.releaseDate,
          // Adopt the provider's externalId on the existing row so the
          // next sync hits pass 1 instead of pass 2. Stamp the source
          // too so the row's provenance is no longer "manual" if the
          // provider is now keeping it fresh.
          source: provider.id,
          externalId: item.externalId,
        },
      });
      result.updated++;
    } else {
      await prisma.product.create({
        data: {
          name: item.name,
          sport: item.sport,
          manufacturer: item.manufacturer,
          releaseDate: item.releaseDate,
          source: provider.id,
          externalId: item.externalId,
        },
      });
      result.created++;
    }
  }

  return result;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { provider } = await params;
  try {
    const result = await runSync(provider);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Response) return err;
    const message = err instanceof Error ? err.message : "sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Vercel Cron hits the scheduled URL with GET and an Authorization header.
export async function GET(request: Request, ctx: { params: Promise<{ provider: string }> }) {
  return POST(request, ctx);
}
