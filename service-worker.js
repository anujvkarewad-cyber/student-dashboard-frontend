importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyCC12dNFolIqWJYHB7p6wZWIKfMehB58a4",
  authDomain: "ump-dashboard.firebaseapp.com",
  projectId: "ump-dashboard",
  storageBucket: "ump-dashboard.firebasestorage.app",
  messagingSenderId: "566076646952",
  appId: "1:566076646952:web:caa09a3b82eeed3aef771d",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log("Background push received:", payload);
  const title = (payload.notification && payload.notification.title) || (payload.data && payload.data.title) || "UMP Dashboard";
  const options = {
    body: (payload.notification && payload.notification.body) || (payload.data && payload.data.body) || "",
    icon: "/icon/icon-192.png",
    badge: "/icon/icon-192.png",
  };
  self.registration.showNotification(title, options);
});



const CACHE_VERSION = "2.1.7";
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

 // JS + CSS → Network First
if (
    (url.pathname.endsWith(".js") || url.pathname.endsWith(".css")) &&
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
  });
  
// Receive Update Message
self.addEventListener("message", event => {

  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }

});
