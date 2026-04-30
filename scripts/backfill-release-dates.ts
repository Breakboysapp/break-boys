/**
 * Backfill releaseDate for products by extracting YYYY/MM from each
 * Beckett checklist xlsx URL path. The path looks like
 *   .../uploads/2026/03/2026-Topps-Chrome-Black-Baseball-Checklist.xlsx
 * which we treat as "uploaded in March 2026" → released around then.
 *
 * Sets releaseDate = first day of the month encoded in the xlsx path.
 *
 * Run against whatever DATABASE_URL points at:
 *   npx tsx scripts/backfill-release-dates.ts
 */
import { PrismaClient } from "@prisma/client";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const SLUGS: Record<string, string> = {
  "2026 Topps Chrome Black Baseball": "2026-topps-chrome-black-baseball-cards",
  "2025 Topps Chrome Baseball": "2025-topps-chrome-baseball-cards",
  "2025 Topps Series 1 Baseball": "2025-topps-series-1-baseball-cards",
  "2025 Topps Series 2 Baseball": "2025-topps-series-2-baseball-cards",
  "2025 Topps Heritage Baseball": "2025-topps-heritage-baseball-cards",
  "2025 Topps Definitive Collection Baseball": "2025-topps-definitive-baseball-cards",
  "2025 Topps Gilded Collection Baseball": "2025-topps-gilded-collection-baseball-cards",
  "2025 Bowman Chrome Baseball": "2025-bowman-chrome-baseball-cards",
  "2025 Bowman Draft Baseball": "2025-bowman-draft-baseball-cards",
  "2024 Topps Chrome Baseball": "2024-topps-chrome-baseball-checklist",
  "2025 Topps Chrome Football": "2025-topps-chrome-football-cards",
  "2025 Panini Prizm Football": "2025-panini-prizm-football-cards",
  "2025-26 Topps Basketball": "2025-26-topps-basketball-cards",
  "2025-26 Topps Chrome Basketball": "2025-26-topps-chrome-basketball-cards",
  "2025-26 Topps Cosmic Chrome Basketball": "2025-26-topps-cosmic-chrome-basketball-cards",
  "2025-26 Topps Finest Basketball": "2025-26-topps-finest-basketball-cards",
  "2025-26 Topps Chrome Sapphire Basketball": "2025-26-topps-chrome-sapphire-basketball-cards",
  "2025-26 Bowman Basketball": "2025-26-bowman-basketball-cards",
  "2024-25 Topps Chrome Basketball": "2024-25-topps-chrome-basketball-cards",
  "2024-25 Panini Prizm Basketball": "2024-25-panini-prizm-basketball-cards",
};

async function fetchXlsxUrl(slug: string): Promise<string | null> {
  try {
    const res = await fetch(`https://www.beckett.com/news/${slug}/`, {
      headers: { "User-Agent": UA },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const html = await res.text();
    const matches = html.match(/\bhttps?:\/\/[^\s'"<>()]+\.xlsx(?:\?[^\s'"<>()]*)?/gi);
    if (!matches) return null;
    for (const raw of matches) {
      try {
        const u = new URL(raw);
        if (
          u.hostname.endsWith("beckett.com") ||
          u.hostname === "beckett-www.s3.amazonaws.com"
        ) {
          return u.toString();
        }
      } catch {}
    }
    return null;
  } catch {
    return null;
  }
}

function dateFromXlsxUrl(url: string): Date | null {
  // Match /uploads/YYYY/MM/...
  const m = url.match(/\/uploads\/(\d{4})\/(\d{2})\//);
  if (!m) return null;
  const year = m[1];
  const month = m[2];
  return new Date(`${year}-${month}-01T00:00:00Z`);
}

async function main() {
  const p = new PrismaClient();
  let updated = 0;
  let skipped = 0;
  for (const [name, slug] of Object.entries(SLUGS)) {
    const product = await p.product.findFirst({
      where: { name },
      select: { id: true, name: true, releaseDate: true },
    });
    if (!product) {
      console.log(`  [skip] ${name} — not in DB`);
      continue;
    }
    const xlsxUrl = await fetchXlsxUrl(slug);
    if (!xlsxUrl) {
      console.log(`  [skip] ${name} — no xlsx link`);
      skipped++;
      continue;
    }
    const releaseDate = dateFromXlsxUrl(xlsxUrl);
    if (!releaseDate) {
      console.log(`  [skip] ${name} — could not parse date from ${xlsxUrl}`);
      skipped++;
      continue;
    }
    await p.product.update({
      where: { id: product.id },
      data: { releaseDate },
    });
    console.log(
      `  ✓ ${name.padEnd(50)} → ${releaseDate.toISOString().slice(0, 10)}`,
    );
    updated++;
  }
  console.log(`\nUpdated ${updated}, skipped ${skipped}.`);
  await p.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
