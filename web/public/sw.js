// The service worker behind "install Lechuga as an app". It does one thing:
// keeps a copy of the app shell (index.html and the hashed files under
// /assets/) so an installed copy opens instantly and still draws its own
// screen with no network. It never touches /api: every request there goes
// straight to the worker, so nothing about chats, sign-in or billing is ever
// served from a cache.
//
// Registered only from a production build (see main.tsx), so local
// development with Vite never sees it. If it ever misbehaves, bump CACHE
// below: the next load throws the old cache away.

const CACHE = "lechuga-shell-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // Vite names built files by their content hash, so a cached one is never
  // stale: serve it from the cache and fetch it once if it isn't there yet.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const res = await fetch(request);
        if (res.ok) cache.put(request, res.clone());
        return res;
      })
    );
    return;
  }

  // A page load: always ask the network first, so a deploy shows up on the
  // next open, and keep the answer for when there is no network at all.
  if (request.mode === "navigate") {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        try {
          const res = await fetch(request);
          if (res.ok) cache.put("/", res.clone());
          return res;
        } catch {
          const hit = await cache.match("/");
          if (hit) return hit;
          throw new Error("offline and nothing cached");
        }
      })
    );
  }
});
