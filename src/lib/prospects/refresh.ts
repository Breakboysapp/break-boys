/**
 * Refreshes the MLB Pipeline Top 100 ranking in place.
 *
 * Snapshot semantics: every refresh wipes the prior (source="mlb-pipeline",
 * sport="MLB") rows and writes the freshly-fetched list. The wipe is
 * deliberate — when a prospect graduates, gets traded, or just drops
 * off the list, they need to disappear from /prospects. A pure upsert
 * would leave stale entries forever.
 *
 * Before deleting, we snapshot the prior `rank` by `normalizedName`
 * and write each carry-over as `previousRank` on the new row. That's
 * what powers the ↑N / ↓N / NEW chip on the index.
 *
 * Called from /prospects (auto-seed when the table is empty) and the
 * weekly /api/cron/refresh-prospects job. No admin button — the only
 * mutation surface is the cron.
 */

import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import { normalizeKey } from "@/lib/player-name-normalize";
import { fetchMlbPipelineTop100 } from "@/lib/sources/prospects/mlb-pipeline";

export type ProspectsRefreshResult = {
  parsed: number;
  inserted: number;
  carriedOver: number;
  newEntries: number;
  capturedAt: string;
};

const SOURCE = "mlb-pipeline";
const SPORT = "MLB";

export async function refreshMlbPipelineTop100(): Promise<ProspectsRefreshResult> {
  const prospects = await fetchMlbPipelineTop100();
  if (prospects.length === 0) {
    throw new Error("MLB Pipeline fetcher returned zero prospects");
  }

  const now = new Date();

  // Snapshot prior ranks so we can populate previousRank on the new
  // rows — and so the wipe doesn't lose the movement signal.
  const prior = await prisma.prospectRanking.findMany({
    where: { source: SOURCE, sport: SPORT },
    select: { normalizedName: true, rank: true },
  });
  const priorByName = new Map(prior.map((p) => [p.normalizedName, p.rank]));

  const rows = prospects.map((p) => {
    const normalizedName = normalizeKey(p.playerName);
    return {
      source: SOURCE,
      sport: SPORT,
      rank: p.rank,
      playerName: p.playerName,
      normalizedName,
      position: p.position,
      org: p.org,
      level: p.level,
      age: p.age,
      previousRank: priorByName.get(normalizedName) ?? null,
      capturedAt: now,
    };
  });

  await prisma.$transaction([
    prisma.prospectRanking.deleteMany({
      where: { source: SOURCE, sport: SPORT },
    }),
    prisma.prospectRanking.createMany({ data: rows }),
  ]);

  // Best-effort. When called from inside a Server Component render
  // (the /prospects auto-seed path), Next.js throws — that's expected
  // and harmless. The DB writes are committed; the next cached read
  // for this productId is a fresh miss anyway.
  try {
    revalidateTag("prospects");
  } catch {
    // ignored
  }

  const carriedOver = rows.filter((r) => r.previousRank !== null).length;
  return {
    parsed: prospects.length,
    inserted: rows.length,
    carriedOver,
    newEntries: rows.length - carriedOver,
    capturedAt: now.toISOString(),
  };
}
