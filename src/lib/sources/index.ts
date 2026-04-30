import { cardboardConnection } from "./cardboardconnection";
import type { SourceProvider } from "./types";

export const SOURCES: Record<string, SourceProvider> = {
  cardboardconnection: cardboardConnection,
};

export function getSource(slug: string): SourceProvider | null {
  return SOURCES[slug] ?? null;
}

export function listSources(): SourceProvider[] {
  return Object.values(SOURCES);
}
