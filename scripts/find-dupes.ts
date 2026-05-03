/**
 * Find products with the same or near-identical names. Sometimes an import
 * pass creates a fresh row instead of finding the existing one (different
 * formatting, trailing whitespace, slug collision), and the user sees one
 * version with a checklist + another marked Coming Soon.
 */
import { PrismaClient } from "@prisma/client";

async function main() {
  const prisma = new PrismaClient();
  const all = await prisma.product.findMany({
    select: {
      id: true,
      name: true,
      sport: true,
      releaseDate: true,
      _count: { select: { cards: true } },
      createdAt: true,
    },
    orderBy: { name: "asc" },
  });

  // Group by lowercase normalized name
  const groups = new Map<string, typeof all>();
  for (const p of all) {
    const key = p.name.toLowerCase().trim().replace(/\s+/g, " ");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }

  // Surface only groups with >= 2 entries OR groups whose key fuzzy-matches
  // another (e.g. "2025 Topps Chrome Football" vs "2025 Topps Chrome Football
  // Set Checklist and ...").
  console.log("\nExact-name duplicates:\n");
  let any = false;
  for (const [, products] of groups) {
    if (products.length < 2) continue;
    any = true;
    for (const p of products) {
      console.log(
        `  [${p._count.cards.toString().padStart(5)} cards] ${p.id}  ${p.name}  (created ${p.createdAt.toISOString().slice(0, 10)})`,
      );
    }
    console.log("");
  }
  if (!any) console.log("  (none)\n");

  // Now look for empty products whose name is a prefix or suffix of a
  // populated product. These are usually different parses of the same
  // checklist that ended up as separate rows.
  console.log("Empty products that look like an alias of a populated one:\n");
  const empty = all.filter((p) => p._count.cards === 0);
  const populated = all.filter((p) => p._count.cards > 0);
  for (const e of empty) {
    const eNorm = e.name.toLowerCase().replace(/\s+/g, " ").trim();
    const matches = populated.filter((p) => {
      const pNorm = p.name.toLowerCase().replace(/\s+/g, " ").trim();
      return (
        pNorm.includes(eNorm) ||
        eNorm.includes(pNorm) ||
        // First 4 words match
        pNorm.split(" ").slice(0, 4).join(" ") ===
          eNorm.split(" ").slice(0, 4).join(" ")
      );
    });
    if (matches.length > 0) {
      console.log(`  EMPTY:    ${e.id}  ${e.name}`);
      for (const m of matches) {
        console.log(
          `    looks like: [${m._count.cards} cards] ${m.id}  ${m.name}`,
        );
      }
      console.log("");
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
