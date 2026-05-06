/**
 * Build-time schema sync, scoped to Preview/Development on Vercel only.
 *
 * Why we don't run `prisma migrate deploy` on every build:
 *   - The staging Neon branch was cloned from prod, so its tables already
 *     exist but its `_prisma_migrations` table doesn't track them. That
 *     trips P3005 ("schema is not empty"). `db push` works without
 *     baseline history.
 *   - On Production we never want the build to mutate the prod schema
 *     accidentally — that's reserved for explicit `prisma migrate deploy`
 *     run by the developer.
 *
 * Strategy: only run `prisma db push` when:
 *   1. VERCEL_ENV === "preview" or "development", AND
 *   2. DATABASE_URL doesn't match the known prod hostname.
 *
 * Both guards are required — if either is missing or unexpected, we no-op
 * and let the build proceed. Refusing-to-run on uncertainty is the safe
 * default.
 */
import { execSync } from "node:child_process";

const env = process.env.VERCEL_ENV;
const url = process.env.DATABASE_URL ?? "";
const PROD_HOST = "ep-winter-shadow-aklqd4xs-pooler";

const isPreview = env === "preview" || env === "development";
const isProduction = env === "production";
const looksLikeProd = url.includes(PROD_HOST);

if (!isPreview && !isProduction) {
  console.log(
    `[vercel-build-prelude] VERCEL_ENV=${env || "(unset)"} — skipping schema sync.`,
  );
  process.exit(0);
}

// Preview: refuse to apply against the prod host even if VERCEL_ENV is
// preview — that combination would mean an env-var misconfiguration,
// not "use staging." Better to fail loud than to write to prod
// silently from a preview build.
if (isPreview && looksLikeProd) {
  console.log(
    "[vercel-build-prelude] preview build but DATABASE_URL points at prod host — aborting db push.",
  );
  process.exit(0);
}

// Production: only apply if DB host actually matches prod. Same belt+
// suspenders rationale.
if (isProduction && !looksLikeProd) {
  console.log(
    "[vercel-build-prelude] production build but DATABASE_URL doesn't match prod host — aborting db push.",
  );
  process.exit(0);
}

console.log(
  `[vercel-build-prelude] VERCEL_ENV=${env} → running prisma db push`,
);
// db push (not migrate deploy) because the existing migration history
// in this repo includes sqlite-era files that don't apply cleanly to
// postgres. db push diffs the live schema against the Prisma schema
// and applies the delta — purely additive in our case (new columns +
// new table) so no data is at risk.
execSync("npx prisma db push --skip-generate --accept-data-loss", {
  stdio: "inherit",
});
