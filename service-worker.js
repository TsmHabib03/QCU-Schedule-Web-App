const CACHE_NAME = "qcu-schedule-v51";
const STATIC_ASSETS = [
  "./",
  "index.html",
  "campus-eta.html",
  "schedule.html",
  "today.html",
  "buildings.html",
  "settings.html",
  "tasks.html",
  "notes.html",
  "workspace.html",
  "google.html",
  "offline.html",
  "manifest.json",
  "assets/css/styles.css",
  "assets/css/eta.css",
  "assets/js/app.js",
  "assets/js/google-integration.js",
  "assets/js/eta.js",
  "assets/js/status.js",
  "assets/images/QCU college of computer studies logo.jpg",
  "assets/images/Quezon_City_Government.png",
  "assets/images/QCU-BUILDING-1024x683-1.jpg",
  "assets/images/Belmonte Building 2.jpg",
  "assets/images/New Academic building(1).jpg",
  "assets/images/Techboc HB bautista.jpg",
  "data/buildings.json",
  "data/qcity-bus.json",
  "data/route4-corridor.json"
];

// Data files that should NOT be cached (always fetch fresh)
const NO_CACHE_PATHS = [
  "data/schedule.json",
  "data/suspensions.json",
  "data/flood.json",
  "/api/suspensions",
  "/api/flood",
  "/api/weather-alerts",
  "/api/google/"
];

function isNoCachePath(url) {
  return NO_CACHE_PATHS.some(path => url.includes(path));
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const requestUrl = new URL(event.request.url);

  // Browser extensions and third-party resources are outside this PWA's
  // cache. Cache.put only supports http(s), and cross-origin responses do not
  // belong in the app shell cache.
  if (!/^https?:$/.test(requestUrl.protocol) || requestUrl.origin !== self.location.origin) return;

  const url = requestUrl.href;

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
        .then(response => {
          if (!response.ok) throw new Error("Network response not ok");
          return response;
        })
        .catch(() => caches.match(event.request).then(cached => cached || caches.match("offline.html")))
    );
    return;
  }

  // For static assets: network first, then cache.
  // { cache: "no-store" } is critical ???????? without it the SW's own fetch() reads
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
          return caches.match("offline.html");
        });
      })
  );
});
