/**
 * Self-contained check for the tiered player-name matcher — no DB.
 *
 * Builds a small fake "roster" of MLB-API-style spellings, then asserts
 * that checklist-style spellings (Beckett drift) resolve to the right
 * roster row via the expected tier, and — just as important — that
 * genuinely-different / ambiguous names do NOT match.
 *
 * Run: npx tsx scripts/test-name-match.ts   (or: npm run test:match)
 */
import { normalizeKey } from "../src/lib/player-name-normalize";
import {
  buildNameMatcher,
  looseKey,
  firstNameCompatible,
} from "../src/lib/player-name-match";

// Roster side = how MLB Stats API spells them. We store the base
// normalized key exactly like refresh-roster.ts does.
const ROSTER = [
  "CJ Abrams",
  "Ronald Acuna Jr.",
  "Oneil Cruz",
  "Jung Hoo Lee",
  "Yoshinobu Yamamoto",
  "Jose Ramirez", // accented on the card side
  "Fernando Tatis Jr.",
  "Cal Ripken", // ambiguity partner for "Cal Ripken Jr."
  "Cal Ripken Jr.",
  "Luis Garcia", // two L-Garcias → first-name ambiguity test
  "Leury Garcia",
  "Maikel Garcia",
  "Alex Judge", // cross-name guard: must NOT match "Aaron Judge"
  "Cameron Maldonado", // nickname target: "Cam" should reach this
  "Roberto Perez", // -o trap: "Robert Perez" must NOT match
  "Jose De La Cruz", // multi-word surname: "Jose Cruz" must NOT match
];

type Row = { normalizedName: string; playerName: string };
const rosterRows: Row[] = ROSTER.map((n) => ({
  playerName: n,
  normalizedName: normalizeKey(n),
}));
const matcher = buildNameMatcher(rosterRows, (r) => r.normalizedName);

type Case = {
  card: string; // checklist spelling (Beckett)
  expect: string | null; // expected roster playerName, or null = no match
  via?: MatchType;
  note: string;
};
type MatchType = "exact" | "loose" | "prefix";

const CASES: Case[] = [
  { card: "C.J. Abrams", expect: "CJ Abrams", via: "loose", note: "periods in initials differ → loose" },
  { card: "CJ Abrams", expect: "CJ Abrams", via: "exact", note: "identical base key" },
  { card: "Ronald Acuña Jr.", expect: "Ronald Acuna Jr.", via: "exact", note: "accent folds at base key; suffix matches → exact" },
  { card: "Ronald Acuna Jr", expect: "Ronald Acuna Jr.", via: "loose", note: "missing period on suffix → loose" },
  { card: "Ronald Acuna", expect: "Ronald Acuna Jr.", via: "loose", note: "suffix dropped on card side → loose" },
  { card: "O'Neil Cruz", expect: "Oneil Cruz", via: "loose", note: "apostrophe vs none → loose" },
  { card: "Jung-hoo Lee", expect: "Jung Hoo Lee", via: "loose", note: "hyphen vs space → loose" },
  { card: "Yoshi Yamamoto", expect: "Yoshinobu Yamamoto", via: "prefix", note: "first-name short form, prefix, unambiguous surname → prefix" },
  { card: "Cam Maldonado", expect: "Cameron Maldonado", via: "prefix", note: "real nickname, ≥3-char gap → prefix" },
  { card: "José Ramírez", expect: "Jose Ramirez", via: "exact", note: "accents fold at base key → exact" },
  { card: "Fernando Tatís Jr.", expect: "Fernando Tatis Jr.", via: "exact", note: "accent only, suffix identical → exact" },
  // Safety: must pick the exact one / must NOT match.
  { card: "Cal Ripken Jr.", expect: "Cal Ripken Jr.", via: "exact", note: "exact wins, Jr. suffix preserved" },
  { card: "Cal Ripken IV", expect: null, note: "loose 'cal ripken' hits BOTH Cal Ripken + Cal Ripken Jr. → ambiguous → decline" },
  { card: "L. Garcia", expect: null, note: "first name 'l' below min prefix length, and Garcia surname collides → decline" },
  { card: "Aaron Judge", expect: null, note: "shares surname+initial with Alex Judge but neither name is a prefix of the other → decline (the cross-population guard)" },
  { card: "Robert Perez Jr.", expect: null, note: "Robert vs Roberto: prefix but only a 1-char gap → distinct name → decline" },
  { card: "Jose Cruz", expect: null, note: "surname 'cruz' ≠ full surname 'de la cruz' → decline" },
  { card: "Carlos Garcia", expect: null, note: "no prefix-compatible Garcia → decline" },
  { card: "Totally Unknown", expect: null, note: "no candidate at any tier" },
];

let pass = 0;
let fail = 0;
for (const c of CASES) {
  const key = normalizeKey(c.card);
  const hit = matcher.match(key);
  const got = hit?.item.playerName ?? null;
  const gotVia = hit?.via ?? null;
  const nameOk = got === c.expect;
  const viaOk = c.via == null || gotVia === c.via;
  const ok = nameOk && viaOk;
  if (ok) pass++;
  else fail++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  "${c.card}" -> ${got ?? "(none)"}${gotVia ? ` [${gotVia}]` : ""}` +
      (ok ? "" : `   EXPECTED ${c.expect ?? "(none)"}${c.via ? ` [${c.via}]` : ""}`) +
      `\n      · ${c.note}`,
  );
}

console.log("\n-- key derivations --");
for (const n of ["C.J. Abrams", "Ronald Acuña Jr.", "Jung-hoo Lee", "O'Neil Cruz"]) {
  const k = normalizeKey(n);
  console.log(`  "${n}"  base="${k}"  loose="${looseKey(k)}"`);
}
console.log("\n-- firstNameCompatible spot checks --");
for (const [a, b] of [
  ["yoshi", "yoshinobu"],
  ["aaron", "alex"],
  ["l", "luis"],
  ["mike", "michael"],
] as Array<[string, string]>) {
  console.log(`  "${a}" ~ "${b}" => ${firstNameCompatible(a, b)}`);
}

console.log(`\n${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);
