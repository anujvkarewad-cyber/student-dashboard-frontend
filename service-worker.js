const CACHE_VERSION = "1.0.1";
const CACHE_NAME = `upm-static-${CACHE_VERSION}`;

const STATIC_FILES = [
  "/",
  "/style.css",
  "/manifest.json",
  "/icon/icon-192.png",
  "/icon/icon-512.png"
];

// Install
self.addEventListener("install", event => {

  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_FILES))
  );

});

// Activate
self.addEventListener("activate", event => {

  event.waitUntil(

    caches.keys().then(keys =>

      Promise.all(

        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))

      )

    ).then(() => self.clients.claim())

  );

});

// Fetch
self.addEventListener("fetch", event => {

  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  // Never cache the service worker itself
if (url.pathname === "/service-worker.js") {
    return;
}

  // HTML → Always Network First
  if (
    event.request.mode === "navigate" ||
    url.pathname === "/" ||
    url.pathname.endsWith(".html")
  ) {

    event.respondWith(

      fetch(event.request)
        .catch(() => caches.match("/"))

    );

    return;

  }

 // JS → Network First
if (
    url.pathname.endsWith(".js") &&
    url.pathname !== "/service-worker.js"
) {

    event.respondWith(

        (async () => {

            try {

                const response = await fetch(event.request);

                const responseClone = response.clone();

                const cache = await caches.open(CACHE_NAME);

                await cache.put(event.request, responseClone);

                return response;

            } catch {

                return caches.match(event.request);

            }

        })()

    );

    return;

}

  // Everything else → Cache First
event.respondWith(

    (async () => {

        const cached = await caches.match(event.request);

        if (cached) return cached;

        const response = await fetch(event.request);

        const responseClone = response.clone();

        const cache = await caches.open(CACHE_NAME);

        await cache.put(event.request, responseClone);

        return response;

    })()

);
// Receive Update Message
self.addEventListener("message", event => {

  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }

});
