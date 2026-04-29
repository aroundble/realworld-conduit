// Minimal no-op service worker (#149). Exists solely to satisfy
// Chrome's PWA installability criterion — the installable-web-app
// contract requires a registered SW with a fetch handler, even if
// it doesn't do anything clever.
//
// Every `fetch` event passes through to the network verbatim; no
// caching, no background sync, no push. A full offline-first
// strategy is filed as a follow-up — this is the foundation, not
// the complete solution.
//
// When offline-first lands, this file becomes the place to wire
// a cache-first-with-network-fallback pattern for static assets
// and network-first for /api/* reads. Until then, passthrough is
// safer than buggy cache rules.

self.addEventListener("install", (event) => {
  // Skip waiting so updates take effect on the first reload —
  // without this, the browser keeps an old SW active until every
  // tab closes, which makes SW bugs hard to iterate on.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Claim all clients so the SW controls the current page on
  // first registration (rather than requiring a reload).
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  // Passthrough. Once we add caching, this is where the routing
  // + strategy (cache-first / network-first / stale-while-
  // revalidate) lives.
  event.respondWith(fetch(event.request));
});
