/**
 * POST endpoint that ingests a pasted prospect ranking list.
 *
 * Body: { source: string; sport?: string; raw: string; replace?: boolean }
 *
 * `raw` is plain-text, one prospect per line. Tolerant parser handles
 * the common shapes:
 *
 *   1. Roki Sasaki, RHP, Dodgers, 23
 *   2  Walker Jenkins - OF - Twins - 21 - AA
 *   3) Konnor Griffin (SS, Pirates, 19)
 *   Roki Sasaki                       ← number inferred from line order
 *
 * Numeric prefix (rank) is optional — if absent we use the line index.
 * Position / org / level / age fields are best-effort: missing values
 * fall through as null.
 *
 * `replace=true` wipes every existing row for (source, sport) first so
 * a mid-season re-publish doesn't leave stale entries from the prior
 * list. Default false (idempotent upsert on (source, sport, normalizedName)).
 *
 * Auth: ADMIN_SECRET via X-Admin-Secret header OR ?secret= query param.
 * Mirrors the same gate as /api/admin/revalidate.
 */
import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import { normalizeKey } from "@/lib/player-name-normalize";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type ParsedRow = {
  rank: number;
  playerName: string;
  position: string | null;
  org: string | null;
  level: string | null;
  age: number | null;
};

// Recognized level tokens — used to peel a level out of a line when
// one of the segments is exactly one of these. Anything else stays
// as the org / position string.
const LEVEL_TOKENS = new Set([
  "AAA",
  "AA",
  "A+",
  "HiA",
  "Hi-A",
  "A",
  "ROK",
  "Rookie",
  "DSL",
  "ACL",
  "FCL",
]);
const POSITION_TOKENS =
  /^(C|1B|2B|3B|SS|LF|CF|RF|OF|DH|RHP|LHP|SP|RP|P|UTL|INF|IF)$/i;

function parsePastedList(raw: string): ParsedRow[] {
  const out: ParsedRow[] = [];
  const lines = raw.split(/\r?\n/);
  let inferredRank = 0;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    // Skip header rows that paste in from formatted lists.
    if (/^(rank|#|prospect|player|name)\b.*$/i.test(line) && /\b(name|player|prospect)\b/i.test(line)) {
      continue;
    }

    // Pull off a leading rank if present: "1.", "1 ", "1)", "01:" etc.
    let rest = line;
    let rank: number | null = null;
    const m = rest.match(/^(\d{1,4})\s*[.):\-]?\s+(.+)$/);
    if (m) {
      rank = parseInt(m[1], 10);
      rest = m[2].trim();
    }

    // Split on commas, slashes, em-dash, en-dash, hyphen (with spaces),
    // pipes, or parens. Anything inside (...) collapses to a chunk
    // before the split so "(SS, Pirates, 19)" doesn't fragment.
    rest = rest.replace(/\(([^)]+)\)/g, ",$1");
    const segments = rest
      .split(/\s*(?:[,\/|]|\s[-–—]\s)\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (segments.length === 0) continue;

    const playerName = segments[0];
    if (playerName.length < 2 || /^\d+$/.test(playerName)) continue;

    let position: string | null = null;
    let org: string | null = null;
    let level: string | null = null;
    let age: number | null = null;
    for (const seg of segments.slice(1)) {
      const num = parseInt(seg, 10);
      if (!isNaN(num) && num >= 14 && num <= 35 && age === null) {
        age = num;
        continue;
      }
      if (LEVEL_TOKENS.has(seg) && level === null) {
        level = seg;
        continue;
      }
      if (POSITION_TOKENS.test(seg) && position === null) {
        position = seg.toUpperCase();
        continue;
      }
      // First leftover string is the org (e.g. "Dodgers"). Subsequent
      // leftovers get appended to the position string if it exists
      // (handles "Two-Way / OF" type entries) — otherwise dropped.
      if (org === null) {
        org = seg;
      } else if (position === null) {
        position = seg;
      }
    }

    inferredRank++;
    out.push({
      rank: rank ?? inferredRank,
      playerName,
      position,
      org,
      level,
      age,
    });
  }
  return out;
}

function authOk(req: NextRequest): boolean {
  const expected = process.env.ADMIN_SECRET;
  if (!expected) return false;
  const header = req.headers.get("x-admin-secret");
  if (header === expected) return true;
  const url = new URL(req.url);
  if (url.searchParams.get("secret") === expected) return true;
  return false;
}

export async function POST(req: NextRequest) {
  if (!authOk(req)) {
    return NextResponse.json(
      { ok: false, error: "forbidden — ADMIN_SECRET missing or wrong" },
      { status: 403 },
    );
  }

  let body: { source?: string; sport?: string; raw?: string; replace?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "body must be JSON: { source, sport?, raw, replace? }" },
      { status: 400 },
    );
  }

  const source = (body.source ?? "").trim();
  const sport = (body.sport ?? "MLB").trim();
  const raw = body.raw ?? "";
  const replace = body.replace === true;
  if (!source) {
    return NextResponse.json(
      { ok: false, error: "source is required (e.g. 'mlb-pipeline')" },
      { status: 400 },
    );
  }
  if (!raw.trim()) {
    return NextResponse.json(
      { ok: false, error: "raw (the pasted list) is required" },
      { status: 400 },
    );
  }

  const parsed = parsePastedList(raw);
  if (parsed.length === 0) {
    return NextResponse.json(
      { ok: false, error: "couldn't parse any prospects from the input" },
      { status: 400 },
    );
  }

  const now = new Date();
  // Wipe-and-replace flow exists because shrinking a list (drop a
  // graduated player) wouldn't be visible via upsert alone — the old
  // row would linger forever. Most callers will want replace=true on
  // a fresh ingest of an updated list.
  if (replace) {
    await prisma.prospectRanking.deleteMany({ where: { source, sport } });
  }

  // upsert one-by-one rather than createMany so a re-paste of the same
  // list refreshes timestamps + any drifted metadata fields. The list
  // size is bounded (~100-300) so this is fast enough not to need batching.
  let created = 0;
  let updated = 0;
  for (const p of parsed) {
    const normalizedName = normalizeKey(p.playerName);
    const res = await prisma.prospectRanking.upsert({
      where: {
        source_sport_normalizedName: { source, sport, normalizedName },
      },
      update: {
        rank: p.rank,
        playerName: p.playerName,
        position: p.position,
        org: p.org,
        level: p.level,
        age: p.age,
        capturedAt: now,
      },
      create: {
        source,
        sport,
        rank: p.rank,
        playerName: p.playerName,
        normalizedName,
        position: p.position,
        org: p.org,
        level: p.level,
        age: p.age,
        capturedAt: now,
      },
    });
    if (res.capturedAt.getTime() === now.getTime() && !replace) {
      // Heuristic: a fresh row's capturedAt === now exactly. Doesn't
      // need to be perfect — the diagnostic just helps the UI tell
      // the user how the parse landed.
      created++;
    } else {
      updated++;
    }
  }

  revalidateTag("prospects");

  return NextResponse.json({
    ok: true,
    parsed: parsed.length,
    created,
    updated,
    sample: parsed.slice(0, 3),
  });
}
