/**
 * One-button admin page for importing PriceCharting sets into the
 * current database. Hidden behind a manual URL — there's no nav link.
 *
 * Server-side guard checks ADMIN_SECRET via the ?secret= query param
 * and refuses to render anything useful without it. The "Import" button
 * POSTs to /api/admin/import-pricecharting which streams progress as
 * plain text into the on-page log.
 *
 * Intended for staging only. The route + the page itself both refuse
 * to run when DATABASE_URL points at the known prod host.
 */
import { redirect } from "next/navigation";
import ImportClient from "./ImportClient";

const PROD_HOST = "ep-winter-shadow-aklqd4xs-pooler";

export const dynamic = "force-dynamic";

export default async function AdminImportPage({
  searchParams,
}: {
  searchParams: Promise<{ secret?: string }>;
}) {
  const { secret } = await searchParams;
  const expected = process.env.ADMIN_SECRET;
  if (!expected || secret !== expected) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <h1 className="text-2xl font-extrabold tracking-tight-3">Forbidden</h1>
        <p className="mt-2 text-sm text-slate-500">
          Append <code>?secret=…</code> to the URL.
        </p>
      </div>
    );
  }

  // Refuse to even render the controls if we're somehow pointed at
  // prod — the import would create a new product but should still be
  // contained to staging until we explicitly choose to bring it across.
  const onProd = (process.env.DATABASE_URL ?? "").includes(PROD_HOST);
  if (onProd) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <h1 className="text-2xl font-extrabold tracking-tight-3">
          Staging-only
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          DATABASE_URL points at the prod host. Refusing to render.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 py-12">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-tight-2 text-accent">
          Admin · Staging only
        </div>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight-3">
          Import a PriceCharting set
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Pulls every card + price + pop count for the slug below. Idempotent —
          re-running just refreshes existing data. Takes about 3 minutes for a
          full Topps Chrome set.
        </p>
      </div>
      <ImportClient secret={secret} />
    </div>
  );
}
