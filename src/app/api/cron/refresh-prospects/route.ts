/**
 * Weekly cron: refresh the MLB Pipeline Top 100 ranking.
 *
 * Wraps `refreshMlbPipelineTop100` — same routine the admin button
 * triggers, just on a Vercel cron schedule. Pipeline reranks roughly
 * weekly, so daily would be overkill on their servers.
 *
 * Auth: same `Authorization: Bearer <CRON_SECRET>` envelope as the
 * other crons. If CRON_SECRET isn't set we let the request through
 * (dev/preview convenience — matches refresh-trending).
 */
import { NextResponse } from "next/server";
import { refreshMlbPipelineTop100 } from "@/lib/prospects/refresh";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return true;
  const got = req.headers.get("authorization");
  return got === `Bearer ${expected}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const t0 = Date.now();
  try {
    const result = await refreshMlbPipelineTop100();
    return NextResponse.json({
      ok: true,
      elapsedMs: Date.now() - t0,
      ...result,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        elapsedMs: Date.now() - t0,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }
}
