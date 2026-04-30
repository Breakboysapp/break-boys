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
              className="flex items-baseline gap-2 text-base font-extrabold tracking-tight-3"
            >
              <span className="rounded-sm bg-accent px-1.5 py-0.5 text-xs uppercase tracking-tight-2 text-white">
                Break
              </span>
              <span className="text-base uppercase sm:text-lg">Boys</span>
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
