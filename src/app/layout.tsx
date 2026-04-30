import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Break Boys",
  description: "Track owned and wanted cards across break products.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bone">
        <header className="sticky top-0 z-30 border-b border-black/10 bg-ink text-white">
          <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
            <Link
              href="/"
              className="flex items-center gap-2.5 transition hover:opacity-90"
              aria-label="Break Boys home"
            >
              {/* Brand mark: rounded black square with white "BB" + red accent stripe */}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 64 64"
                className="h-9 w-9 shrink-0 rounded-md ring-1 ring-white/10"
                aria-hidden
              >
                <rect width="64" height="64" rx="10" fill="#0a0a0a" />
                <rect x="0" y="50" width="64" height="6" fill="#d40028" />
                <text
                  x="32"
                  y="42"
                  fontFamily="Inter, ui-sans-serif, system-ui, sans-serif"
                  fontSize="34"
                  fontWeight="900"
                  letterSpacing="-2"
                  textAnchor="middle"
                  fill="#ffffff"
                >
                  BB
                </text>
              </svg>
              {/* Wordmark — eyebrow above, big mark below */}
              <span className="flex flex-col leading-none">
                <span className="text-[9px] font-bold uppercase tracking-tight-2 text-accent">
                  Break
                </span>
                <span className="text-base font-extrabold uppercase tracking-tight-3 sm:text-lg">
                  Boys
                </span>
              </span>
            </Link>
            <div className="flex items-center gap-1 text-xs font-medium uppercase tracking-tight-2">
              <Link
                href="/"
                className="rounded-md px-3 py-2 hover:bg-white/10"
              >
                Products
              </Link>
              <Link
                href="/calendar"
                className="rounded-md px-3 py-2 hover:bg-white/10"
              >
                Calendar
              </Link>
            </div>
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">{children}</main>
      </body>
    </html>
  );
}
