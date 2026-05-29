/**
 * MLB Stats API roster adapter.
 *
 * One request per Minor League level (AAA / AA / A+ / A / Rookie),
 * merged into a single deduplicated roster. Players who appear at
 * multiple levels mid-season (called up from AA → AAA, etc.) collapse
 * to their highest level — that's how MLB Pipeline + the hobby reads
 * "where is he playing right now."
 *
 * No auth required — statsapi.mlb.com is the same public endpoint
 * used by mlb.com/milb itself.
 */

const BASE = "https://statsapi.mlb.com/api/v1";

// sportId → display level. Order matters: highest-level first so the
// dedupe pass keeps a player's highest assignment when they've been
// jumping levels.
const LEVELS: Array<{ sportId: number; level: string }> = [
  { sportId: 11, level: "AAA" },
  { sportId: 12, level: "AA" },
  { sportId: 13, level: "A+" },
  { sportId: 14, level: "A" },
  { sportId: 16, level: "ROK" },
];

type MlbPerson = {
  id: number;
  fullName: string;
  currentAge?: number;
  primaryNumber?: string;
  currentTeam?: { id?: number; name?: string };
  primaryPosition?: { abbreviation?: string };
  batSide?: { code?: string };
  pitchHand?: { code?: string };
};

type SportPlayersResponse = {
  people: MlbPerson[];
};

export type MilbRosterEntry = {
  mlbPlayerId: number;
  playerName: string;
  level: string;
  teamId: number | null;
  teamName: string | null;
  position: string | null;
  age: number | null;
  bats: string | null;
  throws: string | null;
};

/**
 * Pulls every active player across the five MiLB levels for the
 * given season, deduped to one entry per player at their highest
 * current level.
 *
 * Typical 2026 response: ~7–9k unique players, ~1.5–2.5MB JSON per
 * level. Caller should cache this — it's not cheap to refetch on
 * every page render.
 */
export async function fetchMilbRoster(
  season: number = new Date().getUTCFullYear(),
): Promise<MilbRosterEntry[]> {
  const merged = new Map<number, MilbRosterEntry>();

  for (const { sportId, level } of LEVELS) {
    const url = `${BASE}/sports/${sportId}/players?season=${season}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "BreakBoys/0.1 (+https://breakboys.app)" },
      // statsapi caches well on their CDN; if the same season is
      // fetched twice within a minute, the second call comes back
      // from cache.
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(
        `MLB Stats API ${sportId} (${level}) failed: ${res.status}`,
      );
    }
    const data = (await res.json()) as SportPlayersResponse;
    for (const p of data.people ?? []) {
      // First level wins because LEVELS is ordered highest → lowest.
      // A guy promoted AA → AAA mid-season will appear in both lists;
      // we want him as "AAA".
      if (merged.has(p.id)) continue;
      merged.set(p.id, {
        mlbPlayerId: p.id,
        playerName: p.fullName,
        level,
        teamId: p.currentTeam?.id ?? null,
        teamName: p.currentTeam?.name ?? null,
        position: p.primaryPosition?.abbreviation ?? null,
        age: p.currentAge ?? null,
        bats: p.batSide?.code ?? null,
        throws: p.pitchHand?.code ?? null,
      });
    }
  }

  return [...merged.values()];
}
