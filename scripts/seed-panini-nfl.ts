/**
 * Seed all Panini NFL products from 2023 onwards. Probes Beckett's article
 * URLs for ~25 brand × 3 year combinations, creates a product for each
 * 200 response, imports the checklist + sets release date from the xlsx
 * upload path.
 *
 * Run against whatever DATABASE_URL points at:
 *   npx tsx scripts/seed-panini-nfl.ts
 *
 * Idempotent: re-running is safe — products that already exist get their
 * checklist re-imported via replace; products with no xlsx remain "Coming
 * Soon" placeholders that future runs will fill in.
 */
import { PrismaClient } from "@prisma/client";
import { beckett } from "../src/lib/sources/checklist/beckett";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const YEARS = ["2023", "2024", "2025"];

// Brand slug → product label suffix (after the year)
const BRANDS: Array<{ slug: string; label: string }> = [
  { slug: "panini-prizm", label: "Panini Prizm" },
  { slug: "panini-prizm-draft-picks", label: "Panini Prizm Draft Picks" },
  { slug: "panini-donruss", label: "Panini Donruss" },
  { slug: "panini-donruss-elite", label: "Panini Donruss Elite" },
  { slug: "panini-donruss-optic", label: "Panini Donruss Optic" },
  { slug: "panini-mosaic", label: "Panini Mosaic" },
  { slug: "panini-select", label: "Panini Select" },
  { slug: "panini-contenders", label: "Panini Contenders" },
  { slug: "panini-contenders-draft-picks", label: "Panini Contenders Draft Picks" },
  { slug: "panini-absolute", label: "Panini Absolute" },
  { slug: "panini-score", label: "Panini Score" },
  { slug: "panini-phoenix", label: "Panini Phoenix" },
  { slug: "panini-playbook", label: "Panini Playbook" },
  { slug: "panini-gala", label: "Panini Gala" },
  { slug: "panini-origins", label: "Panini Origins" },
  { slug: "panini-rookies-and-stars", label: "Panini Rookies & Stars" },
  { slug: "panini-crown-royale", label: "Panini Crown Royale" },
  { slug: "panini-spectra", label: "Panini Spectra" },
  { slug: "panini-limited", label: "Panini Limited" },
  { slug: "panini-immaculate", label: "Panini Immaculate" },
  { slug: "panini-national-treasures", label: "Panini National Treasures" },
  { slug: "panini-one", label: "Panini One" },
  { slug: "panini-gold-standard", label: "Panini Gold Standard" },
  { slug: "panini-flawless", label: "Panini Flawless" },
  { slug: "panini-chronicles", label: "Panini Chronicles" },
  { slug: "panini-xr", label: "Panini XR" },
  { slug: "panini-impeccable", label: "Panini Impeccable" },
  { slug: "panini-preferred", label: "Panini Preferred" },
  { slug: "panini-illusions", label: "Panini Illusions" },
  { slug: "panini-zenith", label: "Panini Zenith" },
  { slug: "panini-revolution", label: "Panini Revolution" },
];

type Candidate = {
  productName: string;
  slug: string;
};

function buildCandidates(): Candidate[] {
  const out: Candidate[] = [];
  for (const year of YEARS) {
    for (const brand of BRANDS) {
      out.push({
        productName: `${year} ${brand.label} Football`,
        slug: `${year}-${brand.slug}-football-cards`,
      });
    }
  }
  return out;
}

async function probe(slug: string): Promise<boolean> {
  // GET (not HEAD) — Beckett's CDN sometimes rejects HEAD via Node's fetch.
  try {
    const res = await fetch(`https://www.beckett.com/news/${slug}/`, {
      headers: { "User-Agent": UA },
      redirect: "follow",
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

function dateFromXlsxUrl(url: string): Date | null {
  const m = url.match(/\/uploads\/(\d{4})\/(\d{2})\//);
  if (!m) return null;
  return new Date(`${m[1]}-${m[2]}-01T00:00:00Z`);
}

async function main() {
  const p = new PrismaClient();
  const candidates = buildCandidates();
  console.log(`Probing ${candidates.length} Panini NFL slugs (${YEARS.length} years × ${BRANDS.length} brands)\n`);

  // Phase 1: probe URLs (HEAD requests, fast)
  const live: Candidate[] = [];
  let probed = 0;
  for (const c of candidates) {
    probed++;
    const ok = await probe(c.slug);
    if (ok) live.push(c);
    if (probed % 20 === 0) {
      process.stdout.write(`  probed ${probed}/${candidates.length} (${live.length} live)\n`);
    }
  }
  console.log(`\nFound ${live.length} live URLs.\n`);

  // Phase 2: create + import each
  let created = 0;
  let imported = 0;
  let coming = 0;
  for (const c of live) {
    process.stdout.write(`→ ${c.productName}\n`);

    let product = await p.product.findFirst({ where: { name: c.productName } });
    if (!product) {
      product = await p.product.create({
        data: {
          name: c.productName,
          sport: "NFL",
          manufacturer: "Panini",
        },
      });
      created++;
    }

    // Import checklist
    let result;
    try {
      result = await beckett.importFrom(new URL(`https://www.beckett.com/news/${c.slug}/`));
    } catch (err) {
      console.log(`  ⚠ ${err instanceof Error ? err.message : err} (Coming Soon)`);
      coming++;
      continue;
    }

    // Replace cards
    await p.card.deleteMany({ where: { productId: product.id } });
    const CHUNK = 1000;
    for (let i = 0; i < result.rows.length; i += CHUNK) {
      const slice = result.rows.slice(i, i + CHUNK);
      await p.card.createMany({
        data: slice.map((r) => ({
          productId: product!.id,
          team: r.team,
          playerName: r.playerName,
          cardNumber: r.cardNumber,
          variation: r.variation ?? null,
        })),
      });
    }
    // Ensure TeamPrice rows
    const teams = Array.from(new Set(result.rows.map((r) => r.team)));
    for (const team of teams) {
      await p.teamPrice.upsert({
        where: { productId_team: { productId: product.id, team } },
        update: {},
        create: { productId: product.id, team },
      });
    }
    // Set release date from xlsx upload path
    const releaseDate = dateFromXlsxUrl(result.sourceUrl);
    if (releaseDate) {
      await p.product.update({
        where: { id: product.id },
        data: { releaseDate },
      });
    }
    console.log(
      `  ✓ ${result.rows.length} cards${releaseDate ? ` · released ${releaseDate.toISOString().slice(0, 10)}` : ""}`,
    );
    imported++;
  }

  await p.$disconnect();
  console.log(`\nDone. ${created} created, ${imported} imported, ${coming} coming-soon.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
