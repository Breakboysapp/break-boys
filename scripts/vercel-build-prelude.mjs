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

const isPreviewLike = env === "preview" || env === "development";
const looksLikeProd = url.includes(PROD_HOST);

if (!isPreviewLike) {
  console.log(
    `[vercel-build-prelude] VERCEL_ENV=${env || "(unset)"} — skipping schema sync (only runs on preview/development).`,
  );
  process.exit(0);
}

if (looksLikeProd) {
  console.log(
    "[vercel-build-prelude] DATABASE_URL points at the prod host — refusing to run db push as a safety guard.",
  );
  process.exit(0);
}

console.log(
  `[vercel-build-prelude] VERCEL_ENV=${env}, DB host looks non-prod → running prisma db push.`,
);
execSync("npx prisma db push --skip-generate --accept-data-loss", {
  stdio: "inherit",
});
