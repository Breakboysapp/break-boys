import ProspectsPaste from "./ProspectsPaste";

/**
 * Admin-only page for pasting in a Top 100 prospects list. The form
 * POSTs to /api/admin/prospects with the ADMIN_SECRET header — same
 * secret already used by /api/admin/revalidate and the manual
 * pricecharting bootstrap.
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
          Prospect Rankings · Paste
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-500">
          Paste a Top 100 list — one prospect per line. Numeric rank is
          optional (defaults to line order). Common shapes recognized:
          <br />
          <span className="font-mono">
            1. Roki Sasaki, RHP, Dodgers, 23
          </span>
          <br />
          <span className="font-mono">
            2 Walker Jenkins - OF - Twins - 21 - AA
          </span>
          <br />
          The list backs the Sleeper Index at <a className="underline" href="/prospects">/prospects</a>.
        </p>
      </div>
      <ProspectsPaste />
    </div>
  );
}
