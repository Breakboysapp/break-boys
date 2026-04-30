import * as XLSX from "xlsx";
import { normalizeTeam } from "@/lib/teams";
import type {
  ChecklistImportResult,
  ChecklistRow,
  ChecklistSource,
} from "./types";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Sheets that duplicate or summarize the granular sheets — skip to avoid
// inflating row counts. "Full Checklist" / "Team Sets" appear on newer
// Beckett xlsx as cross-cuts of Base + Autographs + Inserts that re-organize
// the same content. "Team Sets" is also column-shifted ([section, cardNum,
// player, team] vs [cardNum, player, team]), so skipping is the safest move.
const SKIP_SHEETS = new Set([
  "teams",
  "team sets",
  "master",
  "summary",
  "full checklist",
  "complete checklist",
]);

/** Sheet name → variation label; Base sheets get no variation. */
function sheetVariation(sheetName: string): string | null {
  const lower = sheetName.trim().toLowerCase();
  if (lower === "base" || lower === "base set" || lower === "checklist") return null;
  return sheetName.trim();
}

/** Inspect a row to decide if it's a card row (col A is a card number). */
function asCardRow(row: unknown[]): {
  cardNumber: string;
  playerName: string;
  team: string;
  rcFlag: boolean;
} | null {
  const colA = row[0];
  const colB = row[1];
  const colC = row[2];
  const colD = row[3];

  // card number can be number or string like "AU-1"
  let cardNumber: string;
  if (typeof colA === "number" && Number.isFinite(colA)) {
    cardNumber = String(colA);
  } else if (typeof colA === "string" && colA.trim().length > 0) {
    cardNumber = colA.trim();
  } else {
    return null;
  }

  // Beckett often appends a trailing comma to player names ("Shohei Ohtani,").
  const playerName =
    typeof colB === "string" ? colB.trim().replace(/,$/, "").trim() : "";
  // Normalize historical → current franchise so legends roll up sensibly:
  // Sandy Koufax (Brooklyn Dodgers) → Los Angeles Dodgers, etc.
  const teamRaw = typeof colC === "string" ? colC.trim() : "";
  const team = normalizeTeam(teamRaw);
  if (!playerName || !team) return null;

  const rcFlag =
    typeof colD === "string" && /^\(?rc\)?$/i.test(colD.trim());

  return { cardNumber, playerName, team, rcFlag };
}

/**
 * Detect column-header rows like `["Card #", "Player", "Type", "Notes"]` so
 * we don't accidentally treat them as section names. These appear right
 * before each subset's card list inside Inserts/Autographs sheets.
 */
const COLUMN_HEADER_LABELS = new Set([
  "card #",
  "card",
  "card no",
  "card no.",
  "card number",
  "#",
  "player",
  "players",
  "team",
  "team(s)",
  "type",
  "set",
  "notes",
  "rc?",
  "parallel",
]);

function isColumnHeaderRow(arr: unknown[]): boolean {
  // If at least 2 of the first 4 cells match column-header labels, it's a header.
  let hits = 0;
  for (let i = 0; i < 4; i++) {
    const v = arr[i];
    if (typeof v === "string" && COLUMN_HEADER_LABELS.has(v.trim().toLowerCase())) {
      hits++;
    }
  }
  return hits >= 2;
}

/** "50 cards" / "100 cards." — count rows that come after a section header. */
const COUNT_ROW_RE = /^\d+\s+cards?\.?$/i;

export function parseBeckettXlsx(buffer: ArrayBuffer): ChecklistRow[] {
  const wb = XLSX.read(buffer, { type: "array" });
  const out: ChecklistRow[] = [];

  for (const sheetName of wb.SheetNames) {
    if (SKIP_SHEETS.has(sheetName.trim().toLowerCase())) continue;
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      blankrows: false,
      defval: "",
    });
    // Track the most recent in-sheet section header (e.g. "Damascus",
    // "Talent Tracker", "Cosmic Mercury"). Falls back to the sheet name —
    // mapped through sheetVariation so "Base"/"Base Set" stay as null
    // (base cards don't get a variation tag).
    let currentSection: string | null = sheetVariation(sheetName);

    for (const row of rows) {
      const arr = row as unknown[];

      // Card row? Use the current section as the variation.
      const card = asCardRow(arr);
      if (card) {
        const variationParts: string[] = [];
        if (currentSection) variationParts.push(currentSection);
        if (card.rcFlag) variationParts.push("RC");
        out.push({
          cardNumber: card.cardNumber,
          playerName: card.playerName,
          team: card.team,
          variation:
            variationParts.length > 0 ? variationParts.join(" · ") : undefined,
        });
        continue;
      }

      // Not a card row. Could be a section header, count row, or column
      // header. We update currentSection from genuine section headers only.
      const colA = arr[0];
      if (typeof colA !== "string") continue;
      const text = colA.trim();
      if (!text) continue;
      if (COUNT_ROW_RE.test(text)) continue;
      if (isColumnHeaderRow(arr)) continue;

      // Section header looks like a single text cell (col B/C empty).
      const colB = arr[1];
      const colC = arr[2];
      const bEmpty = typeof colB !== "string" || !colB.trim();
      const cEmpty = typeof colC !== "string" || !colC.trim();
      if (bEmpty && cEmpty) {
        // Strip leading bullets/icons that Beckett uses for section markers.
        currentSection = text.replace(/^[\s▶•·\-]+/u, "").trim() || null;
      }
    }
  }
  return out;
}

/**
 * Hostnames Beckett serves their checklist xlsx files from. Older articles
 * use img.beckett.com; newer ones (late 2025+) use a Beckett-owned AWS S3
 * bucket. Accept either.
 */
const BECKETT_XLSX_HOSTS = [
  "beckett.com", // matches img.beckett.com, www.beckett.com, etc.
  "beckett-www.s3.amazonaws.com",
];

/** Locate the .xlsx download URL inside a Beckett checklist article. */
export function findXlsxLink(html: string, baseUrl: URL): string | null {
  // Match the URL inside attribute values OR plain text — newer Beckett
  // pages sometimes drop the link in JSON blobs/data attributes that the
  // simple `href="..."` regex misses.
  const re = /\bhttps?:\/\/[^\s'"<>()]+\.xlsx(?:\?[^\s'"<>()]*)?/gi;
  const matches = html.match(re);
  if (!matches) return null;
  for (const raw of matches) {
    try {
      const u = new URL(raw, baseUrl);
      if (BECKETT_XLSX_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith("." + h) || u.hostname.endsWith(h))) {
        return u.toString();
      }
    } catch {
      // ignore malformed URL
    }
  }
  return null;
}

async function fetchWithBrowserUa(url: string): Promise<Response> {
  const res = await globalThis.fetch(url, {
    headers: { "User-Agent": BROWSER_UA, Accept: "*/*" },
    redirect: "follow",
  });
  return res;
}

export const beckett: ChecklistSource = {
  id: "beckett",
  label: "Beckett",
  canHandle(url: URL) {
    return url.hostname.endsWith("beckett.com");
  },
  async importFrom(url: URL): Promise<ChecklistImportResult> {
    const notes: string[] = [];
    let xlsxUrl: string;

    if (url.pathname.toLowerCase().endsWith(".xlsx")) {
      // Direct xlsx URL, skip article fetch.
      xlsxUrl = url.toString();
    } else {
      const articleRes = await fetchWithBrowserUa(url.toString());
      if (!articleRes.ok) {
        throw new Error(`Beckett article returned ${articleRes.status}`);
      }
      const html = await articleRes.text();
      const found = findXlsxLink(html, url);
      if (!found) {
        throw new Error(
          "couldn't find a checklist .xlsx link in the article — Beckett may have moved it",
        );
      }
      xlsxUrl = found;
      notes.push(`xlsx: ${xlsxUrl}`);
    }

    const xlsxRes = await fetchWithBrowserUa(xlsxUrl);
    if (!xlsxRes.ok) {
      throw new Error(`Beckett xlsx returned ${xlsxRes.status}`);
    }
    const buf = await xlsxRes.arrayBuffer();
    const rows = parseBeckettXlsx(buf);
    if (rows.length === 0) {
      throw new Error("xlsx parsed to zero rows — format may have changed");
    }
    return { rows, sourceUrl: xlsxUrl, notes };
  },
};
