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
export const maxDuration = 600; // 10 minutes — full multi-set refresh

function isAuthorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const adminSecret = process.env.ADMIN_SECRET;

  // Vercel cron sends `Authorization: Bearer <CRON_SECRET>`.
  const auth = req.headers.get("authorization") ?? "";
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;

  // Manual bootstrap: ?secret=<ADMIN_SECRET>. Preview/development only
  // because ADMIN_SECRET isn't set in production environments.
  const url = new URL(req.url);
  const querySecret = url.searchParams.get("secret");
  if (adminSecret && querySecret && querySecret === adminSecret) return true;

  return false;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return new Response("forbidden", { status: 403 });
  }

  const url = new URL(req.url);
  // Optional `?slug=` filter — useful for re-running just one set after
  // editing TRACKED_SLUGS, without touching the others.
  const filter = url.searchParams.get("slug");
  const slugs = filter
    ? TRACKED_SLUGS.filter((s) => s.slug === filter)
    : TRACKED_SLUGS;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (s: string) => controller.enqueue(encoder.encode(s + "\n"));
      const prisma = new PrismaClient();
      try {
        send(
          `Refreshing ${slugs.length} set${slugs.length === 1 ? "" : "s"}…`,
        );
        send("");
        for (const meta of slugs) {
          await importSet(prisma, meta, send);
          send("");
        }
        send("All sets refreshed.");
      } catch (err) {
        send(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        await prisma.$disconnect();
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
