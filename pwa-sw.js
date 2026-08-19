const CACHE_NAME = "rota-doomsday-v12";
const RUNTIME_CACHE = "rota-doomsday-runtime-v1";
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/config.js",
  "/manifest.webmanifest",
  "/posters.json",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
];
const NETWORK_FIRST_PATHS = new Set(["/config.js", "/posters.json"]);
const RUNTIME_ORIGINS = new Set([
  "https://unpkg.com",
  "https://cdn.jsdelivr.net",
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
]);

async function cacheResponse(cacheName, request, response) {
  if (!response || (!response.ok && response.type !== "opaque")) return;
  const cache = await caches.open(cacheName);
  await cache.put(request, response.clone());
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => ![CACHE_NAME, RUNTIME_CACHE].includes(key))
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    if (!RUNTIME_ORIGINS.has(url.origin)) return;
    event.respondWith(
      caches.match(request).then((cached) => {
        return fetch(request)
          .then((response) => {
            cacheResponse(RUNTIME_CACHE, request, response).catch(() => {});
            return response;
          })
          .catch((error) => cached || Promise.reject(error));
      })
    );
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          cacheResponse(CACHE_NAME, "/index.html", response).catch(() => {});
          return response;
        })
        .catch(() => caches.match("/index.html"))
    );
    return;
  }

  if (NETWORK_FIRST_PATHS.has(url.pathname)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          cacheResponse(CACHE_NAME, request, response).catch(() => {});
          return response;
        })
        .catch((error) => caches.match(request).then((cached) => cached || Promise.reject(error)))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        cacheResponse(CACHE_NAME, request, response).catch(() => {});
        return response;
      });
    })
  );
});
