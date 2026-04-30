/**
 * Re-seed a Break Boys instance with the current product catalog by hitting
 * the local API. Use this against:
 *   - a fresh local Postgres (after `npx prisma migrate dev`)
 *   - a fresh production deploy (point BASE_URL at the Vercel URL)
 *
 *   npx tsx scripts/bulk-import.ts                       # local: http://localhost:3000
 *   BASE_URL=https://your-app.vercel.app \
 *     npx tsx scripts/bulk-import.ts                     # production
 *
 * Each entry maps to a Beckett checklist URL the parser knows how to
 * download. Products that have no published xlsx yet get created as
 * "Coming Soon" placeholders — re-run the script later and they'll
 * populate.
 */

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

type Seed = { name: string; sport: string; manufacturer: string; slug: string };

const PRODUCTS: Seed[] = [
  // 2026 baseball
  {
    name: "2026 Topps Chrome Black Baseball",
    sport: "MLB",
    manufacturer: "Topps",
    slug: "2026-topps-chrome-black-baseball-cards",
  },
  // 2025 baseball
  { name: "2025 Topps Chrome Baseball", sport: "MLB", manufacturer: "Topps", slug: "2025-topps-chrome-baseball-cards" },
  { name: "2025 Topps Series 1 Baseball", sport: "MLB", manufacturer: "Topps", slug: "2025-topps-series-1-baseball-cards" },
  { name: "2025 Topps Series 2 Baseball", sport: "MLB", manufacturer: "Topps", slug: "2025-topps-series-2-baseball-cards" },
  { name: "2025 Topps Heritage Baseball", sport: "MLB", manufacturer: "Topps", slug: "2025-topps-heritage-baseball-cards" },
  { name: "2025 Topps Definitive Collection Baseball", sport: "MLB", manufacturer: "Topps", slug: "2025-topps-definitive-baseball-cards" },
  { name: "2025 Topps Gilded Collection Baseball", sport: "MLB", manufacturer: "Topps", slug: "2025-topps-gilded-collection-baseball-cards" },
  { name: "2025 Bowman Chrome Baseball", sport: "MLB", manufacturer: "Bowman", slug: "2025-bowman-chrome-baseball-cards" },
  { name: "2025 Bowman Draft Baseball", sport: "MLB", manufacturer: "Bowman", slug: "2025-bowman-draft-baseball-cards" },
  // 2024 baseball
  { name: "2024 Topps Chrome Baseball", sport: "MLB", manufacturer: "Topps", slug: "2024-topps-chrome-baseball-checklist" },
  // 2025 football
  { name: "2025 Topps Chrome Football", sport: "NFL", manufacturer: "Topps", slug: "2025-topps-chrome-football-cards" },
  { name: "2025 Panini Prizm Football", sport: "NFL", manufacturer: "Panini", slug: "2025-panini-prizm-football-cards" },
  // 2025-26 basketball
  { name: "2025-26 Topps Basketball", sport: "NBA", manufacturer: "Topps", slug: "2025-26-topps-basketball-cards" },
  { name: "2025-26 Topps Chrome Basketball", sport: "NBA", manufacturer: "Topps", slug: "2025-26-topps-chrome-basketball-cards" },
  { name: "2025-26 Topps Cosmic Chrome Basketball", sport: "NBA", manufacturer: "Topps", slug: "2025-26-topps-cosmic-chrome-basketball-cards" },
  { name: "2025-26 Topps Finest Basketball", sport: "NBA", manufacturer: "Topps", slug: "2025-26-topps-finest-basketball-cards" },
  { name: "2025-26 Topps Chrome Sapphire Basketball", sport: "NBA", manufacturer: "Topps", slug: "2025-26-topps-chrome-sapphire-basketball-cards" },
  { name: "2025-26 Bowman Basketball", sport: "NBA", manufacturer: "Bowman", slug: "2025-26-bowman-basketball-cards" },
  { name: "2024-25 Topps Chrome Basketball", sport: "NBA", manufacturer: "Topps", slug: "2024-25-topps-chrome-basketball-cards" },
  { name: "2024-25 Panini Prizm Basketball", sport: "NBA", manufacturer: "Panini", slug: "2024-25-panini-prizm-basketball-cards" },
];

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const msg =
      typeof body === "object" && body && "error" in body
        ? (body as { error: string }).error
        : `${res.status}`;
    throw new Error(msg);
  }
  return body as T;
}

async function run() {
  console.log(`Importing ${PRODUCTS.length} products into ${BASE}\n`);
  const existing = await api<Array<{ id: string; name: string }>>("/api/products");
  const byName = new Map(existing.map((p) => [p.name, p.id]));

  let created = 0;
  let imported = 0;
  let coming = 0;

  for (const p of PRODUCTS) {
    let id = byName.get(p.name);
    if (!id) {
      const product = await api<{ id: string }>("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: p.name,
          sport: p.sport,
          manufacturer: p.manufacturer,
        }),
      });
      id = product.id;
      created++;
    }

    const url = `https://www.beckett.com/news/${p.slug}/`;
    try {
      const r = await api<{ added: number; teams: number }>(
        `/api/products/${id}/checklist/from-url`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, replace: true }),
        },
      );
      console.log(`✓ ${p.name}: ${r.added} cards / ${r.teams} teams`);
      imported++;
    } catch (e) {
      console.log(`⚠ ${p.name}: ${(e as Error).message} (Coming Soon)`);
      coming++;
    }
  }

  console.log(
    `\nDone. ${created} created, ${imported} imported, ${coming} marked Coming Soon.`,
  );
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
