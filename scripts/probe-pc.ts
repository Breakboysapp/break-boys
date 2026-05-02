/**
 * Probe PriceCharting directly for one or more queries, showing every
 * candidate the API returns + their loose/graded prices. Used to find
 * out whether PC even has data for a given player+set+variation, before
 * blaming our matcher.
 *
 *   npx tsx scripts/probe-pc.ts "2024 topps chrome mike trout auto"
 *   npx tsx scripts/probe-pc.ts "2024 topps chrome trout dual autographs"
 */

const PC_BASE = "https://www.pricecharting.com/api";

type PCProduct = {
  id?: string | number;
  "console-name"?: string;
  "product-name"?: string;
  "loose-price"?: number;
  "graded-price"?: number;
  "new-price"?: number;
};

async function probe(query: string) {
  const token = process.env.PRICECHARTING_TOKEN;
  if (!token) throw new Error("PRICECHARTING_TOKEN not set");
  const url = `${PC_BASE}/products?t=${encodeURIComponent(
    token,
  )}&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    console.log(`  HTTP ${res.status}`);
    return;
  }
  const json = (await res.json()) as { products?: PCProduct[] };
  const products = json.products ?? [];
  console.log(`\nQuery: "${query}"   → ${products.length} candidates`);
  for (const p of products.slice(0, 10)) {
    const loose = p["loose-price"];
    const graded = p["graded-price"];
    const newP = p["new-price"];
    const fmt = (c?: number) =>
      c != null && c > 0 ? `$${(c / 100).toFixed(2)}` : "—";
    console.log(
      `  loose=${fmt(loose).padEnd(8)} graded=${fmt(graded).padEnd(10)} new=${fmt(newP).padEnd(8)}  ${p["console-name"] ?? "?"} :: ${p["product-name"] ?? "?"}`,
    );
  }
  if (products.length > 10) {
    console.log(`  …and ${products.length - 10} more`);
  }
}

async function main() {
  const queries = process.argv.slice(2);
  if (queries.length === 0) {
    // Default suite — Trout's auto cards in 2024 Topps Chrome
    queries.push(
      "2024 topps chrome baseball mike trout auto",
      "2024 topps chrome baseball mike trout dual autographs",
      "2024 topps chrome baseball mike trout chrome legend auto",
      "2024 topps chrome baseball mike trout ultraviolet autographs",
      "2024 topps chrome baseball mike trout on the spot",
      "2024 topps chrome baseball mike trout #UV-3",
      "2024 topps chrome baseball mike trout ultraviolet all-stars",
    );
  }
  for (const q of queries) {
    try {
      await probe(q);
    } catch (e) {
      console.log(
        `  failed: ${e instanceof Error ? e.message : e}`,
      );
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
