/**
 * International / national team remap for "Anime"-style insert cards.
 *
 * Some Bowman / Topps inserts (the 2026 Bowman "Anime" subset is the
 * canonical example) place superstar players on their NATIONAL team
 * affiliation — Cal Raleigh on "USA", Shohei Ohtani on "Japan", Juan
 * Soto on "Dominican Republic" — instead of their MLB team. As-is,
 * each anime card spawns a one-off "USA" / "Japan" / "DR" row in the
 * team breakdown that nobody actually buys into.
 *
 * The fix: at display time, swap each international-team card's
 * `team` to the player's MLB team (sourced from the rest of their
 * cards in the same product) and stash the original "USA" / "Japan"
 * / etc. on a new `internationalTeam` field so the UI can surface it.
 *
 * Pure data transform — no DB writes. Works the same on staging and
 * prod the moment the build deploys.
 */

const NATIONAL_TEAMS = new Set([
  "USA",
  "U.S.A.",
  "United States",
  "Japan",
  "Dominican Republic",
  "DR",
  "Mexico",
  "Venezuela",
  "Cuba",
  "Puerto Rico",
  "Canada",
  "Korea",
  "South Korea",
  "Taiwan",
  "Chinese Taipei",
  "Netherlands",
  "Italy",
  "Israel",
  "Australia",
  "Colombia",
  "Nicaragua",
  "Panama",
]);

export function isNationalTeam(team: string | null | undefined): boolean {
  if (!team) return false;
  return NATIONAL_TEAMS.has(team.trim());
}

/**
 * Build a map of playerName → real team, sourced from all of their
 * non-international cards in the input array. Players who appear ONLY
 * on a national team card (rare — usually overseas-pro-only legends
 * like Sadaharu Oh) are absent from the map; their cards stay on the
 * national-team row.
 */
function buildPlayerRealTeamMap<
  C extends { playerName: string; team: string },
>(cards: C[]): Map<string, string> {
  const teamCounts = new Map<string, Map<string, number>>();
  for (const c of cards) {
    if (!c.playerName || !c.team) continue;
    if (isNationalTeam(c.team)) continue;
    if (c.team === "—") continue;
    let inner = teamCounts.get(c.playerName);
    if (!inner) {
      inner = new Map();
      teamCounts.set(c.playerName, inner);
    }
    inner.set(c.team, (inner.get(c.team) ?? 0) + 1);
  }
  // Resolve to the most-common non-international team per player.
  // Ties broken alphabetically for determinism.
  const out = new Map<string, string>();
  for (const [name, inner] of teamCounts) {
    const entries = [...inner.entries()].sort(
      ([a, na], [b, nb]) => nb - na || a.localeCompare(b),
    );
    out.set(name, entries[0][0]);
  }
  return out;
}

/**
 * Remap each card on a national team to the player's MLB team when
 * the player has any non-international cards in the same product.
 * Returns a new array; original card objects are not mutated.
 *
 * The original national team is captured on `internationalTeam` so
 * the UI can render it as a tag ("Anime: USA") next to the player's
 * name without losing information.
 */
export function remapInternationalAnime<
  C extends {
    team: string;
    playerName: string;
    variation: string | null;
  },
>(
  cards: C[],
): Array<C & { internationalTeam: string | null }> {
  const realTeam = buildPlayerRealTeamMap(cards);
  return cards.map((c) => {
    if (!isNationalTeam(c.team)) {
      return { ...c, internationalTeam: null };
    }
    const remapped = realTeam.get(c.playerName);
    if (!remapped) {
      // No fallback team available — leave the card on its national
      // team row but still surface the country tag for consistency.
      return { ...c, internationalTeam: c.team };
    }
    return {
      ...c,
      team: remapped,
      internationalTeam: c.team,
    };
  });
}

/**
 * Per-player rollup of which international team(s) they appear under
 * via "Anime"-type inserts. Returns playerName → comma-separated
 * country list (usually just one). Used by the Chase view to render
 * an "Anime: USA" subtitle line beneath the player name.
 */
export function buildPlayerInternationalMap(
  cards: Array<{ playerName: string; internationalTeam: string | null }>,
): Record<string, string> {
  const seen = new Map<string, Set<string>>();
  for (const c of cards) {
    if (!c.internationalTeam) continue;
    let set = seen.get(c.playerName);
    if (!set) {
      set = new Set();
      seen.set(c.playerName, set);
    }
    set.add(c.internationalTeam);
  }
  const out: Record<string, string> = {};
  for (const [name, set] of seen) {
    out[name] = [...set].sort().join(", ");
  }
  return out;
}
