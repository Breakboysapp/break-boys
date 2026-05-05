/**
 * Seed every product in the catalog with its default box formats,
 * derived from the product name via src/lib/product-formats-defaults.
 *
 * Idempotent — upserts on (productId, name), so re-running just
 * refreshes existing formats with the canonical seed data without
 * duplicating rows. Safe to re-run after editing the rules table.
 *
 *   npx tsx scripts/seed-all-product-formats.ts            # dry run
 *   npx tsx scripts/seed-all-product-formats.ts --apply    # write
 */
import { PrismaClient } from "@prisma/client";
import { defaultFormatsForProduct } from "../src/lib/product-formats-defaults";

async function main() {
  const apply = process.argv.includes("--apply");
  const prisma = new PrismaClient();

  console.log(`Mode: ${apply ? "APPLY" : "DRY RUN (--apply to write)"}\n`);

  const products = await prisma.product.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  let totalCreated = 0;
  let totalUpdated = 0;
  let totalUnchanged = 0;

  for (const p of products) {
    const templates = defaultFormatsForProduct(p.name);
    process.stdout.write(`${p.name}\n  ${templates.map((t) => t.name).join(" · ")}\n`);
    let position = 0;
    for (const t of templates) {
      const existing = await prisma.productFormat.findUnique({
        where: { productId_name: { productId: p.id, name: t.name } },
      });
      if (apply) {
        await prisma.productFormat.upsert({
          where: { productId_name: { productId: p.id, name: t.name } },
          create: {
            productId: p.id,
            name: t.name,
            packsPerBox: t.packsPerBox,
            cardsPerPack: t.cardsPerPack,
            autosPerBox: t.autosPerBox,
            notes: t.notes,
            position,
          },
          update: {
            packsPerBox: t.packsPerBox,
            cardsPerPack: t.cardsPerPack,
            autosPerBox: t.autosPerBox,
            notes: t.notes,
            position,
          },
        });
      }
      if (existing) totalUpdated++;
      else totalCreated++;
      position++;
    }
    if (templates.length === 0) totalUnchanged++;
  }

  console.log(
    `\nProducts processed: ${products.length}` +
      `\nFormats created:    ${totalCreated}${apply ? "" : " (dry-run)"}` +
      `\nFormats updated:    ${totalUpdated}${apply ? "" : " (dry-run)"}`,
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
