/**
 * Pre-computed player sub-rows per team for the Team Scoreboard's
 * click-to-expand drilldown. Originally TeamBreakdownSheet received
 * a raw cards[] array and grouped on the client every time a row
 * expanded — that meant we shipped 1,200+ cards × 5 fields per
 * product (~200 KB on 2026 Bowman). Pre-grouping server-side
 * eliminates the raw card payload while keeping the same expand UX.
 */

import { classifyCard } from "@/lib/scoring";
import { isRookieVariation } from "@/lib/scoring";

export type ExpandedPlayerSubRow = {
  playerName: string;
  isRookie: boolean;
  /** bucket label → list of card numbers in that bucket. Plain
   *  object (not Map) so it serializes through React server
   *  components without conversion. */
  byBucket: Record<string, string[]>;
  totalScore: number;
};

export type TeamExpandedRows = Record<string, ExpandedPlayerSubRow[]>;

export function buildTeamExpandedRows(
  cards: Array<{
    team: string;
    playerName: string;
    cardNumber: string;
    variation: string | null;
  }>,
  bucketWeightByLabel: Map<string, number>,
): TeamExpandedRows {
  // team → playerName → row
  const byTeam = new Map<string, Map<string, ExpandedPlayerSubRow>>();
  for (const c of cards) {
    if (!c.team || !c.playerName) continue;
    const cls = classifyCard(c.cardNumber, c.variation);
    let teamMap = byTeam.get(c.team);
    if (!teamMap) {
      teamMap = new Map();
      byTeam.set(c.team, teamMap);
    }
    let row = teamMap.get(c.playerName);
    if (!row) {
      row = {
        playerName: c.playerName,
        isRookie: false,
        byBucket: {},
        totalScore: 0,
      };
      teamMap.set(c.playerName, row);
    }
    if (isRookieVariation(c.variation)) row.isRookie = true;
    if (!row.byBucket[cls.label]) row.byBucket[cls.label] = [];
    row.byBucket[cls.label].push(c.cardNumber);
    row.totalScore += bucketWeightByLabel.get(cls.label) ?? cls.weight;
  }
  const out: TeamExpandedRows = {};
  for (const [team, players] of byTeam) {
    out[team] = [...players.values()].sort(
      (a, b) => b.totalScore - a.totalScore,
    );
  }
  return out;
}
