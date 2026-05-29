/**
 * MLB Stats API season-stats adapter (batch).
 *
 * One request per group (hitting / pitching) across all five MiLB
 * levels (sportIds=11,12,13,14,16). The API returns one row per
 * player per (team-stint × group), which we collapse to a single
 * highest-level row per (playerId, group) — same rationale as the
 * roster fetcher.
 *
 * The `limit` query param has a hard cap server-side around ~1000
 * rows per group in early-season; we set it high (5000) so we never
 * paginate in practice. If MiLB rolls deeper into the season and the
 * count climbs, swap in a paged loop here.
 */

const BASE = "https://statsapi.mlb.com/api/v1";
const SPORT_IDS = "11,12,13,14,16";

// Level priority for highest-level-wins dedupe (matches roster).
const LEVEL_BY_SPORT_ID: Record<number, string> = {
  11: "AAA",
  12: "AA",
  13: "A+",
  14: "A",
  16: "ROK",
};
const LEVEL_RANK: Record<string, number> = {
  AAA: 5,
  AA: 4,
  "A+": 3,
  A: 2,
  ROK: 1,
};

export type StatGroup = "hitting" | "pitching";

export type MilbStatLineRecord = {
  mlbPlayerId: number;
  season: number;
  group: StatGroup;
  level: string;
  teamName: string | null;
  gamesPlayed: number;
  age: number | null;
  // Hitting
  plateAppearances: number | null;
  atBats: number | null;
  hits: number | null;
  homeRuns: number | null;
  baseOnBalls: number | null;
  strikeOuts: number | null;
  avg: number | null;
  obp: number | null;
  slg: number | null;
  ops: number | null;
  // Pitching
  inningsPitched: number | null;
  earnedRuns: number | null;
  era: number | null;
  whip: number | null;
};

type MlbSplit = {
  season: string;
  stat: Record<string, unknown>;
  team?: { id?: number; name?: string };
  player?: { id?: number };
  sport?: { id?: number };
};

type StatsResponse = {
  stats: Array<{ splits: MlbSplit[] }>;
};

// MLB returns batting average etc. as strings like ".261". Convert
// to plain numbers (0.261). Returns null for missing / malformed.
function parseRate(v: unknown): number | null {
  if (v == null) return null;
  const s = String(v);
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}
function parseInnings(v: unknown): number | null {
  // MLB encodes "17.1" = 17 1/3 IP. Convert to a float that compares
  // sensibly — 17.1 → 17.333…, 17.2 → 17.667.
  if (v == null) return null;
  const s = String(v);
  const [whole, frac] = s.split(".");
  const w = parseInt(whole, 10);
  const f = parseInt(frac ?? "0", 10);
  if (!Number.isFinite(w)) return null;
  const thirds = f === 1 ? 1 / 3 : f === 2 ? 2 / 3 : 0;
  return w + thirds;
}
function whipFromStat(walks: number | null, hits: number | null, ip: number | null) {
  if (walks == null || hits == null || ip == null || ip <= 0) return null;
  return Math.round(((walks + hits) / ip) * 1000) / 1000;
}

export async function fetchMilbStatLines(
  group: StatGroup,
  season: number = new Date().getUTCFullYear(),
): Promise<MilbStatLineRecord[]> {
  const url = `${BASE}/stats?stats=season&group=${group}&season=${season}&sportIds=${SPORT_IDS}&limit=5000`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "BreakBoys/0.1 (+https://breakboys.app)",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`MLB Stats API ${group} failed: ${res.status}`);
  }
  const data = (await res.json()) as StatsResponse;
  const splits = data.stats?.[0]?.splits ?? [];

  // Highest-level-wins dedupe per player.
  const merged = new Map<number, MilbStatLineRecord>();
  for (const split of splits) {
    const playerId = split.player?.id;
    if (!playerId) continue;
    const sportId = split.sport?.id;
    const level = sportId != null ? LEVEL_BY_SPORT_ID[sportId] : undefined;
    if (!level) continue;
    const existing = merged.get(playerId);
    if (existing && LEVEL_RANK[existing.level] > LEVEL_RANK[level]) continue;

    const s = split.stat;
    const ip = parseInnings(s.inningsPitched);
    const walks = s.baseOnBalls != null ? Number(s.baseOnBalls) : null;
    const hits = s.hits != null ? Number(s.hits) : null;
    const record: MilbStatLineRecord = {
      mlbPlayerId: playerId,
      season,
      group,
      level,
      teamName: split.team?.name ?? null,
      gamesPlayed: Number(s.gamesPlayed ?? 0),
      age: s.age != null ? Number(s.age) : null,
      plateAppearances:
        s.plateAppearances != null ? Number(s.plateAppearances) : null,
      atBats: s.atBats != null ? Number(s.atBats) : null,
      hits,
      homeRuns: s.homeRuns != null ? Number(s.homeRuns) : null,
      baseOnBalls: walks,
      strikeOuts: s.strikeOuts != null ? Number(s.strikeOuts) : null,
      avg: parseRate(s.avg),
      obp: parseRate(s.obp),
      slg: parseRate(s.slg),
      ops: parseRate(s.ops),
      inningsPitched: ip,
      earnedRuns: s.earnedRuns != null ? Number(s.earnedRuns) : null,
      era: parseRate(s.era),
      whip: whipFromStat(walks, hits, ip),
    };
    merged.set(playerId, record);
  }
  return [...merged.values()];
}
