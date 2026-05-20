import { notFound } from "next/navigation";
import fs from "node:fs/promises";
import path from "node:path";
import { marked } from "marked";

/**
 * Server-renders a markdown file from the repo's top-level `docs/`
 * folder. Used to host design / scope docs at a stable URL so they're
 * readable from the staging deploy without needing GitHub access.
 *
 * URL  → file
 * /docs/prospect-tracker-scope → docs/prospect-tracker-scope.md
 *
 * Slug is restricted to [a-z0-9-]+ — path-traversal attempts (`..`, `/`)
 * or unusual characters 404 before any filesystem read. The docs folder
 * is checked into the repo so it ships with the deploy; `fs.readFile`
 * works fine from a Vercel serverless function as long as the path
 * resolves under `process.cwd()`.
 *
 * GFM enabled so the prose tables in our scope docs render correctly.
 * Content is our own — no sanitizer needed.
 */
export const dynamic = "force-dynamic";

// Limit which docs are publicly addressable. Anything not in this list
// 404s even if a file with that name exists. Keeps internal drafts /
// throwaway notes from being indexable by accident.
const PUBLIC_DOCS: Record<string, { title: string; subtitle?: string }> = {
  "prospect-tracker-scope": {
    title: "Prospect Tracker — Scope",
    subtitle: "Standalone analytical product · prospects.breakboys.app",
  },
};

marked.setOptions({ gfm: true, breaks: false });

export default async function DocPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!/^[a-z0-9-]+$/.test(slug)) notFound();
  const meta = PUBLIC_DOCS[slug];
  if (!meta) notFound();

  const filePath = path.join(process.cwd(), "docs", `${slug}.md`);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    notFound();
  }

  // marked.parse returns a Promise in GFM mode (async tokenizer support);
  // await it to get the final HTML string.
  const html = await marked.parse(raw);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="mb-6 text-[10px] font-bold uppercase tracking-tight-2 text-accent">
        Docs
      </div>
      <h1 className="text-3xl font-extrabold leading-tight tracking-tight-3 sm:text-4xl">
        {meta.title}
      </h1>
      {meta.subtitle && (
        <p className="mt-2 text-sm text-slate-500">{meta.subtitle}</p>
      )}
      <article
        className="prose prose-slate mt-8 max-w-none prose-headings:tracking-tight-2 prose-h2:mt-10 prose-h2:border-t prose-h2:border-slate-200 prose-h2:pt-8 prose-a:text-accent prose-code:rounded prose-code:bg-bone prose-code:px-1 prose-code:py-0.5 prose-code:text-[0.9em] prose-code:before:content-none prose-code:after:content-none prose-pre:rounded-xl prose-pre:bg-ink prose-table:text-sm"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
