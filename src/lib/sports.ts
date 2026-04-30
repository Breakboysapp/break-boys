/**
 * Canonical team lists per sport.
 *
 * The break picker reads these — not the per-checklist team field — so the
 * UI is stable across products. A 32-team NFL picker should always show 32
 * teams whether the underlying xlsx has 32, 35, or 393 distinct labels.
 *
 * Card-level team data (Card.team) still comes from the checklist (it's the
 * actual team a given card is associated with). The picker just filters the
 * universe of selectable teams down to the canonical set; cards whose team
 * doesn't match any canonical name roll into a "Prospects / Other" bucket.
 *
 * Single source of truth — when a team name surfaces in the wild that
 * should match (e.g. a typo in a Beckett xlsx), add an alias entry, don't
 * fork the canonical list.
 */

export type SportKey = "MLB" | "NBA" | "NFL" | "NHL" | "Soccer";

export const NFL_TEAMS = [
  "Arizona Cardinals",
  "Atlanta Falcons",
  "Baltimore Ravens",
  "Buffalo Bills",
  "Carolina Panthers",
  "Chicago Bears",
  "Cincinnati Bengals",
  "Cleveland Browns",
  "Dallas Cowboys",
  "Denver Broncos",
  "Detroit Lions",
  "Green Bay Packers",
  "Houston Texans",
  "Indianapolis Colts",
  "Jacksonville Jaguars",
  "Kansas City Chiefs",
  "Las Vegas Raiders",
  "Los Angeles Chargers",
  "Los Angeles Rams",
  "Miami Dolphins",
  "Minnesota Vikings",
  "New England Patriots",
  "New Orleans Saints",
  "New York Giants",
  "New York Jets",
  "Philadelphia Eagles",
  "Pittsburgh Steelers",
  "San Francisco 49ers",
  "Seattle Seahawks",
  "Tampa Bay Buccaneers",
  "Tennessee Titans",
  "Washington Commanders",
];

export const NBA_TEAMS = [
  "Atlanta Hawks",
  "Boston Celtics",
  "Brooklyn Nets",
  "Charlotte Hornets",
  "Chicago Bulls",
  "Cleveland Cavaliers",
  "Dallas Mavericks",
  "Denver Nuggets",
  "Detroit Pistons",
  "Golden State Warriors",
  "Houston Rockets",
  "Indiana Pacers",
  "Los Angeles Clippers",
  "Los Angeles Lakers",
  "Memphis Grizzlies",
  "Miami Heat",
  "Milwaukee Bucks",
  "Minnesota Timberwolves",
  "New Orleans Pelicans",
  "New York Knicks",
  "Oklahoma City Thunder",
  "Orlando Magic",
  "Philadelphia 76ers",
  "Phoenix Suns",
  "Portland Trail Blazers",
  "Sacramento Kings",
  "San Antonio Spurs",
  "Toronto Raptors",
  "Utah Jazz",
  "Washington Wizards",
];

export const MLB_TEAMS = [
  "Arizona Diamondbacks",
  "Athletics",
  "Atlanta Braves",
  "Baltimore Orioles",
  "Boston Red Sox",
  "Chicago Cubs",
  "Chicago White Sox",
  "Cincinnati Reds",
  "Cleveland Guardians",
  "Colorado Rockies",
  "Detroit Tigers",
  "Houston Astros",
  "Kansas City Royals",
  "Los Angeles Angels",
  "Los Angeles Dodgers",
  "Miami Marlins",
  "Milwaukee Brewers",
  "Minnesota Twins",
  "New York Mets",
  "New York Yankees",
  "Philadelphia Phillies",
  "Pittsburgh Pirates",
  "San Diego Padres",
  "San Francisco Giants",
  "Seattle Mariners",
  "St. Louis Cardinals",
  "Tampa Bay Rays",
  "Texas Rangers",
  "Toronto Blue Jays",
  "Washington Nationals",
];

export const NHL_TEAMS = [
  "Anaheim Ducks",
  "Boston Bruins",
  "Buffalo Sabres",
  "Calgary Flames",
  "Carolina Hurricanes",
  "Chicago Blackhawks",
  "Colorado Avalanche",
  "Columbus Blue Jackets",
  "Dallas Stars",
  "Detroit Red Wings",
  "Edmonton Oilers",
  "Florida Panthers",
  "Los Angeles Kings",
  "Minnesota Wild",
  "Montreal Canadiens",
  "Nashville Predators",
  "New Jersey Devils",
  "New York Islanders",
  "New York Rangers",
  "Ottawa Senators",
  "Philadelphia Flyers",
  "Pittsburgh Penguins",
  "San Jose Sharks",
  "Seattle Kraken",
  "St. Louis Blues",
  "Tampa Bay Lightning",
  "Toronto Maple Leafs",
  "Utah Hockey Club",
  "Vancouver Canucks",
  "Vegas Golden Knights",
  "Washington Capitals",
  "Winnipeg Jets",
];

const SPORT_TO_TEAMS: Record<SportKey, string[]> = {
  MLB: MLB_TEAMS,
  NBA: NBA_TEAMS,
  NFL: NFL_TEAMS,
  NHL: NHL_TEAMS,
  Soccer: [], // soccer has too many leagues to canonicalize without a league field; punt for now
};

/** Pseudo-team buckets the picker may show alongside canonical teams. */
export const PROSPECTS_BUCKET = "Prospects / Other";

export function canonicalTeamsForSport(sport: string): string[] {
  return SPORT_TO_TEAMS[sport as SportKey] ?? [];
}

export function isCanonicalTeam(sport: string, team: string): boolean {
  const list = canonicalTeamsForSport(sport);
  return list.includes(team);
}

/**
 * Bucketize a checklist's actual team field into the picker's view:
 *   - canonical teams → keep as-is
 *   - anything else (college teams, malformed rows, multi-team strings) →
 *     roll into PROSPECTS_BUCKET so the picker stays clean
 *
 * The card itself keeps its real team string in the DB; this is purely a
 * display/picker-time transform.
 */
export function bucketTeam(sport: string, team: string): string {
  if (canonicalTeamsForSport(sport).length === 0) return team; // no canonical list — passthrough
  if (isCanonicalTeam(sport, team)) return team;
  return PROSPECTS_BUCKET;
}
