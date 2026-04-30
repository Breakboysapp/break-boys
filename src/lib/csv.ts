import Papa from "papaparse";
import { normalizeTeam } from "@/lib/teams";

export type ChecklistRow = {
  team: string;
  playerName: string;
  cardNumber: string;
  variation?: string;
};

const HEADER_ALIASES: Record<keyof ChecklistRow, string[]> = {
  team: ["team", "club", "franchise"],
  playerName: ["player", "player name", "name", "playername"],
  cardNumber: ["card #", "card number", "card no", "card", "no", "number", "cardnumber", "#"],
  variation: ["variation", "parallel", "insert", "subset", "set"],
};

function normalizeKey(raw: string): keyof ChecklistRow | null {
  const k = raw.trim().toLowerCase().replace(/[_\-.]/g, " ").replace(/\s+/g, " ");
  for (const field of Object.keys(HEADER_ALIASES) as Array<keyof ChecklistRow>) {
    if (HEADER_ALIASES[field].includes(k)) return field;
  }
  return null;
}

export function parseChecklist(input: string): ChecklistRow[] {
  const result = Papa.parse<Record<string, string>>(input.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  const rows: ChecklistRow[] = [];
  for (const row of result.data) {
    const mapped: Partial<ChecklistRow> = {};
    for (const [rawKey, rawValue] of Object.entries(row)) {
      const field = normalizeKey(rawKey);
      if (!field) continue;
      const value = (rawValue ?? "").toString().trim();
      if (!value) continue;
      mapped[field] = value;
    }
    if (mapped.team && mapped.playerName && mapped.cardNumber) {
      rows.push({
        // Normalize historical → current franchise (Brooklyn Dodgers → LAD).
        team: normalizeTeam(mapped.team),
        playerName: mapped.playerName,
        cardNumber: mapped.cardNumber,
        variation: mapped.variation || undefined,
      });
    }
  }
  return rows;
}
