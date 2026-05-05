import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: __dirname,
  // Don't let Next.js bundle these — `xlsx` (SheetJS) uses dynamic require
  // calls and Prisma uses native query engines, both of which break under
  // bundler optimization on Vercel's serverless runtime. Marking them as
  // external preserves their runtime require behavior.
  serverExternalPackages: ["xlsx", "@prisma/client", "fast-xml-parser"],

  // Force apex domain. Vercel's domain settings already redirect
  // www → apex once the domain is added there (and that's what gets
  // the SSL cert), but this is a code-level safety net: if a request
  // ever does reach Next.js with host=www.breakboys.app, redirect to
  // the apex permanently. Won't fire for any other host.
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.breakboys.app" }],
        destination: "https://breakboys.app/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
