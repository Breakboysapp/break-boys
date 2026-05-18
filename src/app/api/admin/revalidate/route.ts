/**
 * Manual cache-bust endpoint.
 *
 * The cron + checklist + product POST/PATCH routes already call
 * `revalidateTag(...)` after their writes. This endpoint exists for
 * the local-CLI path that bypasses all of those — most importantly
 * `scripts/import-pricecharting-set.ts`, which writes pop counts
 * directly to the DB and then has no Next.js context to invalidate
 * caches from.
 *
 * Usage:
 *   GET /api/admin/revalidate?tag=products&secret=<ADMIN_SECRET>
 *
 * Pass `tag` once or multiple times to bust several tags in one call:
 *   ?tag=products&tag=product-abc123&secret=...
 *
 * `secret` must match `ADMIN_SECRET`. That env is set in Preview /
 * Development on Vercel; not in production. Matches the same secret
 * the cron route accepts as a query-param fallback for manual
 * bootstrap.
 */
import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) {
    return NextResponse.json(
      { ok: false, error: "ADMIN_SECRET not configured on this deployment" },
      { status: 403 },
    );
  }
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");
  if (secret !== adminSecret) {
    return NextResponse.json(
      { ok: false, error: "bad secret" },
      { status: 403 },
    );
  }
  const tags = url.searchParams.getAll("tag");
  if (tags.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "no tags specified. Use ?tag=products (and/or repeat the tag param for more)",
      },
      { status: 400 },
    );
  }
  for (const t of tags) revalidateTag(t);
  return NextResponse.json({ ok: true, revalidated: tags });
}
