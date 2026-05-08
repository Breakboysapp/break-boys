/**
 * Coverage comparison: PriceCharting (current) vs Card Hedger (proposed).
 *
 *   npx tsx scripts/probe-cardhedger-coverage.ts
 *
 * Picks a stratified sample of ~50 cards across three product types:
 *   - mainline veteran-heavy (2025 Topps Chrome) — what's CH like on
 *     high-volume sets we already have decent PC coverage on?
 *   - prospect-heavy (2025 Bowman Draft) — does CH index minor leaguers
 *     who PC barely covers?
 *   - niche / premium (2026 Topps Chrome Black) — coverage on hard-to-find
 *     premium variants?
 *
 * For each sampled card, runs card-match → all-prices-by-card and reports:
 *   - Match rate (did CH find it at all? confidence ≥ 0.7?)
 *   - PSA 10 coverage delta: CH-only vs PC-only vs both-have vs both-null
 *   - When both have PSA 10, % difference (our PC vs CH's number)
 *   - Number of grades CH returns per card (1=just raw, 12=full ladder)
 *
 * Output is a printed report. No DB writes. Should take ~60s for 50
 * cards at 5 req/sec.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  getAllPricesByCard,
  matchCard,
} from "../src/lib/sources/pricing/cardhedger";

function ensureEnvLoaded(): void {
  if (process.env.CARD_HEDGER_API) return;
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
      if (!m) continue;
      const [, key, val] = m;
      if (process.env[key] != null) continue;
      process.env[key] = val.replace(/^["'](.*)["']$/, "$1");
    }
  } catch {
    /* .env missing; we'll throw below */
  }
}
ensureEnvLoaded();

const prisma = new PrismaClient();

type Sample = {
  bucket: string;
  productName: string;
  productSport: string;
  cardId: string;
  cardNumber: string;
  playerName: string;
  variation: string | null;
  ourRawCents: number | null;
  ourPsa10Cents: number | null;
};

const CATEGORY_FOR_SPORT: Record<string, string | undefined> = {
  MLB: "Baseball",
  NBA: "Basketball",
  NFL: "Football",
  NHL: "Hockey",
};

async function pickSample(): Promise<Sample[]> {
  const buckets: Array<{
    name: string;
    productNameContains: string;
    sport: string;
    take: number;
  }> = [
    {
      name: "Mainline veteran (2025 Topps Chrome BASEBALL)",
      productNameContains: "2025 Topps Chrome Baseball",
      sport: "MLB",
      take: 20,
    },
    {
      name: "Prospect-heavy (2025 Bowman Draft BASEBALL)",
      productNameContains: "2025 Bowman Draft Baseball",
      sport: "MLB",
      take: 20,
    },
    {
      name: "Premium NFL (2025 Panini Prizm Football)",
      productNameContains: "2025 Panini Prizm Football",
      sport: "NFL",
      take: 10,
    },
  ];

  const out: Sample[] = [];
  for (const b of buckets) {
    const product = await prisma.product.findFirst({
      where: {
        name: { contains: b.productNameContains, mode: "insensitive" },
        sport: b.sport,
      },
    });
    if (!product) {
      console.log(`  (skipping bucket "${b.name}" — no matching product)`);
      continue;
    }
    // Report what's actually available before we pick. If PC has zero
    // priced cards for this product the bucket is useless for an A/B
    // anyway — better to know upfront.
    const priced = await prisma.card.count({
      where: { productId: product.id, psa10Cents: { gt: 0 } },
    });
    const total = await prisma.card.count({ where: { productId: product.id } });
    console.log(
      `  ${product.name}: ${priced}/${total} cards have PC PSA 10 data`,
    );

    // Half priced (so we can compare), half unpriced (so we can see if CH
    // fills gaps). When priced=0 the whole bucket is "unpriced" and we
    // only learn about CH's standalone coverage there, not A/B.
    const halfACount = Math.min(Math.ceil(b.take / 2), priced);
    const halfBCount = b.take - halfACount;
    const halfA = await prisma.card.findMany({
      where: { productId: product.id, psa10Cents: { gt: 0 } },
      take: halfACount,
      orderBy: { psa10Cents: "desc" },
    });
    const halfB = await prisma.card.findMany({
      where: {
        productId: product.id,
        OR: [{ psa10Cents: null }, { psa10Cents: 0 }],
      },
      take: halfBCount,
      orderBy: { id: "asc" },
    });
    for (const c of [...halfA, ...halfB]) {
      out.push({
        bucket: b.name,
        productName: product.name,
        productSport: product.sport,
        cardId: c.id,
        cardNumber: c.cardNumber,
        playerName: c.playerName,
        variation: c.variation,
        ourRawCents: c.ungradedCents,
        ourPsa10Cents: c.psa10Cents,
      });
    }
  }
  return out;
}

function buildQuery(s: Sample): string {
  // Strip trailing "Baseball"/"Football"/etc — earlier ad-hoc tests
  // showed CH's matcher does better without the sport word repeated.
  const setName = s.productName.replace(
    /\s+(Baseball|Football|Basketball|Hockey)$/i,
    "",
  );
  return [s.playerName, setName, `#${s.cardNumber}`, s.variation]
    .filter(Boolean)
    .join(" ");
}

type Result = {
  sample: Sample;
  matchConfidence: number;
  matchedCardId: string | null;
  chPsa10Cents: number | null;
  chRawCents: number | null;
  chGradeCount: number;
  error: string | null;
};

async function probeOne(s: Sample): Promise<Result> {
  const query = buildQuery(s);
  try {
    const category = CATEGORY_FOR_SPORT[s.productSport];
    const m = await matchCard({ query, category });
    if (!m.cardId || m.confidence < 0.7) {
      return {
        sample: s,
        matchConfidence: m.confidence,
        matchedCardId: null,
        chPsa10Cents: null,
        chRawCents: null,
        chGradeCount: 0,
        error: null,
      };
    }
    const all = await getAllPricesByCard(m.cardId);
    const psa10 =
      all.prices.find((p) => p.grade === "PSA 10")?.cents ?? null;
    const raw = all.prices.find((p) => p.grade === "Raw")?.cents ?? null;
    return {
      sample: s,
      matchConfidence: m.confidence,
      matchedCardId: m.cardId,
      chPsa10Cents: psa10,
      chRawCents: raw,
      chGradeCount: all.prices.length,
      error: null,
    };
  } catch (e) {
    return {
      sample: s,
      matchConfidence: 0,
      matchedCardId: null,
      chPsa10Cents: null,
      chRawCents: null,
      chGradeCount: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function pct(n: number, total: number): string {
  if (total === 0) return "—";
  return `${((n / total) * 100).toFixed(0)}%`;
}

function fmtCents(c: number | null): string {
  return c == null ? "—" : `$${(c / 100).toFixed(2)}`;
}

function summarize(results: Result[]): void {
  const byBucket = new Map<string, Result[]>();
  for (const r of results) {
    const arr = byBucket.get(r.sample.bucket) ?? [];
    arr.push(r);
    byBucket.set(r.sample.bucket, arr);
  }

  for (const [bucket, rs] of byBucket) {
    console.log(`\n=== ${bucket} ===`);
    const total = rs.length;
    const matched = rs.filter((r) => r.matchedCardId != null).length;
    const highConf = rs.filter((r) => r.matchConfidence >= 0.9).length;
    const errors = rs.filter((r) => r.error).length;

    console.log(`  Sample size: ${total}`);
    console.log(`  Match rate (conf ≥ 0.7): ${matched}/${total} (${pct(matched, total)})`);
    console.log(`  High confidence (≥ 0.9): ${highConf}/${total} (${pct(highConf, total)})`);
    if (errors > 0) console.log(`  Errors: ${errors}`);

    // PSA 10 coverage breakdown
    const both = rs.filter(
      (r) => r.sample.ourPsa10Cents != null && r.sample.ourPsa10Cents > 0 && r.chPsa10Cents != null,
    );
    const chOnly = rs.filter(
      (r) =>
        (r.sample.ourPsa10Cents == null || r.sample.ourPsa10Cents === 0) &&
        r.chPsa10Cents != null,
    );
    const pcOnly = rs.filter(
      (r) =>
        r.sample.ourPsa10Cents != null &&
        r.sample.ourPsa10Cents > 0 &&
        r.chPsa10Cents == null,
    );
    const neither = rs.filter(
      (r) =>
        (r.sample.ourPsa10Cents == null || r.sample.ourPsa10Cents === 0) &&
        r.chPsa10Cents == null,
    );
    console.log(`\n  PSA 10 coverage:`);
    console.log(`    Both sources have it:  ${both.length}/${total} (${pct(both.length, total)})`);
    console.log(`    Card Hedger only:      ${chOnly.length}/${total} (${pct(chOnly.length, total)})  ← gain`);
    console.log(`    PriceCharting only:    ${pcOnly.length}/${total} (${pct(pcOnly.length, total)})  ← loss`);
    console.log(`    Neither:               ${neither.length}/${total} (${pct(neither.length, total)})`);

    // Disagreement when both have data
    if (both.length > 0) {
      const disagreements = both.map((r) => {
        const pc = r.sample.ourPsa10Cents!;
        const ch = r.chPsa10Cents!;
        return Math.abs(ch - pc) / pc;
      });
      const avgDisagree =
        disagreements.reduce((s, v) => s + v, 0) / disagreements.length;
      const maxDisagree = Math.max(...disagreements);
      console.log(`    Avg PC↔CH disagreement: ${(avgDisagree * 100).toFixed(0)}%`);
      console.log(`    Max PC↔CH disagreement: ${(maxDisagree * 100).toFixed(0)}%`);
    }

    // Grade ladder depth
    const matchedRs = rs.filter((r) => r.matchedCardId);
    if (matchedRs.length > 0) {
      const avgGrades =
        matchedRs.reduce((s, r) => s + r.chGradeCount, 0) / matchedRs.length;
      const fullLadder = matchedRs.filter((r) => r.chGradeCount >= 5).length;
      console.log(`\n  CH grade ladder depth (matched cards):`);
      console.log(`    Avg grades returned:   ${avgGrades.toFixed(1)}`);
      console.log(`    Cards with ≥5 grades:  ${fullLadder}/${matchedRs.length} (${pct(fullLadder, matchedRs.length)})`);
    }

    // Highlight a few CH-only wins (real-money cards we were missing)
    const wins = chOnly
      .filter((r) => r.chPsa10Cents! > 5000)
      .sort((a, b) => (b.chPsa10Cents ?? 0) - (a.chPsa10Cents ?? 0))
      .slice(0, 3);
    if (wins.length > 0) {
      console.log(`\n  Notable CH-only wins (PC was null on these):`);
      for (const r of wins) {
        console.log(
          `    · ${r.sample.playerName} ${r.sample.productName} #${r.sample.cardNumber} ${r.sample.variation ?? ""} → CH PSA 10 ${fmtCents(r.chPsa10Cents)}`,
        );
      }
    }

    // Highlight largest disagreements (when both have data)
    const argues = both
      .map((r) => ({
        r,
        delta: Math.abs(r.chPsa10Cents! - r.sample.ourPsa10Cents!) / r.sample.ourPsa10Cents!,
      }))
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 3);
    if (argues.length > 0 && argues[0].delta > 0.2) {
      console.log(`\n  Largest disagreements (both sources had data):`);
      for (const { r, delta } of argues) {
        console.log(
          `    · ${r.sample.playerName} ${r.sample.productName} #${r.sample.cardNumber} → PC ${fmtCents(r.sample.ourPsa10Cents)} | CH ${fmtCents(r.chPsa10Cents)}  Δ${(delta * 100).toFixed(0)}%`,
        );
      }
    }
  }

  // Overall summary
  console.log(`\n\n=== OVERALL ===`);
  const total = results.length;
  const matched = results.filter((r) => r.matchedCardId).length;
  const chPsa10 = results.filter((r) => r.chPsa10Cents != null).length;
  const ourPsa10 = results.filter(
    (r) => r.sample.ourPsa10Cents != null && r.sample.ourPsa10Cents > 0,
  ).length;
  console.log(`  Total cards probed:       ${total}`);
  console.log(`  CH match rate:            ${matched}/${total} (${pct(matched, total)})`);
  console.log(`  PC PSA 10 coverage:       ${ourPsa10}/${total} (${pct(ourPsa10, total)})`);
  console.log(`  CH PSA 10 coverage:       ${chPsa10}/${total} (${pct(chPsa10, total)})`);
  console.log(
    `  Net coverage delta:       ${chPsa10 - ourPsa10 >= 0 ? "+" : ""}${chPsa10 - ourPsa10} cards`,
  );
}

async function main() {
  if (!process.env.CARD_HEDGER_API) {
    console.error("CARD_HEDGER_API not set in .env — bailing.");
    process.exit(1);
  }

  console.log("Picking sample…");
  const sample = await pickSample();
  console.log(`Sampled ${sample.length} cards.\n`);

  const results: Result[] = [];
  for (let i = 0; i < sample.length; i++) {
    const s = sample[i];
    process.stdout.write(
      `\r  Probing ${i + 1}/${sample.length}: ${s.playerName.slice(0, 30).padEnd(30)} `,
    );
    const r = await probeOne(s);
    results.push(r);
    // Be polite — 5 req/sec ceiling. Each iteration = 2 calls (match +
    // all-prices). 250ms gap → ~4 req/sec, comfortable margin.
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  console.log("\n");

  summarize(results);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
