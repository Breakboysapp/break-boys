import { XMLParser } from "fast-xml-parser";
import type { SourceProduct, SourceProvider } from "./types";

const FEED_URL = "https://www.cardboardconnection.com/feed";
const USER_AGENT =
  "BreakBoys/0.1 (+https://github.com/your-org/break-boys; calendar-sync)";

type RssItem = {
  title: string;
  link: string;
  pubDate?: string;
  description?: string;
  "content:encoded"?: string;
  category?: string | string[];
};

const MANUFACTURER_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  // Order matters — more specific first.
  { pattern: /\bbowman\b/i, name: "Bowman" },
  { pattern: /\bstadium club\b/i, name: "Stadium Club" },
  { pattern: /\bpanini\b/i, name: "Panini" },
  { pattern: /\btopps\b/i, name: "Topps" },
  { pattern: /\bupper deck\b/i, name: "Upper Deck" },
  { pattern: /\bleaf\b/i, name: "Leaf" },
  { pattern: /\bonyx\b/i, name: "Onyx" },
  { pattern: /\bwild card\b/i, name: "Wild Card" },
  { pattern: /\bsage\b/i, name: "Sage" },
  { pattern: /\bfanatics\b/i, name: "Fanatics" },
];

const SPORT_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /\bbaseball\b|\bmlb\b/i, name: "MLB" },
  { pattern: /\bfootball\b|\bnfl\b/i, name: "NFL" },
  { pattern: /\bbasketball\b|\bnba\b|\bwnba\b/i, name: "NBA" },
  { pattern: /\bhockey\b|\bnhl\b/i, name: "NHL" },
  { pattern: /\bsoccer\b|\bfutbol\b|\bmls\b|\bpremier league\b/i, name: "Soccer" },
  { pattern: /\bnascar\b|\bracing\b|\bformula 1\b|\bf1\b/i, name: "Racing" },
  { pattern: /\bwwe\b|\bwrestling\b|\baew\b/i, name: "Wrestling" },
  { pattern: /\bufc\b|\bmma\b/i, name: "UFC" },
  { pattern: /\bgolf\b|\bpga\b/i, name: "Golf" },
  { pattern: /\btennis\b/i, name: "Tennis" },
  { pattern: /\bpokemon\b|\btcg\b/i, name: "TCG" },
];

const RELEASE_DATE_PATTERNS: RegExp[] = [
  /(?:released?|releases?|drops?|debuts?|launches?|hits\s+shelves|street\s+date)\s+(?:on\s+)?(?:the\s+)?([A-Za-z]+\.?\s+\d{1,2}(?:st|nd|rd|th)?,\s*\d{4})/i,
  /release\s*date[:\s]+([A-Za-z]+\.?\s+\d{1,2}(?:st|nd|rd|th)?,\s*\d{4})/i,
  /\(([A-Za-z]+\.?\s+\d{1,2}(?:st|nd|rd|th)?,\s*\d{4})\)/,
  /\b([A-Za-z]+\.?\s+\d{1,2}(?:st|nd|rd|th)?,\s*\d{4})\b/,
];

export function detectManufacturer(text: string): string | null {
  for (const { pattern, name } of MANUFACTURER_PATTERNS) {
    if (pattern.test(text)) return name;
  }
  return null;
}

export function detectSport(text: string): string | null {
  for (const { pattern, name } of SPORT_PATTERNS) {
    if (pattern.test(text)) return name;
  }
  return null;
}

export function extractReleaseDate(text: string): Date | null {
  const cleaned = text.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
  for (const re of RELEASE_DATE_PATTERNS) {
    const m = cleaned.match(re);
    if (!m) continue;
    const candidate = m[1].replace(/(\d+)(?:st|nd|rd|th)/i, "$1");
    const date = new Date(candidate);
    if (Number.isNaN(date.getTime())) continue;
    const year = date.getUTCFullYear();
    if (year < 2015 || year > 2035) continue;
    return date;
  }
  return null;
}

export function slugFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname.replace(/^\/+|\/+$/g, "");
  } catch {
    return url;
  }
}

export function parseFeed(xml: string): SourceProduct[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    cdataPropName: "__cdata",
    textNodeName: "#text",
  });
  const doc = parser.parse(xml);
  const itemsRaw = doc?.rss?.channel?.item;
  const items: RssItem[] = Array.isArray(itemsRaw) ? itemsRaw : itemsRaw ? [itemsRaw] : [];

  const products: SourceProduct[] = [];
  for (const item of items) {
    const title = unwrap(item.title);
    const link = unwrap(item.link);
    if (!title || !link) continue;

    const haystack = [
      title,
      unwrap(item.description) ?? "",
      unwrap(item["content:encoded"]) ?? "",
    ].join(" \n ");

    const releaseDate = extractReleaseDate(haystack);
    const manufacturer = detectManufacturer(title) ?? detectManufacturer(haystack);
    const sport = detectSport(title) ?? detectSport(haystack);

    products.push({
      externalId: slugFromUrl(link),
      name: cleanTitle(title),
      manufacturer,
      sport,
      releaseDate,
      sourceUrl: link,
    });
  }
  return products;
}

function cleanTitle(raw: string): string {
  // Strip suffixes like "Set Review and Checklist", "Review", trailing dashes.
  return raw
    .replace(/\s+set\s+review\s+and\s+checklist\s*$/i, "")
    .replace(/\s+review\s+and\s+checklist\s*$/i, "")
    .replace(/\s+checklist\s*$/i, "")
    .replace(/\s+review\s*$/i, "")
    .replace(/[\s\-–—]+$/g, "")
    .trim();
}

function unwrap(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.__cdata === "string") return obj.__cdata;
    if (typeof obj["#text"] === "string") return obj["#text"];
  }
  return undefined;
}

export const cardboardConnection: SourceProvider = {
  id: "api:cardboardconnection",
  label: "Cardboard Connection",
  async fetch() {
    const res = await globalThis.fetch(FEED_URL, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/rss+xml,text/xml;q=0.9" },
      // Next.js fetch cache: revalidate hourly
      next: { revalidate: 3600 },
    } as RequestInit);
    if (!res.ok) {
      throw new Error(`Cardboard Connection feed returned ${res.status}`);
    }
    const xml = await res.text();
    return parseFeed(xml);
  },
};
