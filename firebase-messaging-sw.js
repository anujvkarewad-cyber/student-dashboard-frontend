/* Support file: Firebase looks for /firebase-messaging-sw.js by default.
   We keep this lightweight and identical to the FCM part of service-worker.js
   so that pushes work even if the main SW hasn't been updated yet.
*/

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
  console.log("[FCM-SW] Background message:", payload);
  const title = (payload.notification && payload.notification.title) ||
                (payload.data && payload.data.title) || "UMP Dashboard";
  const body = (payload.notification && payload.notification.body) ||
               (payload.data && payload.data.body) || "";
  const link = (payload.fcmOptions && payload.fcmOptions.link) ||
               (payload.data && payload.data.link) || "/";

  const options = {
    body,
    icon: "/icon/icon-192.png",
    badge: "/icon/icon-192.png",
    data: { link },
    tag: (payload.data && payload.data.tag) || "ump-general",
  };

  return self.registration.showNotification(title, options);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.link) || "/";
  const full = new URL(url, self.location.origin).href;
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          return client.focus().then(() => client.navigate && client.navigate(full));
        }
      }
      return clients.openWindow(full);
    })
  );
});
