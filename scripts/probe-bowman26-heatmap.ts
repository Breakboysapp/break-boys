/**
 * Heatmap probe: which players in 2026 Bowman are showing real sales
 * activity on Card Hedger right now?
 *
 *   npx tsx scripts/probe-bowman26-heatmap.ts
 *
 * Pulls every distinct player from the 2026 Bowman Baseball checklist
 * (~354), batches them through CH `sales-stats-by-player` to get
 * 30-day sales counts + dollar volume, and prints them sorted by
 * volume. The point is to confirm the JJ Wetherholt pattern is
 * common — most Bowman prospects with any market traction should
 * surface here.
 *
 * Bucketed by 30-day weekly slices (4 buckets) so we can also see
 * direction-of-travel — flat 0/0/5/12 means heating up; 50/30/10/2
 * means cooling.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { getPlayerSalesStats } from "../src/lib/sources/pricing/cardhedger";

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
    /* ignored */
  }
}
ensureEnvLoaded();

const prisma = new PrismaClient();

const BATCH_SIZE = 25; // CH happily accepts arrays; conservative batch.
const REQUEST_DELAY_MS = 250;

function fmtUsd(cents: number): string {
  if (cents <= 0) return "—";
  if (cents >= 100_000_000) return `$${(cents / 100_000_000).toFixed(1)}M`;
  if (cents >= 100_000) return `$${(cents / 100_000).toFixed(0)}k`;
  return `$${(cents / 100).toFixed(0)}`;
}

function sparkline(counts: number[]): string {
  // Tiny ASCII sparkline showing direction-of-travel across 4 weeks.
  // Normalizes per row so each row's max maps to the tallest block.
  if (counts.length === 0) return "";
  const max = Math.max(...counts, 1);
  const blocks = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
  return counts
    .map((c) => {
      if (c === 0) return blocks[0];
      const idx = Math.min(
        blocks.length - 1,
        Math.round((c / max) * (blocks.length - 1)),
      );
      return blocks[idx];
    })
    .join("");
}

async function main() {
  if (!process.env.CARD_HEDGER_API) {
    console.error("CARD_HEDGER_API not set in .env — bailing.");
    process.exit(1);
  }

  // 2026 Bowman Baseball product
  const product = await prisma.product.findFirst({
    where: { name: { equals: "2026 Bowman Baseball", mode: "insensitive" } },
  });
  if (!product) {
    console.error("Couldn't find 2026 Bowman Baseball product in DB.");
    process.exit(1);
  }

  const playersRaw = await prisma.card.findMany({
    where: { productId: product.id },
    distinct: ["playerName"],
    select: { playerName: true, team: true },
  });
  const players = [...new Set(playersRaw.map((p) => p.playerName))].sort();
  console.log(`Found ${players.length} distinct players in ${product.name}.\n`);

  type Row = {
    player: string;
    team: string;
    totalSales: number;
    totalCents: number;
    avgCents: number;
    weeklyCounts: number[];
  };

  const rows: Row[] = [];
  const teamByPlayer = new Map<string, string>();
  for (const p of playersRaw) {
    if (p.team && p.team !== "—" && !teamByPlayer.has(p.playerName)) {
      teamByPlayer.set(p.playerName, p.team);
    }
  }

  for (let i = 0; i < players.length; i += BATCH_SIZE) {
    const batch = players.slice(i, i + BATCH_SIZE);
    process.stdout.write(
      `\r  Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(players.length / BATCH_SIZE)}: ${i + 1}-${Math.min(i + BATCH_SIZE, players.length)} of ${players.length}…   `,
    );
    try {
      const stats = await getPlayerSalesStats({
        players: batch,
        interval: "week",
        periods: 4,
        includeCurrent: true,
      });
      for (const r of stats) {
        const totalSales = r.buckets.reduce((s, b) => s + b.count, 0);
        const totalCents = r.buckets.reduce((s, b) => s + b.totalCents, 0);
        const weeklyCounts = r.buckets.map((b) => b.count);
        rows.push({
          player: r.player,
          team: teamByPlayer.get(r.player) ?? "—",
          totalSales,
          totalCents,
          avgCents:
            totalSales > 0 ? Math.round(totalCents / totalSales) : 0,
          weeklyCounts,
        });
      }
    } catch (e) {
      console.warn(
        `\n    batch failed (${batch[0]}–${batch[batch.length - 1]}):`,
        e instanceof Error ? e.message : e,
      );
    }
    await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
  }
  console.log("\n");

  // Sort by 30-day dollar volume descending. Ties broken by sales
  // count.
  rows.sort((a, b) => b.totalCents - a.totalCents || b.totalSales - a.totalSales);

  // Top players summary
  console.log("=== Top 30 by 30-day $ volume ===");
  console.log(
    "  rank  player                          team                          sales  $ vol     avg     trend".padEnd(120),
  );
  console.log("  " + "—".repeat(118));
  for (let i = 0; i < Math.min(30, rows.length); i++) {
    const r = rows[i];
    const rank = String(i + 1).padStart(4);
    const player = r.player.slice(0, 28).padEnd(28);
    const team = r.team.slice(0, 28).padEnd(28);
    const sales = String(r.totalSales).padStart(6);
    const vol = fmtUsd(r.totalCents).padStart(8);
    const avg = fmtUsd(r.avgCents).padStart(7);
    const trend = sparkline(r.weeklyCounts);
    console.log(`  ${rank}  ${player}  ${team}  ${sales}  ${vol}  ${avg}   ${trend}`);
  }

  // Bucketed summary
  const withSales = rows.filter((r) => r.totalSales > 0).length;
  const tierA = rows.filter((r) => r.totalCents >= 1_000_000).length; // ≥ $10k
  const tierB = rows.filter(
    (r) => r.totalCents >= 100_000 && r.totalCents < 1_000_000,
  ).length; // $1k–$10k
  const tierC = rows.filter(
    (r) => r.totalCents > 0 && r.totalCents < 100_000,
  ).length; // > 0 < $1k
  const noSales = rows.filter((r) => r.totalSales === 0).length;

  console.log(`\n=== Coverage summary ===`);
  console.log(`  Total players probed:      ${rows.length}`);
  console.log(`  Players with any sales:    ${withSales} (${Math.round((withSales / rows.length) * 100)}%)`);
  console.log(`  Tier A — ≥ $10k vol:       ${tierA}`);
  console.log(`  Tier B — $1k–$10k vol:     ${tierB}`);
  console.log(`  Tier C — < $1k vol:        ${tierC}`);
  console.log(`  No 30-day sales:           ${noSales}`);

  // Optional: who's hottest right now (last bucket count vs first 3 avg)
  console.log(`\n=== Hottest movers (current week vs prior 3 avg, min 5 total sales) ===`);
  const movers = rows
    .filter((r) => r.totalSales >= 5 && r.weeklyCounts.length === 4)
    .map((r) => {
      const prior = (r.weeklyCounts[0] + r.weeklyCounts[1] + r.weeklyCounts[2]) / 3;
      const current = r.weeklyCounts[3];
      const ratio = prior > 0 ? current / prior : current > 0 ? Infinity : 0;
      return { ...r, prior, current, ratio };
    })
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, 15);
  for (const m of movers) {
    console.log(
      `  ${m.player.slice(0, 28).padEnd(28)}  prior avg ${m.prior.toFixed(1).padStart(5)}/wk  →  current ${String(m.current).padStart(4)}/wk  (×${Number.isFinite(m.ratio) ? m.ratio.toFixed(1) : "∞"})`,
    );
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
