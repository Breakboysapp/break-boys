// Quick script to dump the structure of a Beckett checklist xlsx so I can
// see how to parse it. Run: npx tsx scripts/inspect-xlsx.ts <path>
import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";

const path = process.argv[2] ?? "/tmp/beckett.xlsx";
const buf = readFileSync(path);
const wb = XLSX.read(buf, { type: "buffer" });
console.log("Sheets:", wb.SheetNames);

const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
  header: 1,
  blankrows: false,
  defval: "",
});
console.log(`Rows: ${rows.length}`);
console.log("First 80 non-empty rows:");
let printed = 0;
for (const row of rows) {
  const arr = row as unknown[];
  const nonEmpty = arr.filter((v) => v !== "" && v != null);
  if (nonEmpty.length === 0) continue;
  console.log(JSON.stringify(arr));
  printed++;
  if (printed >= 80) break;
}
console.log(`\n... (printed ${printed} rows)`);
