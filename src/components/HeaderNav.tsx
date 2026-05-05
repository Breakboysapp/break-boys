"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Header navigation: inline links on >=sm, hamburger drawer on mobile.
 *
 * The site has three top-level routes today (Products / Mixers / Calendar)
 * which fits inline on desktop without crowding. Mobile keeps the header
 * minimal — just the brand mark + a hamburger — and reveals the nav in
 * a full-width black drawer when tapped.
 *
 * Drawer interactions:
 *   - Closes on route change (so tapping a link auto-dismisses)
 *   - Closes on Escape
 *   - Closes on backdrop tap
 *   - Locks body scroll while open so the page underneath doesn't drift
 */

const LINKS: Array<{ href: string; label: string }> = [
  { href: "/", label: "Products" },
  { href: "/favorites", label: "Favorites" },
  { href: "/mixers", label: "Mixers" },
  { href: "/calendar", label: "Calendar" },
];

export default function HeaderNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Auto-close when the route changes (handles drawer-link taps).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Escape closes the drawer.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Prevent the page underneath from scrolling while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  return (
    <>
      {/* Desktop links — inline on >=sm */}
      <div className="hidden items-center gap-1 text-xs font-medium uppercase tracking-tight-2 sm:flex">
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`rounded-md px-3 py-2 hover:bg-white/10 ${
              isActive(link.href) ? "bg-white/10" : ""
            }`}
          >
            {link.label}
          </Link>
        ))}
      </div>

      {/* Mobile hamburger — shown only below sm */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-10 w-10 items-center justify-center rounded-md hover:bg-white/10 sm:hidden"
        aria-label="Open menu"
        aria-expanded={open}
        aria-controls="mobile-nav"
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          aria-hidden
        >
          <path d="M3 6h18" />
          <path d="M3 12h18" />
          <path d="M3 18h18" />
        </svg>
      </button>

      {/* Drawer + backdrop. Both are sm:hidden so desktop never sees them
          even if state somehow flips on. */}
      {open && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 bg-black/60 sm:hidden"
          />
          <div
            id="mobile-nav"
            className="fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-ink text-white shadow-2xl sm:hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Site navigation"
          >
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <span className="text-[11px] font-bold uppercase tracking-tight-2 text-accent">
                Menu
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-md hover:bg-white/10"
                aria-label="Close menu"
              >
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  aria-hidden
                >
                  <path d="M6 6l12 12" />
                  <path d="M18 6l-12 12" />
                </svg>
              </button>
            </div>
            <nav className="flex flex-col p-2">
              {LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className={`flex items-center justify-between rounded-md px-4 py-3 text-base font-bold uppercase tracking-tight-2 hover:bg-white/10 ${
                    isActive(link.href) ? "bg-white/10 text-accent" : ""
                  }`}
                >
                  {link.label}
                  <span aria-hidden className="text-white/40">
                    →
                  </span>
                </Link>
              ))}
            </nav>
          </div>
        </>
      )}
    </>
  );
}
