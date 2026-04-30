// Verifies the Beckett xlsx parser against a real downloaded file.
// Run: npx tsx scripts/test-beckett.ts [path-to-xlsx]
import { readFileSync } from "node:fs";
import { parseBeckettXlsx, findXlsxLink } from "../src/lib/sources/checklist/beckett";

const xlsxPath = process.argv[2] ?? "/tmp/beckett.xlsx";
const buffer = readFileSync(xlsxPath);

const rows = parseBeckettXlsx(
  buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
);

console.log(`Parsed ${rows.length} cards.`);

// Group by variation to see section breakdown.
const sections = new Map<string, number>();
for (const r of rows) {
  const key = r.variation ?? "(base)";
  sections.set(key, (sections.get(key) ?? 0) + 1);
}
console.log("\nBy section/variation:");
for (const [k, v] of [...sections.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(40)} ${v}`);
}

// Group by team for quick sanity check.
const teams = new Map<string, number>();
for (const r of rows) {
  teams.set(r.team, (teams.get(r.team) ?? 0) + 1);
}
console.log(`\nTeams represented: ${teams.size}`);
console.log("Top 5 teams by count:");
for (const [t, c] of [...teams.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
  console.log(`  ${t.padEnd(30)} ${c}`);
}

console.log("\nFirst 5 rows:");
for (const r of rows.slice(0, 5)) {
  console.log(`  #${r.cardNumber} ${r.playerName} (${r.team}) ${r.variation ?? ""}`);
}
console.log("\nLast 5 rows:");
for (const r of rows.slice(-5)) {
  console.log(`  #${r.cardNumber} ${r.playerName} (${r.team}) ${r.variation ?? ""}`);
}

// Sanity: every row should have non-empty player & team & cardNumber.
let bad = 0;
for (const r of rows) {
  if (!r.playerName || !r.team || !r.cardNumber) bad++;
}
if (bad > 0) {
  console.error(`\n${bad} malformed rows`);
  process.exit(1);
}

// Quick sanity for findXlsxLink against a synthesized html sample.
const sampleHtml = `<p class="attachment"><a href='https://img.beckett.com/news/news-content/uploads/2024/06/2024-Topps-Chrome-Baseball-Checklist.xlsx'>Download</a></p>`;
const link = findXlsxLink(sampleHtml, new URL("https://www.beckett.com/news/2024-topps-chrome-baseball-checklist/"));
console.log(`\nfindXlsxLink: ${link}`);
if (!link?.endsWith(".xlsx")) {
  console.error("FAIL: findXlsxLink did not return an xlsx URL");
  process.exit(1);
}

console.log("\nAll Beckett parser checks passed.");
