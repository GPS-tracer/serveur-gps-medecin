/**
 * Minimal service worker: caches the agent shell and shared Firebase module
 * so the PWA loads offline (Firestore still needs a network unless you add offline persistence).
 *
 * Registered from agent/app.js with scope '/' so fetches to /shared/ can be cached too.
 * Serve the repo root over HTTP (e.g. python -m http.server).
 */

const CACHE_NAME = "gps-tracker-agent-v1";

/** Paths are from the site origin (repo served as document root). */
const PRECACHE_URLS = [
  "/agent/",
  "/agent/index.html",
  "/agent/style.css",
  "/agent/app.js",
  "/agent/manifest.json",
  "/shared/firebase.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).catch(() => caches.match("/agent/index.html"));
    })
  );
});
