import { beckett } from "./beckett";
import { googleSheets } from "./google-sheets";
import type { ChecklistSource } from "./types";

export const CHECKLIST_SOURCES: ChecklistSource[] = [beckett, googleSheets];

export function pickSource(rawUrl: string): { source: ChecklistSource; url: URL } | null {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  for (const source of CHECKLIST_SOURCES) {
    if (source.canHandle(url)) return { source, url };
  }
  return null;
}

export type { ChecklistSource } from "./types";
