/**
 * TransitTrack AI - Progressive Web App Service Worker
 * Implements intelligent caching strategies for offline resilience,
 * fast asset serving, and reliable transit telemetry access.
 */

const STATIC_CACHE_NAME = "transittrack-static-v1";
const DYNAMIC_CACHE_NAME = "transittrack-dynamic-v1";
const API_CACHE_NAME = "transittrack-api-v1";

const APP_SHELL_ASSETS = [
  "/",
  "/index.html",
  "/style.css",
  "/script.js",
  "/manifest.json",
  "/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/icons/favicon-32.png"
];

// Install Event: Pre-cache App Shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME).then(async (cache) => {
      // Use cache.addAll with individual catch to ensure partial network failures don't abort entire install
      for (const url of APP_SHELL_ASSETS) {
        try {
          await cache.add(url);
        } catch (err) {
          console.warn(`[PWA SW] Pre-cache non-fatal miss for ${url}:`, err.message);
        }
      }
    })
  );
  // Force active state
  self.skipWaiting();
});

// Activate Event: Clean up legacy caches & claim clients
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (
            key !== STATIC_CACHE_NAME &&
            key !== DYNAMIC_CACHE_NAME &&
            key !== API_CACHE_NAME
          ) {
            console.log("[PWA SW] Removing outdated cache:", key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event: Tailored caching strategies
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests (POST, PUT, DELETE should hit backend)
  if (request.method !== "GET") {
    return;
  }

  // Strategy 1: HTML Navigation (Network First with Offline Fallback)
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(STATIC_CACHE_NAME).then((cache) => cache.put(request, responseClone));
          }
          return networkResponse;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          const fallback = await caches.match("/index.html");
          if (fallback) return fallback;
          return new Response("<h1>TransitTrack AI is offline</h1><p>Please check your network connection.</p>", {
            headers: { "Content-Type": "text/html" }
          });
        })
    );
    return;
  }

  // Strategy 2: API Endpoints (Network First with Dynamic Cache Fallback)
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          // Cache successful telemetry queries for offline inspection
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(API_CACHE_NAME).then((cache) => cache.put(request, responseClone));
          }
          return networkResponse;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) {
            return cached;
          }
          // Return structured offline response
          return new Response(
            JSON.stringify({
              offline: true,
              detail: "TransitTrack AI is operating in offline mode. Real-time updates paused.",
              timestamp: new Date().toISOString()
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" }
            }
          );
        })
    );
    return;
  }

  // Strategy 3: Static Assets & External Fonts/CDNs (Stale-While-Revalidate)
  const isStaticAsset =
    url.origin === self.location.origin &&
    (url.pathname.endsWith(".css") ||
      url.pathname.endsWith(".js") ||
      url.pathname.endsWith(".png") ||
      url.pathname.endsWith(".svg") ||
      url.pathname.endsWith(".json") ||
      url.pathname.startsWith("/icons/"));

  const isFontOrCDN =
    url.hostname.includes("fonts.googleapis.com") ||
    url.hostname.includes("fonts.gstatic.com") ||
    url.hostname.includes("cdn.jsdelivr.net") ||
    url.hostname.includes("cdnjs.cloudflare.com");

  if (isStaticAsset || isFontOrCDN) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        const fetchPromise = fetch(request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const cacheName = isStaticAsset ? STATIC_CACHE_NAME : DYNAMIC_CACHE_NAME;
              caches.open(cacheName).then((cache) => cache.put(request, networkResponse.clone()));
            }
            return networkResponse;
          })
          .catch(() => cachedResponse);

        return cachedResponse || fetchPromise;
      })
    );
    return;
  }

  // Default: Cache First with Network Fallback
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});

// Message Event: allow client to trigger immediate update
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
