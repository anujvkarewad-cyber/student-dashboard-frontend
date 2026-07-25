const CACHE_NAME = "upm-static-v1";

const STATIC_ASSETS = [
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
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
});

// Activate
self.addEventListener("activate", event => {

  event.waitUntil(

    (async () => {

      const keys = await caches.keys();

      await Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      );

      await self.clients.claim();

    })()

  );

});

// Fetch
self.addEventListener("fetch", event => {

  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // Always fetch latest HTML
  if (
    event.request.mode === "navigate" ||
    url.pathname === "/" ||
    url.pathname.endsWith(".html")
  ) {

    event.respondWith(

      fetch(event.request)
        .then(response => response)
        .catch(() => caches.match("/index.html"))

    );

    return;

  }

  // Always fetch latest JS
  if (
    url.pathname.endsWith(".js")
  ) {

    event.respondWith(

      fetch(event.request)
        .then(response => response)
        .catch(() => caches.match(event.request))

    );

    return;

  }

  // CSS: stale while revalidate
  if (
    url.pathname.endsWith(".css")
  ) {

    event.respondWith(

      caches.match(event.request).then(cached => {

        const network = fetch(event.request).then(response => {

          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, response.clone());
          });

          return response;

        });

        return cached || network;

      })

    );

    return;

  }

  // Images
  event.respondWith(

    caches.match(event.request).then(cached => {

      return (
        cached ||
        fetch(event.request).then(response => {

          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, response.clone());
          });

          return response;

        })

      );

    })
    

  );

});
self.addEventListener("message", event => {

    if (event.data?.type === "SKIP_WAITING") {

        self.skipWaiting();

    }

});
