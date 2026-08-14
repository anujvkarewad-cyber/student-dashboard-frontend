const firebaseConfig = {
  apiKey: "AIzaSyCC12dNFolIqWJYHB7p6wZWIKfMehB58a4",
  authDomain: "ump-dashboard.firebaseapp.com",
  projectId: "ump-dashboard",
  storageBucket: "ump-dashboard.firebasestorage.app",
  messagingSenderId: "566076646952",
  appId: "1:566076646952:web:caa09a3b82eeed3aef771d",
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const messaging = firebase.messaging();

// IMPORTANT: This must exactly match the Web Push certificate in
// Firebase Console > Project Settings > Cloud Messaging > Web Push certificates
const FCM_VAPID_KEY = "BBG-QDrIapm3Me9_92Itk0FVuMz7mkzvJqcxkyqrg0_T1p0RHDHtrOHNZNCOKGiWwzaCcbvlrQxcYM9aEZ4klaM";

window.UMP_PUSH = {
  getPermissionState() {
    if (!("Notification" in window)) return "unsupported";
    return Notification.permission; // default | granted | denied
  },

  isSupported() {
    return (
      "Notification" in window &&
      "serviceWorker" in navigator &&
      "PushManager" in window
    );
  },

  async ensureServiceWorker() {
    // Wait for the PWA service worker to be ready
    if (!("serviceWorker" in navigator)) return null;
    try {
      // navigator.serviceWorker.ready will wait for active SW
      const reg = await navigator.serviceWorker.ready;
      return reg;
    } catch (e) {
      console.warn("[UMP_PUSH] serviceWorker.ready failed", e);
      return null;
    }
  },

  async requestAndSaveToken(studentId, opts = {}) {
    const { force = false } = opts;
    try {
      if (!studentId) {
        console.warn("[UMP_PUSH] studentId missing");
        return null;
      }
      if (!this.isSupported()) {
        console.warn("[UMP_PUSH] Push not supported on this browser");
        return null;
      }

      // Must be secure context (https or localhost)
      if (!window.isSecureContext) {
        console.warn("[UMP_PUSH] Not a secure context — push won't work. Needs HTTPS.");
        // On localhost isSecureContext is true, so this is just for prod http
      }

      let permission = Notification.permission;
      if (permission === "default") {
        console.log("[UMP_PUSH] Requesting notification permission...");
        permission = await Notification.requestPermission();
      }

      if (permission !== "granted") {
        console.log("[UMP_PUSH] Permission not granted:", permission);
        return null;
      }

      const registration = await this.ensureServiceWorker();
      if (!registration) {
        console.error("[UMP_PUSH] No serviceWorker registration ready");
        return null;
      }

      // Small delay to ensure SW is fully activated
      if (registration.installing || registration.waiting) {
        await new Promise((r) => setTimeout(r, 800));
      }

      console.log("[UMP_PUSH] Getting FCM token...");

      const token = await messaging.getToken({
        vapidKey: FCM_VAPID_KEY,
        serviceWorkerRegistration: registration,
      });

      if (!token) {
        console.error("[UMP_PUSH] getToken returned empty");
        return null;
      }

      console.log("[UMP_PUSH] Token obtained:", token.slice(0, 24) + "...");

      const storageKey = "ump_fcm_token_" + studentId;
      const alreadySaved = localStorage.getItem(storageKey);

      // Save if force or token changed
      if (force || alreadySaved !== token) {
        try {
          const res = await window.UMP_API.saveDeviceToken(studentId, token);
          console.log("[UMP_PUSH] Token saved to backend:", res);
          localStorage.setItem(storageKey, token);
          localStorage.setItem("ump_fcm_token_last_saved", String(Date.now()));
        } catch (saveErr) {
          console.error("[UMP_PUSH] Failed to save token to backend:", saveErr);
          // Still keep token locally so we don't keep re-trying every second
          localStorage.setItem(storageKey, token);
        }
      } else {
        console.log("[UMP_PUSH] Token unchanged, skipping save");
      }

      return token;
    } catch (err) {
      console.error("[UMP_PUSH] requestAndSaveToken error:", err);
      // Common error: failed to retrieve token because VAPID mismatch or SW failure
      // Try to give actionable hint
      if (String(err).includes("applicationServerKey") || String(err).includes("vapid")) {
        console.error("[UMP_PUSH] VAPID key issue — check Firebase Console Web Push certificate matches FCM_VAPID_KEY");
      }
      return null;
    }
  },

  // Call this when token may have rotated
  async refreshIfNeeded(studentId) {
    return this.requestAndSaveToken(studentId, { force: false });
  },
};

// Foreground message handler — show our in-app toast instead of system notification if app is focused
messaging.onMessage((payload) => {
  console.log("[UMP_PUSH] Foreground push received:", payload);

  const title =
    (payload.notification && payload.notification.title) ||
    (payload.data && payload.data.title) ||
    "UMP Dashboard";
  const body =
    (payload.notification && payload.notification.body) ||
    (payload.data && payload.data.body) ||
    "";

  // If app has its own toast handler, use it
  if (window.__umpShowPushToast) {
    window.__umpShowPushToast(title, body);
  } else {
    // Fallback: try native notification if visible
    try {
      if (Notification.permission === "granted") {
        new Notification(title, {
          body,
          icon: "/icon/icon-192.png",
        });
      }
    } catch (_) {}
  }
});

// Helper for debugging in console — window.UMP_PUSH.debugToken()
window.UMP_PUSH.debugToken = async () => {
  try {
    const reg = await navigator.serviceWorker.ready;
    const token = await messaging.getToken({
      vapidKey: FCM_VAPID_KEY,
      serviceWorkerRegistration: reg,
    });
    console.log("Current FCM token:", token);
    return token;
  } catch (e) {
    console.error(e);
    return null;
  }
};
