const CACHE_NAME = "qcu-schedule-v74";
const STATIC_ASSETS = [
  "./",
  "index.html",
  "schedule.html",
  "buildings.html",
  "settings.html",
  "offline.html",
  "404.html",
  "onboarding.html",
  "privacy.html",
  "terms.html",
  "manifest.json",
  "assets/css/styles.css",
  "assets/css/styles.css?v=55",
  "assets/css/student.css",
  "assets/css/student.css?v=2",
  "assets/css/entry.css?v=1",
  "assets/fonts/public-sans-latin-wght-normal.woff2",
  "assets/css/recovery.css?v=1",
  "assets/js/recovery.js?v=1",
  "assets/css/loading.css",
  "assets/js/loading.js",
  "assets/js/app.js",
  "assets/js/lucide.min.js",
  "assets/js/status.js",
  "assets/js/onboarding.js",
  "assets/js/onboarding.js?v=6",
  "assets/images/QCU college of computer studies logo.jpg",
  "assets/images/Quezon_City_Government.png",
  "assets/images/cropped-logo.jpg",
  "assets/images/QCU-BUILDING-1024x683-1.jpg",
  "data/buildings.json",
  "data/academic-catalog.json"
];

// Data files that should NOT be cached (always fetch fresh)
const NO_CACHE_PATHS = [
  "/api/",
  "/api/v1/"
];

function isNoCachePath(url) {
  return NO_CACHE_PATHS.some(path => url.includes(path));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      for (const url of STATIC_ASSETS) {
        try { await cache.add(url); } catch (e) { /* skip missing assets */ }
      }
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('qcu-schedule-') && key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const requestUrl = new URL(event.request.url);

  // Skip interception on localhost — no caching needed, and it breaks OAuth
  if (requestUrl.hostname === "127.0.0.1" || requestUrl.hostname === "localhost") return;

  // Browser extensions and third-party resources are outside this PWA's
  // cache. Cache.put only supports http(s), and cross-origin responses do not
  // belong in the app shell cache.
  if (!/^https?:$/.test(requestUrl.protocol) || requestUrl.origin !== self.location.origin) return;

  if (["/admin", "/admin/", "/admin.html"].includes(requestUrl.pathname)) return;

  const url = requestUrl.href;

  // Auth/OAuth callback navigation must NOT be intercepted by the service
  // worker. The browser needs to follow the 302 redirect chain directly
  // (Google -> callback -> session cookie set -> redirect to app).
  // Intercepting navigation to /api/auth/ causes ERR_FAILED because the SW
  // follows the redirect internally and returns HTML to a confused browser.
  if (url.includes("/api/auth/")) return;

  // Google integration is network-only, but an offline failure must remain a
  // JSON error. Returning offline.html here would look like a successful empty
  // sync to the client and could replace the last cached Classroom feed.
  if (url.includes("/api/google/")) {
    event.respondWith(
      fetch(event.request, { cache: "no-store" }).catch(() => new Response(
        JSON.stringify({ status: "OFFLINE", error: "Offline - showing last synced updates." }),
        {
          status: 503,
          headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
        }
      ))
    );
    return;
  }

  // For schedule data: always fetch from network, never cache.
  // { cache: "no-store" } forces the browser to bypass its own HTTP cache so
  // we never revalidate against a stale copy.
  if (isNoCachePath(url)) {
    event.respondWith(
      fetch(event.request, { cache: "no-store" })
        .catch(() => new Response(JSON.stringify({ status: "OFFLINE", error: "You are offline. Please reconnect and try again." }), {
          status: 503,
          headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
        }))
    );
    return;
  }

  // For static assets: network first, then cache.
  // { cache: "no-store" } is critical — without it the SW's own fetch() reads
  // from the browser HTTP cache and can return stale HTML/CSS/JS even while
  // online, which then gets written into CACHE_NAME and served as "fresh".
  // This was the bug behind needing Ctrl+Shift+R to see new deployments.
  event.respondWith(
    fetch(event.request, { cache: "no-store" })
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(
            caches.open(CACHE_NAME)
              .then((cache) => cache.put(event.request, copy))
              .catch(() => {})
          );
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          if (event.request.mode === 'navigate') return caches.match("offline.html").then(page => page
            ? new Response(page.body, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
            : new Response('You are offline. Reconnect and reload this page.', {status:503}));
          return new Response('Resource unavailable offline.', {status:503, headers:{'Content-Type':'text/plain'}});
        });
      })
  );
});
