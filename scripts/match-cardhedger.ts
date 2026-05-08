/**
 * Match Card rows to Card Hedger card_ids via /v1/cards/card-match.
 *
 *   # dry run (default) against 2026 Bowman, prints summary only
 *   npx tsx scripts/match-cardhedger.ts
 *
 *   # different product
 *   npx tsx scripts/match-cardhedger.ts --product=cmovk5wqo0000py46iywkseo8
 *
 *   # try only the first 25 cards
 *   npx tsx scripts/match-cardhedger.ts --limit=25
 *
 *   # actually persist cardHedgerId / matchedAt / confidence (REQUIRES
 *   # the schema migration to have applied to the DB this script
 *   # connects to via DATABASE_URL)
 *   npx tsx scripts/match-cardhedger.ts --write
 *
 * Variant-aware query construction: each card's CH query includes
 * player + year/set (with the sport suffix stripped — CH's matcher
 * treated "Baseball"/"Football" as noise in earlier probes) +
 * `#cardNumber` + the variation. That keeps parallels and inserts
 * resolving to their actual CH catalog entry instead of getting
 * collapsed onto the base card.
 *
 * Confidence policy:
 *   ≥ 0.9  → strong match, save
 *   0.7-0.89 → save but flag for review
 *   < 0.7  → log + skip; revisit on the next run as CH's catalog
 *            tightens up
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { matchCard } from "../src/lib/sources/pricing/cardhedger";

function ensureEnvLoaded(): void {
  if (process.env.CARD_HEDGER_API) return;
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
      if (!m) continue;
      const [, k, v] = m;
      if (process.env[k] != null) continue;
      process.env[k] = v.replace(/^["'](.*)["']$/, "$1");
    }
  } catch {
    /* ignore */
  }
}
ensureEnvLoaded();

const prisma = new PrismaClient();

const SPORT_SUFFIXES = /\s+(Baseball|Football|Basketball|Hockey|Soccer)$/i;

const CONFIDENCE_KEEP = 0.7;
const CONFIDENCE_STRONG = 0.9;
const PER_REQUEST_DELAY_MS = 200; // 5 req/sec ceiling

type Args = {
  productId?: string;
  productName?: string;
  limit?: number;
  write: boolean;
};

function parseArgs(): Args {
  const out: Args = { write: false };
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--product=")) out.productId = arg.slice(10);
    else if (arg.startsWith("--name=")) out.productName = arg.slice(7);
    else if (arg.startsWith("--limit=")) out.limit = Number(arg.slice(8));
    else if (arg === "--write") out.write = true;
  }
  return out;
}

const CATEGORY_FOR_SPORT: Record<string, string | undefined> = {
  MLB: "Baseball",
  NBA: "Basketball",
  NFL: "Football",
  NHL: "Hockey",
};

function buildQuery(card: {
  productName: string;
  cardNumber: string;
  playerName: string;
  variation: string | null;
}): string {
  const setName = card.productName.replace(SPORT_SUFFIXES, "").trim();
  return [
    card.playerName,
    setName,
    `#${card.cardNumber}`,
    card.variation,
  ]
    .filter(Boolean)
    .join(" ");
}

async function main() {
  if (!process.env.CARD_HEDGER_API) {
    console.error("CARD_HEDGER_API not set in .env — bailing.");
    process.exit(1);
  }
  const args = parseArgs();

  // Resolve product
  const product = args.productId
    ? await prisma.product.findUnique({ where: { id: args.productId } })
    : await prisma.product.findFirst({
        where: {
          name: {
            contains: args.productName ?? "2026 Bowman Baseball",
            mode: "insensitive",
          },
        },
      });
  if (!product) {
    console.error("No product found for the given filter.");
    process.exit(1);
  }
  console.log(`Product: ${product.name}  sport=${product.sport}`);
  console.log(`Mode:    ${args.write ? "WRITE" : "DRY RUN (no DB writes)"}`);

  // Pull cards. For dry run we read all; for write mode we'd typically
  // skip already-matched cards, but that field doesn't exist yet (the
  // migration hasn't applied), so we read everything and rely on
  // dry-run defaulting on.
  const cards = await prisma.card.findMany({
    where: { productId: product.id },
    select: {
      id: true,
      cardNumber: true,
      playerName: true,
      variation: true,
    },
    orderBy: { cardNumber: "asc" },
    take: args.limit,
  });
  console.log(`Cards to match: ${cards.length}\n`);

  const category = CATEGORY_FOR_SPORT[product.sport];
  let strong = 0;
  let weak = 0;
  let miss = 0;
  let error = 0;
  const samples: Array<{
    cardNumber: string;
    playerName: string;
    confidence: number;
    matched: string | null;
    reasoning: string | null;
  }> = [];

  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    process.stdout.write(
      `\r  Matching ${i + 1}/${cards.length}: ${c.playerName.slice(0, 28).padEnd(28)} `,
    );
    try {
      const query = buildQuery({ ...c, productName: product.name });
      const m = await matchCard({ query, category });
      if (m.cardId == null) {
        miss++;
      } else if (m.confidence >= CONFIDENCE_STRONG) {
        strong++;
      } else if (m.confidence >= CONFIDENCE_KEEP) {
        weak++;
      } else {
        miss++;
      }
      // Keep first 5 of each tier as samples for the report.
      if (samples.length < 30) {
        samples.push({
          cardNumber: c.cardNumber,
          playerName: c.playerName,
          confidence: m.confidence,
          matched: m.description,
          reasoning: m.reasoning,
        });
      }

      if (args.write && m.cardId && m.confidence >= CONFIDENCE_KEEP) {
        // Note: this will throw until the cardHedger* columns exist
        // on the Card model. The dry-run default protects against
        // running this prematurely.
        await prisma.card.update({
          where: { id: c.id },
          data: {
            cardHedgerId: m.cardId,
            cardHedgerMatchedAt: new Date(),
            cardHedgerConfidence: m.confidence,
            cardHedgerReasoning: m.reasoning?.slice(0, 1000) ?? null,
          } as never, // cast until prisma client regenerates
        });
      }
    } catch (e) {
      error++;
      console.warn(
        `\n    ${c.cardNumber} ${c.playerName} failed: ${e instanceof Error ? e.message : e}`,
      );
    }
    await new Promise((r) => setTimeout(r, PER_REQUEST_DELAY_MS));
  }
  console.log("\n");

  console.log("=== Summary ===");
  console.log(`  Strong (conf ≥ 0.9):  ${strong} / ${cards.length}`);
  console.log(`  Weak   (0.7-0.89):    ${weak}`);
  console.log(`  Miss   (< 0.7):       ${miss}`);
  console.log(`  Errors:               ${error}`);
  console.log(
    `  Match rate (≥ 0.7):   ${(((strong + weak) / cards.length) * 100).toFixed(1)}%`,
  );

  console.log("\n=== Sample matches (first 30) ===");
  for (const s of samples) {
    const tier =
      s.confidence >= CONFIDENCE_STRONG
        ? "STRONG"
        : s.confidence >= CONFIDENCE_KEEP
          ? "weak  "
          : "miss  ";
    console.log(
      `  ${tier}  conf=${s.confidence.toFixed(2)}  #${s.cardNumber.padEnd(8)}  ${s.playerName.padEnd(28)}  → ${s.matched ?? "(no match)"}`,
    );
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
