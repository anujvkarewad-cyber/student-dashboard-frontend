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
  const messaging = firebase.messaging();
  messaging.onBackgroundMessage((payload) => {
    console.log("[FCM-SW] Delegated to main SW, not showing");
    return;
  });
} catch(e){}
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.link) || "/";
  event.waitUntil(clients.openWindow(new URL(url, self.location.origin).href));
});
