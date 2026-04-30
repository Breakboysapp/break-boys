// Verifies the fixed-algorithm composite scoring math against synthetic
// fixtures. Run: npx tsx scripts/test-composite.ts
import {
  PRICING_BLEND_ALPHA,
  classifyCard,
  computeComposite,
  computeTeamMarketValue,
  computeTeamScores,
  type CardLite,
} from "../src/lib/scoring";

console.log(`Algorithm α = ${PRICING_BLEND_ALPHA}`);
console.log();

// Auto-classification spot checks.
const samples: Array<{ cn: string; label: string; weight: number }> = [
  { cn: "1", label: "Base", weight: 1 },
  { cn: "100", label: "Base", weight: 1 },
  { cn: "CBA-AJ", label: "Chrome Black Auto", weight: 10 },
  { cn: "IVA-SO", label: "Ivory Auto", weight: 15 },
  { cn: "PDPA-OY", label: "Pitch Black Dual Auto", weight: 12 },
  { cn: "SFA-AF", label: "Super Futures Auto", weight: 8 },
  { cn: "PIA-YY", label: "Paint It Auto", weight: 6 },
  { cn: "DAM-1", label: "Damascus", weight: 4 },
  { cn: "NOC-20", label: "Nocturnal", weight: 4 },
  { cn: "DOD-9", label: "Depth of Darkness", weight: 4 },
  { cn: "CBHA-15", label: "Home Field", weight: 4 },
  { cn: "WEIRD-1", label: "Insert", weight: 4 }, // unknown prefix → default insert
];
let failures = 0;
console.log("Auto-classification:");
for (const s of samples) {
  const c = classifyCard(s.cn);
  const ok = c.label === s.label && c.weight === s.weight;
  console.log(`  ${ok ? "OK " : "FAIL"} ${s.cn.padEnd(10)} → ${c.label} (w=${c.weight})`);
  if (!ok) {
    console.log(`        expected ${s.label} (w=${s.weight})`);
    failures++;
  }
}

// Composite scoring fixture.
const cards: Array<CardLite & { marketValueCents: number | null }> = [
  // Yankees: 2 base + 2 inserts + 1 auto, premium market
  { cardNumber: "1", team: "Yankees", marketValueCents: 5000 },
  { cardNumber: "2", team: "Yankees", marketValueCents: 5000 },
  { cardNumber: "DAM-1", team: "Yankees", marketValueCents: 8000 },
  { cardNumber: "NOC-2", team: "Yankees", marketValueCents: 8000 },
  { cardNumber: "CBA-AJ", team: "Yankees", marketValueCents: 60000 },
  // Dodgers: same content shape, even more premium market
  { cardNumber: "3", team: "Dodgers", marketValueCents: 6000 },
  { cardNumber: "4", team: "Dodgers", marketValueCents: 6000 },
  { cardNumber: "DAM-3", team: "Dodgers", marketValueCents: 10000 },
  { cardNumber: "NOC-4", team: "Dodgers", marketValueCents: 10000 },
  { cardNumber: "CBA-SO", team: "Dodgers", marketValueCents: 80000 },
  // Marlins: same content, partial coverage (auto + 1 insert have no market)
  { cardNumber: "5", team: "Marlins", marketValueCents: 1000 },
  { cardNumber: "6", team: "Marlins", marketValueCents: 1000 },
  { cardNumber: "DAM-5", team: "Marlins", marketValueCents: 2000 },
  { cardNumber: "NOC-6", team: "Marlins", marketValueCents: null },
  { cardNumber: "CBA-MA", team: "Marlins", marketValueCents: null },
];

const contentScores = computeTeamScores(cards);
const { perTeam: marketValues, coveragePerTeam } = computeTeamMarketValue(cards);

console.log("\nContent scores (each team has 1+1+4+4+10 = 20):");
for (const [team, s] of contentScores) console.log(`  ${team.padEnd(10)} ${s}`);

console.log("\nCoverage:");
for (const [team, c] of coveragePerTeam) {
  console.log(`  ${team.padEnd(10)} ${c.covered}/${c.total} = ${((c.covered / c.total) * 100).toFixed(0)}%`);
}

const boxPriceCents = 30000; // $300
const result = computeComposite({
  contentScores,
  marketValues,
  marketCoverage: coveragePerTeam,
  boxPriceCents,
});

console.log(`\nComposite at fixed α=${PRICING_BLEND_ALPHA} ($300 box):`);
let totalShare = 0;
for (const r of result) {
  totalShare += r.blendedShare;
  console.log(
    `  ${r.team.padEnd(10)} share=${(r.blendedShare * 100).toFixed(1)}% retail=$${(r.retailCents! / 100).toFixed(2)}`,
  );
}
console.log(`  share sum: ${totalShare.toFixed(4)}`);

if (Math.abs(totalShare - 1) > 0.001) {
  console.error("FAIL: shares should sum to 1");
  failures++;
}
const ranked = result.map((r) => r.team);
if (ranked[0] !== "Dodgers" || ranked[1] !== "Yankees" || ranked[2] !== "Marlins") {
  console.error("FAIL: expected Dodgers > Yankees > Marlins, got", ranked);
  failures++;
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nAll checks passed.");
