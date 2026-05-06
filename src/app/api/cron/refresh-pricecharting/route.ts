/**
 * Scheduled refresh of every set in TRACKED_SLUGS — refreshes prices
 * and pop counts in place for existing cards, and creates rows for any
 * cards new to a set since the last run.
 *
 * Two trigger modes share the same code path:
 *
 *   1. Vercel cron (production): vercel.json schedules a GET to this
 *      route. Vercel sends `Authorization: Bearer <CRON_SECRET>`.
 *
 *   2. Manual one-shot bootstrap (rare, e.g. when wiring up a new
 *      tracked set): visit the route in a browser with `?secret=`
 *      matching ADMIN_SECRET. Useful for not having to wait until
 *      3 AM the next day for a brand-new set's data to land. Note
 *      that ADMIN_SECRET is only set in Preview/Development envs;
 *      production has only CRON_SECRET, so this query-param trigger
 *      is preview-only by design.
 *
 * Refuses to run if neither secret is configured. Streams plain-text
 * progress lines so a manual bootstrap visit shows live progress in
 * the browser instead of looking frozen for 3-5 minutes.
 */
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import {
  TRACKED_SLUGS,
  importSet,
} from "@/lib/sources/pricing/pricecharting-importer";

export const dynamic = "force-dynamic";
// Vercel Hobby plan caps serverless functions at 300s. A single full
// Topps Chrome import runs ~3 min so this fits with margin. If
// TRACKED_SLUGS ever grows past what fits in 300s, split into per-set
// cron entries (one schedule per slug) rather than one omnibus cron.
export const maxDuration = 300;

type AuthResult = { ok: true } | { ok: false; reason: string };

function checkAuth(req: NextRequest): AuthResult {
  const cronSecret = process.env.CRON_SECRET;
  const adminSecret = process.env.ADMIN_SECRET;

  const auth = req.headers.get("authorization") ?? "";
  const url = new URL(req.url);
  const querySecret = url.searchParams.get("secret");

  // Vercel cron sends `Authorization: Bearer <CRON_SECRET>`.
  if (cronSecret && auth === `Bearer ${cronSecret}`) return { ok: true };

  // Manual bootstrap: ?secret=<ADMIN_SECRET>. Preview-only because
  // ADMIN_SECRET is set only in Preview/Development env.
  if (adminSecret && querySecret && querySecret === adminSecret)
    return { ok: true };

  // Diagnostic — never reveals secret values, only whether they're
  // configured and whether the presented value's length looks plausible.
  // Helps debug the most common deploy issue: env var not picked up
  // because the deployment is stale.
  const reasons: string[] = [];
  if (!cronSecret) reasons.push("CRON_SECRET env not set on this deployment");
  if (!auth) reasons.push("no Authorization header");
  else if (!auth.startsWith("Bearer ")) reasons.push("Authorization not 'Bearer <secret>' format");
  else if (cronSecret) {
    const presented = auth.slice(7);
    reasons.push(
      `secret mismatch (presented length=${presented.length}, expected length=${cronSecret.length})`,
    );
  }
  return { ok: false, reason: reasons.join("; ") || "unknown" };
}

export async function GET(req: NextRequest) {
  const auth = checkAuth(req);
  if (!auth.ok) {
    return new Response(`forbidden — ${auth.reason}`, { status: 403 });
  }

  const url = new URL(req.url);
  // Optional `?slug=` filter — useful for re-running just one set after
  // editing TRACKED_SLUGS, without touching the others.
  const filter = url.searchParams.get("slug");
  const slugs = filter
    ? TRACKED_SLUGS.filter((s) => s.slug === filter)
    : TRACKED_SLUGS;

  // Buffered (non-streaming) response. Earlier we tried ReadableStream +
  // text/plain so progress would show live, but Vercel's serverless
  // runtime buffers the response anyway — browser shows a blank page for
  // the entire run, then nothing useful at the end. Simpler to collect
  // every progress line and return them all at once when the import
  // finishes.
  const lines: string[] = [];
  const send = (s: string) => lines.push(s);
  const prisma = new PrismaClient();
  try {
    send(
      `Refreshing ${slugs.length} set${slugs.length === 1 ? "" : "s"}…`,
    );
    send("");
    for (const meta of slugs) {
      // skipPop: pop fetch hangs from Vercel's serverless egress
      // (Cloudflare bot-walls the SCP host even via curl). Pop counts
      // get backfilled later via the local CLI script which doesn't hit
      // the same restriction. Cron stays fast + unblocked.
      await importSet(prisma, meta, send, { skipPop: true });
      send("");
    }
    send("All sets refreshed.");
  } catch (err) {
    send(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await prisma.$disconnect();
  }

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
