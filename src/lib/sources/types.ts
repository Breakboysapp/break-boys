export type SourceProduct = {
  externalId: string;
  name: string;
  manufacturer: string | null;
  sport: string | null;
  releaseDate: Date | null;
  sourceUrl: string;
};

export type SyncResult = {
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
  warnings: string[];
};

export interface SourceProvider {
  /** Stable id used as `Product.source` value, e.g. "api:cardboardconnection". */
  id: string;
  /** Human-readable label for UI. */
  label: string;
  /** Fetch the latest items from the source. Should not mutate the DB. */
  fetch(): Promise<SourceProduct[]>;
}
