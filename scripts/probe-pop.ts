/**
 * Quick standalone probe of the pop-fetch helper. Useful when iterating
 * on Cloudflare bot-wall headers — runs the same `fetchPopRows` the
 * importer uses and prints the first few rows, no DB involvement.
 *
 *   npx tsx scripts/probe-pop.ts <slug>
 *   npx tsx scripts/probe-pop.ts baseball-cards-2025-topps-chrome
 */
import { fetchPopRows } from "../src/lib/sources/pricing/pricecharting-console";

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("usage: tsx scripts/probe-pop.ts <slug>");
    process.exit(1);
  }
  const rows = await fetchPopRows(slug);
  console.log(`${rows.length} rows`);
  for (const r of rows.slice(0, 5)) {
    console.log(
      `  ${r.cardLabel.padEnd(48)} G6=${r.popG6} G7=${r.popG7} G8=${r.popG8} G9=${r.popG9} G10=${r.popG10} total=${r.popTotal}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
