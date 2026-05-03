/**
 * Mirror the home-page tab logic to confirm what's in each bucket.
 *   Active       = cards > 0
 *   Coming Soon  = cards = 0 AND (releaseDate IS NULL OR releaseDate > now)
 *   Hidden       = cards = 0 AND releaseDate <= now  (released-but-empty,
 *                  data gap — invisible to public users)
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
    },
    orderBy: [{ releaseDate: "asc" }, { name: "asc" }],
  });
  const now = new Date();

  const active = all.filter((p) => p._count.cards > 0);
  const comingSoon = all.filter(
    (p) =>
      p._count.cards === 0 &&
      (p.releaseDate == null || p.releaseDate > now),
  );
  const hidden = all.filter(
    (p) =>
      p._count.cards === 0 &&
      p.releaseDate != null &&
      p.releaseDate <= now,
  );

  console.log(`\nActive (cards > 0): ${active.length} products\n`);
  console.log(`\nComing Soon (truly upcoming, ${comingSoon.length} products):\n`);
  for (const p of comingSoon) {
    const d = p.releaseDate?.toISOString().slice(0, 10) ?? "(no date)";
    console.log(`  ${d.padEnd(12)} ${p.sport.padEnd(7)} ${p.name}`);
  }

  console.log(
    `\nHidden — released but no checklist (${hidden.length} products, NOT shown to users):\n`,
  );
  for (const p of hidden) {
    const d = p.releaseDate?.toISOString().slice(0, 10) ?? "(no date)";
    console.log(`  ${d.padEnd(12)} ${p.sport.padEnd(7)} ${p.name}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
