import ProspectsRefresh from "./ProspectsRefresh";

/**
 * Admin-only page that refreshes the Top 100 from MLB Pipeline.
 *
 * The button POSTs to /api/admin/prospects with the ADMIN_SECRET
 * header — same secret already used by /api/admin/revalidate and the
 * manual pricecharting bootstrap. A weekly cron at
 * /api/cron/refresh-prospects keeps the data fresh automatically; this
 * page exists for on-demand refreshes when Pipeline publishes an
 * out-of-cycle update.
 *
 * Not behind real auth yet (no auth layer exists in the app); the
 * downstream API route gates writes via ADMIN_SECRET so an anonymous
 * visitor to this page can render the form but can't actually write
 * without the secret. Once Clerk lands per the prospect-tracker
 * scope doc, this page becomes admin-role-gated and the API drops
 * the secret check.
 */
export const dynamic = "force-dynamic";

export default function ProspectsAdminPage() {
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-8">
        <div className="text-[10px] font-bold uppercase tracking-tight-2 text-accent">
          Admin
        </div>
        <h1 className="mt-1 text-2xl font-extrabold leading-tight tracking-tight-3 sm:text-4xl">
          Prospect Rankings · Refresh
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-500">
          Pulls the Top 100 directly from{" "}
          <a
            className="underline"
            href="https://www.mlb.com/milb/prospects"
            target="_blank"
            rel="noreferrer"
          >
            mlb.com/milb/prospects
          </a>{" "}
          and replaces every existing <span className="font-mono">mlb-pipeline</span>{" "}
          row. The weekly cron does this automatically — use the button
          for on-demand refreshes. Backs the Sleeper Index at{" "}
          <a className="underline" href="/prospects">
            /prospects
          </a>
          .
        </p>
      </div>
      <ProspectsRefresh />
    </div>
  );
}
