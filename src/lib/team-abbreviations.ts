/**
 * Team abbreviations — used on the Score Card on mobile so team names
 * stop eating most of the row width. "New York Yankees" → "NYY".
 *
 * Coverage: NFL (32), MLB (30), NBA (30), NHL (32), WNBA (12) — every
 * franchise that appears on a current Beckett checklist + a few common
 * historical names that should still resolve gracefully.
 *
 * Lookups are case-insensitive on the canonical team-name string we
 * already store post-normalizeTeam(). Dual-team strings (e.g. "Mets/
 * Yankees") get split + mapped per part and rejoined.
 */

const ABBREVIATIONS: Record<string, string> = {
  // ── MLB ──
  "arizona diamondbacks": "ARI",
  "atlanta braves": "ATL",
  "baltimore orioles": "BAL",
  "boston red sox": "BOS",
  "chicago cubs": "CHC",
  "chicago white sox": "CWS",
  "cincinnati reds": "CIN",
  "cleveland guardians": "CLE",
  "colorado rockies": "COL",
  "detroit tigers": "DET",
  "houston astros": "HOU",
  "kansas city royals": "KC",
  "los angeles angels": "LAA",
  "los angeles dodgers": "LAD",
  "miami marlins": "MIA",
  "milwaukee brewers": "MIL",
  "minnesota twins": "MIN",
  "new york mets": "NYM",
  "new york yankees": "NYY",
  "athletics": "ATH", // post-Oakland rename
  "oakland athletics": "ATH",
  "philadelphia phillies": "PHI",
  "pittsburgh pirates": "PIT",
  "san diego padres": "SD",
  "san francisco giants": "SF",
  "seattle mariners": "SEA",
  "st. louis cardinals": "STL",
  "st louis cardinals": "STL",
  "tampa bay rays": "TB",
  "texas rangers": "TEX",
  "toronto blue jays": "TOR",
  "washington nationals": "WSN",

  // ── NFL ──
  "arizona cardinals": "ARI",
  "atlanta falcons": "ATL",
  "baltimore ravens": "BAL",
  "buffalo bills": "BUF",
  "carolina panthers": "CAR",
  "chicago bears": "CHI",
  "cincinnati bengals": "CIN",
  "cleveland browns": "CLE",
  "dallas cowboys": "DAL",
  "denver broncos": "DEN",
  "detroit lions": "DET",
  "green bay packers": "GB",
  "houston texans": "HOU",
  "indianapolis colts": "IND",
  "jacksonville jaguars": "JAX",
  "kansas city chiefs": "KC",
  "las vegas raiders": "LV",
  "los angeles chargers": "LAC",
  "los angeles rams": "LAR",
  "miami dolphins": "MIA",
  "minnesota vikings": "MIN",
  "new england patriots": "NE",
  "new orleans saints": "NO",
  "new york giants": "NYG",
  "new york jets": "NYJ",
  "philadelphia eagles": "PHI",
  "pittsburgh steelers": "PIT",
  "san francisco 49ers": "SF",
  "seattle seahawks": "SEA",
  "tampa bay buccaneers": "TB",
  "tennessee titans": "TEN",
  "washington commanders": "WAS",

  // ── NBA ──
  "atlanta hawks": "ATL",
  "boston celtics": "BOS",
  "brooklyn nets": "BKN",
  "charlotte hornets": "CHA",
  "chicago bulls": "CHI",
  "cleveland cavaliers": "CLE",
  "dallas mavericks": "DAL",
  "denver nuggets": "DEN",
  "detroit pistons": "DET",
  "golden state warriors": "GSW",
  "houston rockets": "HOU",
  "indiana pacers": "IND",
  "los angeles clippers": "LAC",
  "los angeles lakers": "LAL",
  "memphis grizzlies": "MEM",
  "miami heat": "MIA",
  "milwaukee bucks": "MIL",
  "minnesota timberwolves": "MIN",
  "new orleans pelicans": "NOP",
  "new york knicks": "NYK",
  "oklahoma city thunder": "OKC",
  "orlando magic": "ORL",
  "philadelphia 76ers": "PHI",
  "phoenix suns": "PHX",
  "portland trail blazers": "POR",
  "sacramento kings": "SAC",
  "san antonio spurs": "SAS",
  "toronto raptors": "TOR",
  "utah jazz": "UTA",
  "washington wizards": "WAS",

  // ── WNBA ──
  "atlanta dream": "ATL",
  "chicago sky": "CHI",
  "connecticut sun": "CON",
  "dallas wings": "DAL",
  "indiana fever": "IND",
  "las vegas aces": "LV",
  "los angeles sparks": "LA",
  "minnesota lynx": "MIN",
  "new york liberty": "NYL",
  "phoenix mercury": "PHX",
  "seattle storm": "SEA",
  "washington mystics": "WAS",
  "golden state valkyries": "GSV",

  // ── NHL ──
  "anaheim ducks": "ANA",
  "arizona coyotes": "ARI",
  "utah hockey club": "UTA",
  "utah mammoth": "UTA",
  "boston bruins": "BOS",
  "buffalo sabres": "BUF",
  "calgary flames": "CGY",
  "carolina hurricanes": "CAR",
  "chicago blackhawks": "CHI",
  "colorado avalanche": "COL",
  "columbus blue jackets": "CBJ",
  "dallas stars": "DAL",
  "detroit red wings": "DET",
  "edmonton oilers": "EDM",
  "florida panthers": "FLA",
  "los angeles kings": "LAK",
  "minnesota wild": "MIN",
  "montreal canadiens": "MTL",
  "montréal canadiens": "MTL",
  "nashville predators": "NSH",
  "new jersey devils": "NJD",
  "new york islanders": "NYI",
  "new york rangers": "NYR",
  "ottawa senators": "OTT",
  "philadelphia flyers": "PHI",
  "pittsburgh penguins": "PIT",
  "san jose sharks": "SJS",
  "seattle kraken": "SEA",
  "st. louis blues": "STL",
  "st louis blues": "STL",
  "tampa bay lightning": "TBL",
  "toronto maple leafs": "TOR",
  "vancouver canucks": "VAN",
  "vegas golden knights": "VGK",
  "washington capitals": "WSH",
  "winnipeg jets": "WPG",
};

/**
 * Returns the abbreviation for a team string, or null if unknown.
 * Handles dual-team strings ("Mets/Yankees" → "NYM/NYY") by mapping
 * each part. If any part can't be mapped, returns null so the caller
 * can fall back to the full string.
 */
export function getTeamAbbreviation(team: string): string | null {
  if (!team) return null;
  if (team.includes("/")) {
    const parts = team.split("/").map((p) => abbreviateOne(p.trim()));
    if (parts.some((p) => p == null)) return null;
    return parts.join("/");
  }
  return abbreviateOne(team.trim());
}

function abbreviateOne(name: string): string | null {
  return ABBREVIATIONS[name.toLowerCase()] ?? null;
}
