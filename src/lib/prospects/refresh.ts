/**
 * Shared refresh routine for the MLB Pipeline Top 100 ranking.
 *
 * Called from the admin button (/api/admin/prospects) and the weekly
 * cron (/api/cron/refresh-prospects). Wipes-and-replaces the existing
 * `mlb-pipeline` / `MLB` rows so players who drop off the list (graduations,
 * trades, demotions) actually disappear from /prospects — an upsert
 * alone would leave stale entries forever.
 */

import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import { normalizeKey } from "@/lib/player-name-normalize";
import { fetchMlbPipelineTop100 } from "@/lib/sources/prospects/mlb-pipeline";

export type ProspectsRefreshResult = {
  parsed: number;
  inserted: number;
  capturedAt: string;
  sample: Array<{ rank: number; playerName: string; org: string | null }>;
};

export async function refreshMlbPipelineTop100(): Promise<ProspectsRefreshResult> {
  const prospects = await fetchMlbPipelineTop100();
  if (prospects.length === 0) {
    throw new Error("MLB Pipeline fetcher returned zero prospects");
  }

  const source = "mlb-pipeline";
  const sport = "MLB";
  const now = new Date();

  await prisma.$transaction([
    prisma.prospectRanking.deleteMany({ where: { source, sport } }),
    prisma.prospectRanking.createMany({
      data: prospects.map((p) => ({
        source,
        sport,
        rank: p.rank,
        playerName: p.playerName,
        normalizedName: normalizeKey(p.playerName),
        position: p.position,
        org: p.org,
        level: p.level,
        age: p.age,
        capturedAt: now,
      })),
    }),
  ]);

  revalidateTag("prospects");

  return {
    parsed: prospects.length,
    inserted: prospects.length,
    capturedAt: now.toISOString(),
    sample: prospects.slice(0, 5).map((p) => ({
      rank: p.rank,
      playerName: p.playerName,
      org: p.org,
    })),
  };
}
