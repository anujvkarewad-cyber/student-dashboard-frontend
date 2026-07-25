const CACHE_NAME = "upm-static-v1";

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
  if (url.pathname.endsWith(".js")) {

    event.respondWith(

      fetch(event.request)
        .then(response => {

          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, response.clone());
          });

          return response;

        })
        .catch(() => caches.match(event.request))

    );

    return;

  }

  // Everything else → Cache First
  event.respondWith(

    caches.match(event.request).then(cached => {

      if (cached) return cached;

      return fetch(event.request).then(response => {

        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, response.clone());
        });

        return response;

      });

    })

  );

});

// Receive Update Message
self.addEventListener("message", event => {

  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }

});
