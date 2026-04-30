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
};

export default nextConfig;
