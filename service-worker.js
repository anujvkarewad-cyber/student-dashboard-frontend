/* UMP Dashboard Service Worker — PWA cache + FCM background handling */

// ---------- Firebase Compat for background pushes ----------
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

try {
  firebase.initializeApp({
    apiKey: "AIzaSyCC12dNFolIqWJYHB7p6wZWIKfMehB58a4",
    authDomain: "ump-dashboard.firebaseapp.com",
    projectId: "ump-dashboard",
    storageBucket: "ump-dashboard.firebasestorage.app",
    messagingSenderId: "566076646952",
    appId: "1:566076646952:web:caa09a3b82eeed3aef771d",
  });
} catch (e) {
  // Already initialized in some browsers
  console.warn("[SW] firebase init (may be already initialized):", e && e.message);
}

let messaging = null;
try {
  messaging = firebase.messaging();
} catch (e) {
  console.warn("[SW] messaging init failed:", e);
}

if (messaging) {
  messaging.onBackgroundMessage((payload) => {
    console.log("[SW] Background push received:", payload);

    const title =
      (payload.notification && payload.notification.title) ||
      (payload.data && payload.data.title) ||
      "UMP Dashboard";

    const body =
      (payload.notification && payload.notification.body) ||
      (payload.data && payload.data.body) ||
      "";

    // Prefer data URL if provided
    const link = (payload.fcmOptions && payload.fcmOptions.link) ||
                 (payload.data && payload.data.link) ||
                 (payload.data && payload.data.click_action) ||
                 "/";

    const options = {
      body,
      icon: "/icon/icon-192.png",
      badge: "/icon/icon-192.png",
      data: { link },
      tag: payload.data && payload.data.tag ? payload.data.tag : "ump-general",
      renotify: false,
      requireInteraction: false,
    };

    // self.registration.showNotification is the canonical way inside SW
    return self.registration.showNotification(title, options);
  });
}

// ---------- PWA cache ----------
const CACHE_VERSION = "2.2.0"; // bump to force update after fixing push
const CACHE_NAME = `upm-static-${CACHE_VERSION}`;
const STATIC_FILES = [
  "/",
  "/style.css",
  "/manifest.json",
  "/icon/icon-192.png",
  "/icon/icon-512.png",
];

// Install
self.addEventListener("install", (event) => {
  console.log("[SW] install", CACHE_VERSION);
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_FILES)).catch((err) => {
      console.warn("[SW] addAll failed:", err);
    })
  );
});

// Activate — cleanup old caches
self.addEventListener("activate", (event) => {
  console.log("[SW] activate", CACHE_VERSION);
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

// Fetch
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // Never cache these
  if (
    url.pathname === "/service-worker.js" ||
    url.pathname === "/firebase-messaging-sw.js" ||
    url.pathname.startsWith("/api/") ||
    url.hostname.includes("fcm.googleapis.com") ||
    url.hostname.includes("firebase") ||
    url.hostname.includes("googleapis.com")
  ) {
    return;
  }

  // HTML → Network First (always fresh shell)
  if (event.request.mode === "navigate" || url.pathname === "/" || url.pathname.endsWith(".html")) {
    event.respondWith(
      fetch(event.request)
        .then((resp) => {
          // optionally cache a copy
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, copy)).catch(() => {});
          return resp;
        })
        .catch(() => caches.match("/"))
    );
    return;
  }

  // JS + CSS → Network First (so new bundle rolls out quickly)
  if (url.pathname.endsWith(".js") || url.pathname.endsWith(".css")) {
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

  // Everything else (images, lotties, etc.) → Cache First with network fallback
  event.respondWith(
    (async () => {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      try {
        const response = await fetch(event.request);
        // Only cache 200s and basic/cors
        if (response.ok) {
          const responseClone = response.clone();
          const cache = await caches.open(CACHE_NAME);
          await cache.put(event.request, responseClone);
        }
        return response;
      } catch (e) {
        return cached || Response.error();
      }
    })()
  );
});

// ---------- Message: SKIP_WAITING from page ----------
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// ---------- Notification click → focus/open app ----------
self.addEventListener("notificationclick", (event) => {
  console.log("[SW] notificationclick", event.notification && event.notification.data);
  event.notification.close();

  const targetUrl = (event.notification.data && event.notification.data.link) || "/";
  const absoluteUrl = new URL(targetUrl, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const allClients = await clients.matchAll({ type: "window", includeUncontrolled: true });
      // If already open, focus
      for (const client of allClients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          try {
            await client.focus();
            if (client.navigate && targetUrl !== "/") {
              // optional: navigate to deep link
              await client.navigate(absoluteUrl);
            }
            return;
          } catch (_) {}
        }
      }
      // Otherwise open new window
      if (clients.openWindow) {
        return clients.openWindow(absoluteUrl);
      }
    })()
  );
});

// Push fallback for data-only messages if FCM handler somehow doesn't fire (extra safety)
self.addEventListener("push", (event) => {
  // If FCM already handled via onBackgroundMessage, this may be duplicate
  // So only show if not already handled. Check if event already has notification?
  if (!event.data) return;
  try {
    const payload = event.data.json();
    // If payload already has notification dispatched by FCM, skip to avoid double
    if (payload.notification) {
      // FCM's onBackgroundMessage will have already shown it — but in some edge cases
      // browsers don't call it when notification field is absent. We'll handle data-only here.
      // If FCM SDK already called showNotification, showing again may duplicate.
      // So only show if this is a data-only push (no notification prop coming from explicit push handler)
      // Our heuristic: if messaging.onBackgroundMessage didn't run, this fallback will run.
      // We avoid double by checking tag existence? Simple: if original data had notification, FCM already showed.
      // But to stay safe, we still log.
      console.log("[SW] push event (fallback) received:", payload);
    }
  } catch (e) {
    console.log("[SW] push event raw:", event.data && event.data.text && event.data.text());
  }
});
