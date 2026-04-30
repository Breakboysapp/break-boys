import { parseChecklist } from "@/lib/csv";
import type {
  ChecklistImportResult,
  ChecklistSource,
} from "./types";

/**
 * Convert a Google Sheets share URL (any tab) into its CSV-export URL.
 * Returns null if it doesn't look like a Sheets URL.
 *
 * Examples:
 *   /spreadsheets/d/<ID>/edit#gid=123       → /export?format=csv&gid=123
 *   /spreadsheets/d/<ID>/edit?gid=123       → same
 *   /spreadsheets/d/<ID>                    → /export?format=csv
 */
export function toCsvExportUrl(url: URL): string | null {
  if (url.hostname !== "docs.google.com") return null;
  const m = url.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!m) return null;
  const id = m[1];
  let gid = url.searchParams.get("gid");
  if (!gid && url.hash) {
    const h = new URLSearchParams(url.hash.replace(/^#/, ""));
    gid = h.get("gid");
  }
  const params = new URLSearchParams({ format: "csv" });
  if (gid) params.set("gid", gid);
  return `https://docs.google.com/spreadsheets/d/${id}/export?${params.toString()}`;
}

export const googleSheets: ChecklistSource = {
  id: "google-sheets",
  label: "Google Sheets",
  canHandle(url: URL) {
    return (
      url.hostname === "docs.google.com" &&
      /\/spreadsheets\/d\//.test(url.pathname)
    );
  },
  async importFrom(url: URL): Promise<ChecklistImportResult> {
    const csvUrl = toCsvExportUrl(url);
    if (!csvUrl) {
      throw new Error("not a recognizable Google Sheets URL");
    }
    const res = await globalThis.fetch(csvUrl, { redirect: "follow" });
    if (!res.ok) {
      throw new Error(
        `Google Sheets export returned ${res.status} — make sure the sheet is shared with "Anyone with the link"`,
      );
    }
    const csv = await res.text();
    const rows = parseChecklist(csv);
    if (rows.length === 0) {
      throw new Error(
        "no rows parsed from sheet — required columns are Team, Player, Card #",
      );
    }
    return { rows, sourceUrl: csvUrl, notes: [] };
  },
};
