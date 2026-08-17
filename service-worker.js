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
  console.warn("[SW] firebase init:", e && e.message);
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
    const title = (payload.data && payload.data.title) || "UMP Dashboard";
    const body = (payload.data && payload.data.body) || "";
    const link = (payload.data && payload.data.link) || "/";
    const options = {
      body,
      icon: "/icon/icon-192.png",
      badge: "/icon/icon-192.png",
      data: { link },
      tag: payload.data && payload.data.tag ? payload.data.tag : "ump-general",
      renotify: false,
    };
    return self.registration.showNotification(title, options);
  });
}

// ---------- PWA cache ----------
const CACHE_VERSION = "2.5.0"; // published MCQ bank: invalidate the old captured/static loader
const CACHE_NAME = `upm-static-${CACHE_VERSION}`;
const STATIC_FILES = ["/", "/style.css", "/manifest.json", "/learning-data.js", "/live-bank-loader.js", "/learning-tools.js", "/icon/icon-192.png", "/icon/icon-512.png"];

self.addEventListener("install", (event) => {
  console.log("[SW] install", CACHE_VERSION);
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_FILES)));
});
self.addEventListener("activate", (event) => {
  console.log("[SW] activate", CACHE_VERSION);
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.pathname === "/service-worker.js" || url.pathname === "/firebase-messaging-sw.js" || url.pathname.startsWith("/api/") || url.hostname.includes("fcm.googleapis.com") || url.hostname.includes("firebase") || url.hostname.includes("googleapis.com")) return;
  if (event.request.mode === "navigate" || url.pathname === "/" || url.pathname.endsWith(".html")) {
    event.respondWith(fetch(event.request).then((resp) => { const copy = resp.clone(); caches.open(CACHE_NAME).then((c) => c.put(event.request, copy)); return resp; }).catch(() => caches.match("/")));
    return;
  }
  if (url.pathname.endsWith(".js") || url.pathname.endsWith(".css")) {
    event.respondWith((async () => { try { const r = await fetch(event.request); const c = await caches.open(CACHE_NAME); await c.put(event.request, r.clone()); return r; } catch { return caches.match(event.request); } })());
    return;
  }
  event.respondWith((async () => { const cached = await caches.match(event.request); if (cached) return cached; try { const r = await fetch(event.request); if (r.ok) { const c = await caches.open(CACHE_NAME); await c.put(event.request, r.clone()); } return r; } catch { return cached || Response.error(); } })());
});
self.addEventListener("message", (event) => { if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting(); });
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.link) || "/";
  const absoluteUrl = new URL(targetUrl, self.location.origin).href;
  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of allClients) { if (client.url.includes(self.location.origin) && "focus" in client) { try { await client.focus(); if (client.navigate && targetUrl !== "/") await client.navigate(absoluteUrl); return; } catch {} } }
    if (clients.openWindow) return clients.openWindow(absoluteUrl);
  })());
});
