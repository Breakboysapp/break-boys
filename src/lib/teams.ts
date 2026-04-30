/**
 * Historical team-name → current franchise mapping.
 *
 * Beckett xlsx files tag legend autographs with the player's *historical*
 * team (Sandy Koufax → "Brooklyn Dodgers", Barry Bonds → "Pittsburgh
 * Pirates" on his rookie cards, etc.). Most breakers consolidate these
 * into the current franchise so a buyer who bought "Dodgers" also gets the
 * Brooklyn-era Koufax auto in their slot.
 *
 * Apply via `normalizeTeam()` at import time (Beckett parser) so the stored
 * data is already canonical, and at any other write/query point that needs
 * to be safe.
 *
 * Edit this map as new historical aliases surface — single source of truth.
 */

const ALIASES: Record<string, string> = {
  // MLB — franchise relocations / renames
  "brooklyn dodgers": "Los Angeles Dodgers",
  "new york giants": "San Francisco Giants",
  "boston braves": "Atlanta Braves",
  "milwaukee braves": "Atlanta Braves",
  "st. louis browns": "Baltimore Orioles",
  "washington senators": "Minnesota Twins", // 1901–1960 franchise → Twins
  // (The 1961-expansion Senators that became the Rangers are unlikely to
  //  appear on modern checklists; if they do, fix here.)
  "philadelphia athletics": "Athletics",
  "kansas city athletics": "Athletics",
  "oakland athletics": "Athletics",
  "montreal expos": "Washington Nationals",
  "montréal expos": "Washington Nationals",
  "florida marlins": "Miami Marlins",
  "tampa bay devil rays": "Tampa Bay Rays",
  "anaheim angels": "Los Angeles Angels",
  "california angels": "Los Angeles Angels",
  "los angeles angels of anaheim": "Los Angeles Angels",
  "cleveland indians": "Cleveland Guardians",
  // NFL
  "st. louis rams": "Los Angeles Rams",
  "san diego chargers": "Los Angeles Chargers",
  "oakland raiders": "Las Vegas Raiders",
  "los angeles raiders": "Las Vegas Raiders",
  "houston oilers": "Tennessee Titans",
  "tennessee oilers": "Tennessee Titans",
  "washington redskins": "Washington Commanders",
  "washington football team": "Washington Commanders",
  // NBA
  "new jersey nets": "Brooklyn Nets",
  "seattle supersonics": "Oklahoma City Thunder",
  "vancouver grizzlies": "Memphis Grizzlies",
  "charlotte bobcats": "Charlotte Hornets",
  "new orleans hornets": "New Orleans Pelicans",
  "new orleans/oklahoma city hornets": "New Orleans Pelicans",
  // NHL
  "atlanta thrashers": "Winnipeg Jets",
  "phoenix coyotes": "Arizona Coyotes", // pre-Utah; if we see Utah HC etc. extend
};

/**
 * Multi-team strings like "Pittsburgh Pirates/Athletics" appear when a card
 * features players across teams. We split on `/`, normalize each, and join
 * back so dual-team cards still get attributed sensibly. Most breakers
 * still treat these as a single shared row, so we keep the joined form.
 */
export function normalizeTeam(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  if (trimmed.includes("/")) {
    return trimmed
      .split("/")
      .map((part) => normalizeOne(part))
      .join("/");
  }
  return normalizeOne(trimmed);
}

function normalizeOne(name: string): string {
  const key = name.trim().toLowerCase();
  return ALIASES[key] ?? name.trim();
}

/**
 * Returns true if the team name is a known historical alias. Useful for
 * UI badges ("Historical: Brooklyn Dodgers → Los Angeles Dodgers").
 */
export function isHistoricalAlias(raw: string): boolean {
  return raw.trim().toLowerCase() in ALIASES;
}
