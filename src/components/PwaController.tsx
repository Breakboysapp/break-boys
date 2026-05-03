"use client";

/**
 * PWA glue, client-side:
 *   1. Registers the service worker (production only, never on dev)
 *   2. Shows a small "Install Break Boys" banner the first time the
 *      browser fires `beforeinstallprompt` (Chrome/Android), or detects
 *      iOS Safari and prompts the user to use Share → Add to Home Screen
 *   3. Remembers dismissal in localStorage so the banner doesn't nag
 *
 * One mounted instance per app — drop into the root layout once.
 */

import { useEffect, useState } from "react";

// Chrome's beforeinstallprompt event surface. Not in the standard DOM
// types yet; declaring inline.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "bb.install-banner.dismissed";
// If the user dismisses, don't bug them again for 14 days. Long enough
// to feel respectful; short enough that they get a second chance after
// using the app a few times.
const DISMISS_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export default function PwaController() {
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);

  // Service worker registration
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;
    // Defer registration until after page load so it doesn't compete
    // with critical asset fetches on the initial render.
    const onLoad = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch((err) => console.warn("[pwa] sw registration failed", err));
    };
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad, { once: true });
    return () => window.removeEventListener("load", onLoad);
  }, []);

  // beforeinstallprompt — Chrome / Edge / Android
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isInstallEligible()) return;

    const handler = (e: Event) => {
      // Cache the event so we can fire .prompt() on a user gesture later.
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  // iOS Safari — no beforeinstallprompt support, so we sniff the UA
  // and show a manual hint banner once.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isInstallEligible()) return;
    const ua = navigator.userAgent;
    const isIos = /iphone|ipad|ipod/i.test(ua);
    const isSafari = /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua);
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // iOS-specific
      (window.navigator as { standalone?: boolean }).standalone === true;
    if (isIos && isSafari && !standalone) {
      setShowIosHint(true);
    }
  }, []);

  const visible = installPrompt != null || showIosHint;
  if (!visible) return null;

  async function onInstall() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  function onDismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // Private mode / disabled storage — silently ignore.
    }
    setInstallPrompt(null);
    setShowIosHint(false);
  }

  return (
    <div
      role="dialog"
      aria-label="Install Break Boys"
      className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-lg p-3 sm:p-4"
    >
      <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-ink px-4 py-3 text-white shadow-2xl">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold uppercase tracking-tight-2 text-accent">
            Install Break Boys
          </div>
          <div className="mt-0.5 text-[13px] leading-tight text-white/85">
            {installPrompt
              ? "Add to your home screen for one-tap access."
              : "Tap Share, then \"Add to Home Screen\"."}
          </div>
        </div>
        {installPrompt && (
          <button
            type="button"
            onClick={onInstall}
            className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-[11px] font-bold uppercase tracking-tight-2 text-white hover:opacity-90"
          >
            Install
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded-md border border-white/15 px-2 py-1.5 text-[11px] font-bold uppercase tracking-tight-2 text-white/70 hover:bg-white/10"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

function isInstallEligible(): boolean {
  if (typeof window === "undefined") return false;
  // Already installed (running standalone) — no banner.
  if (window.matchMedia("(display-mode: standalone)").matches) return false;
  if ((window.navigator as { standalone?: boolean }).standalone === true)
    return false;
  // User dismissed recently?
  try {
    const ts = Number(localStorage.getItem(DISMISS_KEY) || 0);
    if (ts && Date.now() - ts < DISMISS_TTL_MS) return false;
  } catch {
    // Storage unavailable — assume eligible.
  }
  return true;
}
