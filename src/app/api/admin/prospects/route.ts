/**
 * POST endpoint that refreshes the prospect ranking from MLB Pipeline.
 *
 * Body: none (the source is fixed — MLB Pipeline's published Top 100).
 *
 * The handler fetches https://www.mlb.com/milb/prospects, parses the
 * embedded Apollo cache, and wipes-and-replaces every row for
 * (source="mlb-pipeline", sport="MLB"). See `refreshMlbPipelineTop100`
 * for the upsert semantics.
 *
 * Auth: ADMIN_SECRET via X-Admin-Secret header OR ?secret= query param.
 * Mirrors the same gate as /api/admin/revalidate.
 */
import { NextRequest, NextResponse } from "next/server";
import { refreshMlbPipelineTop100 } from "@/lib/prospects/refresh";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

  try {
    const result = await refreshMlbPipelineTop100();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }
}
