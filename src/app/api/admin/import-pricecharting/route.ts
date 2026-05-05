/**
 * Admin endpoint: import a PriceCharting / SportsCardsPro set into the
 * current database. Pulls the same data the CLI script does
 * (scripts/import-pricecharting-set.ts) but runs from inside the Next.js
 * runtime so it can be triggered from a deployed environment without
 * shell access to the box.
 *
 * Auth: gated behind ADMIN_SECRET. Set the secret as a Vercel env var
 * (Preview + Development scopes) so the staging URL can be triggered
 * but production is never accidentally hit by the same key.
 *
 *   POST /api/admin/import-pricecharting?secret=<ADMIN_SECRET>&slug=<set-slug>
 *
 * The body of the response is the import summary — it streams as plain
 * text so the user can see progress in the browser without a custom
 * client.
 *
 * Refuses to run when DATABASE_URL points at the known prod host —
 * staging-only by design.
 */
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import {
  fetchConsoleProducts,
  fetchPopRows,
  parseProductName,
  type PCPopRow,
} from "@/lib/sources/pricing/pricecharting-console";

// Inline copy of the CLI script's slug→meta map. Keeping these in sync
// is a manual chore for now; if we add a third place that needs this,
// extract to src/lib/sources/pricing/slug-overrides.ts.
const SLUG_OVERRIDES: Record<
  string,
  { name: string; sport: string; manufacturer: string }
> = {
  "baseball-cards-2025-topps-chrome": {
    name: "2025 Topps Chrome Baseball",
    sport: "MLB",
    manufacturer: "Topps",
  },
  "football-cards-2024-topps-chrome": {
    name: "2024 Topps Chrome Football",
    sport: "NFL",
    manufacturer: "Topps",
  },
  "football-cards-2025-topps-chrome": {
    name: "2025 Topps Chrome Football",
    sport: "NFL",
    manufacturer: "Topps",
  },
};

function deriveProductMeta(slug: string) {
  const o = SLUG_OVERRIDES[slug];
  if (o) return o;
  let sport = "Other";
  if (slug.startsWith("baseball-")) sport = "MLB";
  else if (slug.startsWith("football-")) sport = "NFL";
  else if (slug.startsWith("basketball-")) sport = "NBA";
  else if (slug.startsWith("hockey-")) sport = "NHL";
  return { name: slug, sport, manufacturer: "Topps" };
}

const PROD_HOST = "ep-winter-shadow-aklqd4xs-pooler";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes — full set import takes ~3 minutes

export async function POST(req: NextRequest) {
  // Auth.
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");
  const expected = process.env.ADMIN_SECRET;
  if (!expected || secret !== expected) {
    return new Response("forbidden", { status: 403 });
  }

  const slug = url.searchParams.get("slug") ?? "baseball-cards-2025-topps-chrome";

  // Hard-stop if we're somehow pointed at prod.
  if ((process.env.DATABASE_URL ?? "").includes(PROD_HOST)) {
    return new Response(
      "refusing to run import: DATABASE_URL points at the prod host",
      { status: 403 },
    );
  }

  // Stream plain-text progress lines so the browser shows them as they
  // happen. The set-import takes a few minutes; a no-feedback request
  // looks frozen.
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (s: string) => controller.enqueue(encoder.encode(s + "\n"));
      try {
        send(`Slug: ${slug}`);
        send(`Mode: APPLY (server-side import)`);
        send("");

        send("[1/3] Fetching pop report…");
        let popRows: PCPopRow[] = [];
        try {
          popRows = await fetchPopRows(slug);
          send(`      ${popRows.length} pop rows.`);
        } catch (err) {
          send(
            `      pop fetch failed (continuing without pop data): ${
              err instanceof Error ? err.message : err
            }`,
          );
        }
        const popByLabel = new Map<string, PCPopRow>();
        for (const r of popRows) popByLabel.set(r.cardLabel, r);

        send("[2/3] Fetching console listing…");
        const { products: consoleRows } = await fetchConsoleProducts(slug);
        send(`      ${consoleRows.length} cards.`);

        send("[3/3] Writing to DB…");
        const meta = deriveProductMeta(slug);
        const prisma = new PrismaClient();
        const product = await prisma.product.upsert({
          where: {
            source_externalId: { source: "api:pricecharting", externalId: slug },
          },
          create: {
            name: meta.name,
            sport: meta.sport,
            manufacturer: meta.manufacturer,
            source: "api:pricecharting",
            externalId: slug,
            releaseStatus: "released",
          },
          update: {},
        });
        send(`      Product: ${product.name} (${product.id})`);

        let created = 0;
        let updated = 0;
        let skipped = 0;
        const now = new Date();

        for (const c of consoleRows) {
          const parsed = parseProductName(c.productName);
          if (!parsed.playerName || !parsed.cardNumber) {
            skipped++;
            continue;
          }
          const pop = popByLabel.get(c.productName);
          const existing = await prisma.card.findUnique({
            where: { pricechartingId: c.id },
            select: { id: true },
          });
          const data = {
            productId: product.id,
            playerName: parsed.playerName,
            cardNumber: parsed.cardNumber,
            variation: parsed.variation,
            pricechartingId: c.id,
            ungradedCents: c.ungradedCents,
            psa10Cents: c.psa10Cents,
            psa9Cents: c.psa9Cents,
            printRun: c.printRun || null,
            imageUrl: c.imageUri || null,
            pricesUpdatedAt: now,
            popG6: pop?.popG6 ?? null,
            popG7: pop?.popG7 ?? null,
            popG8: pop?.popG8 ?? null,
            popG9: pop?.popG9 ?? null,
            popG10: pop?.popG10 ?? null,
            popTotal: pop?.popTotal ?? null,
            popUpdatedAt: pop ? now : null,
          };
          if (existing) {
            await prisma.card.update({
              where: { id: existing.id },
              // Don't clobber team — user may have set it via a CSV upload.
              data,
            });
            updated++;
          } else {
            await prisma.card.create({
              data: { ...data, team: "—" },
            });
            created++;
          }
          // Periodic heartbeat so the user can see progress.
          if ((created + updated) % 250 === 0) {
            send(
              `      …${created} created, ${updated} updated, ${skipped} skipped`,
            );
          }
        }
        await prisma.$disconnect();
        send("");
        send(
          `Done. created=${created} updated=${updated} skipped=${skipped}`,
        );
        controller.close();
      } catch (err) {
        send(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
