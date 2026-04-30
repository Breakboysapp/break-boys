export type ChecklistRow = {
  team: string;
  playerName: string;
  cardNumber: string;
  variation?: string;
};

export type ChecklistImportResult = {
  rows: ChecklistRow[];
  sourceUrl: string;
  notes: string[];
};

export interface ChecklistSource {
  /** Stable id, e.g. "beckett". */
  id: string;
  /** Human-readable label. */
  label: string;
  /** Decide whether this source can handle the given URL. */
  canHandle(url: URL): boolean;
  /** Fetch + parse the URL and return checklist rows. */
  importFrom(url: URL): Promise<ChecklistImportResult>;
}
