// Smoke test for the cardboardconnection RSS parser using a synthesized feed.
// Run: npx tsx scripts/test-parser.ts
import {
  parseFeed,
  detectManufacturer,
  detectSport,
  extractReleaseDate,
} from "../src/lib/sources/cardboardconnection";

const SAMPLE_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>The Cardboard Connection</title>
    <link>https://www.cardboardconnection.com</link>
    <description>Trading card news and reviews</description>
    <item>
      <title><![CDATA[2025 Topps Finest Football Set Review and Checklist]]></title>
      <link>https://www.cardboardconnection.com/2025-topps-finest-football-set-review-and-checklist</link>
      <pubDate>Sat, 26 Apr 2026 12:00:00 +0000</pubDate>
      <description><![CDATA[2025 Topps Finest Football marks a major return of the iconic brand to licensed NFL cards. Released on April 26, 2026, it builds on prior years.]]></description>
    </item>
    <item>
      <title><![CDATA[2026 Topps Chrome Black Baseball Set Review and Checklist]]></title>
      <link>https://www.cardboardconnection.com/2026-topps-chrome-black-baseball-set-review-and-checklist</link>
      <pubDate>Tue, 29 Apr 2026 12:00:00 +0000</pubDate>
      <description><![CDATA[Released on April 29, 2026, it builds on prior years with a compact 200-card base set.]]></description>
    </item>
    <item>
      <title><![CDATA[2026 Panini Donruss Racing NASCAR Set Review and Checklist]]></title>
      <link>https://www.cardboardconnection.com/2026-panini-donruss-racing-nascar-set-review-and-checklist</link>
      <pubDate>Tue, 22 Apr 2026 12:00:00 +0000</pubDate>
      <description><![CDATA[2026 Panini Donruss Racing NASCAR drops on April 22, 2026, as the first major NASCAR trading card release of the year.]]></description>
    </item>
    <item>
      <title><![CDATA[2025 Bowman Chrome Baseball]]></title>
      <link>https://www.cardboardconnection.com/2025-bowman-chrome-baseball</link>
      <pubDate>Wed, 23 Jul 2025 12:00:00 +0000</pubDate>
      <description><![CDATA[Release Date: July 23, 2025. The flagship prospect product returns.]]></description>
    </item>
    <item>
      <title><![CDATA[2025 Panini Prizm Basketball]]></title>
      <link>https://www.cardboardconnection.com/2025-panini-prizm-basketball</link>
      <pubDate>Wed, 12 Mar 2025 12:00:00 +0000</pubDate>
      <description><![CDATA[(March 12, 2025) Panini Prizm Basketball returns for another season.]]></description>
    </item>
    <item>
      <title><![CDATA[2025 Upper Deck Series One Hockey]]></title>
      <link>https://www.cardboardconnection.com/2025-upper-deck-series-one-hockey</link>
      <pubDate>Wed, 12 Feb 2025 12:00:00 +0000</pubDate>
      <description><![CDATA[Upper Deck's flagship hockey product.]]></description>
    </item>
  </channel>
</rss>`;

const expected = [
  {
    nameStartsWith: "2025 Topps Finest Football",
    manufacturer: "Topps",
    sport: "NFL",
    releaseDateIso: "2026-04-26",
  },
  {
    nameStartsWith: "2026 Topps Chrome Black Baseball",
    manufacturer: "Topps",
    sport: "MLB",
    releaseDateIso: "2026-04-29",
  },
  {
    nameStartsWith: "2026 Panini Donruss Racing NASCAR",
    manufacturer: "Panini",
    sport: "Racing",
    releaseDateIso: "2026-04-22",
  },
  {
    nameStartsWith: "2025 Bowman Chrome Baseball",
    manufacturer: "Bowman",
    sport: "MLB",
    releaseDateIso: "2025-07-23",
  },
  {
    nameStartsWith: "2025 Panini Prizm Basketball",
    manufacturer: "Panini",
    sport: "NBA",
    releaseDateIso: "2025-03-12",
  },
  {
    nameStartsWith: "2025 Upper Deck Series One Hockey",
    manufacturer: "Upper Deck",
    sport: "NHL",
    releaseDateIso: null as string | null,
  },
];

const products = parseFeed(SAMPLE_FEED);
let failures = 0;
console.log(`Parsed ${products.length} items.`);
for (let i = 0; i < expected.length; i++) {
  const p = products[i];
  const e = expected[i];
  const dateIso = p.releaseDate ? p.releaseDate.toISOString().slice(0, 10) : null;
  const ok =
    p.name.startsWith(e.nameStartsWith) &&
    p.manufacturer === e.manufacturer &&
    p.sport === e.sport &&
    dateIso === e.releaseDateIso;
  console.log(
    `${ok ? "OK " : "FAIL"} ${p.name} | mfr=${p.manufacturer} sport=${p.sport} date=${dateIso} extId=${p.externalId}`,
  );
  if (!ok) {
    failures++;
    console.log(`     expected: mfr=${e.manufacturer} sport=${e.sport} date=${e.releaseDateIso}`);
  }
}

console.log("---");
console.log(`detectManufacturer("Topps Heritage"): ${detectManufacturer("Topps Heritage")}`);
console.log(`detectSport("WWE Chrome"): ${detectSport("WWE Chrome")}`);
console.log(
  `extractReleaseDate("hits shelves Sep. 5, 2025"): ${extractReleaseDate("hits shelves Sep. 5, 2025")?.toISOString()}`,
);

if (failures > 0) {
  console.error(`\n${failures} parser failure(s)`);
  process.exit(1);
}
console.log("\nAll parser checks passed.");
