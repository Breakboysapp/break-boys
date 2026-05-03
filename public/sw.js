/**
 * Break Boys service worker — minimal, hand-rolled.
 *
 * Goals:
 *   - Offline shell so the PWA opens to *something* without network
 *   - Aggressive caching of Next.js's hashed static bundles (safe — the
 *     filenames change every deploy)
 *   - Network-first for HTML pages so users see fresh score cards /
 *     market values while still falling back to a cached copy if
 *     they're offline
 *
 * Bump CACHE_VERSION on any breaking SW change to force re-install.
 */

const CACHE_VERSION = "v1";
const STATIC_CACHE = `bb-static-${CACHE_VERSION}`;
const PAGES_CACHE = `bb-pages-${CACHE_VERSION}`;
const PRECACHE_URLS = ["/", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  // Activate this SW immediately on install rather than waiting for the
  // next reload. Combined with clients.claim() in activate, makes
  // updates land on the user's next page interaction.
  self.skipWaiting();
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) =>
        cache.addAll(PRECACHE_URLS).catch((err) => {
          // Some assets may 404 during install (e.g. if a referenced
          // path was removed). Fail soft so the SW still activates.
          console.warn("[sw] precache partial failure", err);
        }),
      ),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Garbage-collect old cache versions so users on long-lived
      // installs don't accumulate megabytes of stale bundles.
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== STATIC_CACHE && k !== PAGES_CACHE)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Same-origin only — never intercept eBay / PriceCharting / Vercel
  // analytics requests.
  if (url.origin !== self.location.origin) return;
  // Don't cache API responses — they're dynamic and often private.
  if (url.pathname.startsWith("/api/")) return;

  // Static-asset cache-first. Next.js hashes everything under
  // /_next/static/, so a cached entry is always still the one the
  // current HTML references; safe to cache forever.
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icon/") ||
    url.pathname === "/apple-icon" ||
    url.pathname === "/opengraph-image" ||
    url.pathname === "/twitter-image" ||
    url.pathname === "/manifest.webmanifest"
  ) {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
    return;
  }

  // HTML navigations — network-first. Always try to render the
  // freshest version (so new releases / market values land), fall
  // back to cache only when offline. This is the offline-shell.
  if (req.mode === "navigate") {
    event.respondWith(networkFirstWithFallback(req, PAGES_CACHE));
    return;
  }

  // Default: pass-through.
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    return cached || new Response("", { status: 503 });
  }
}

async function networkFirstWithFallback(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(req);
    if (cached) return cached;
    // Last-resort offline shell: serve the cached homepage.
    const home = await cache.match("/");
    if (home) return home;
    return new Response(
      "<h1>Offline</h1><p>You're offline and this page wasn't cached yet.</p>",
      {
        status: 503,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      },
    );
  }
}
