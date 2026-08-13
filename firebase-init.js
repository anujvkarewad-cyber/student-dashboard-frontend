const firebaseConfig = {
  apiKey: "AIzaSyCC12dNFolIqWJYHB7p6wZWIKfMehB58a4",
  authDomain: "ump-dashboard.firebaseapp.com",
  projectId: "ump-dashboard",
  storageBucket: "ump-dashboard.firebasestorage.app",
  messagingSenderId: "566076646952",
  appId: "1:566076646952:web:caa09a3b82eeed3aef771d",
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

const FCM_VAPID_KEY = "BBG-QDrIapm3Me9_92Itk0FVuMz7mkzvJqcxkyqrg0_T1p0RHDHtrOHNZNCOKGiWwzaCcbvlrQxcYM9aEZ4klaM";

window.UMP_PUSH = {
  async requestAndSaveToken(studentId) {
    try {
      if (!("Notification" in window)) return null;

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        console.log("Push permission not granted:", permission);
        return null;
      }

      const registration = await navigator.serviceWorker.ready;
      const token = await messaging.getToken({
        vapidKey: FCM_VAPID_KEY,
        serviceWorkerRegistration: registration
      });

      if (token) {
        const alreadySaved = localStorage.getItem("ump_fcm_token_" + studentId);
        if (alreadySaved !== token) {
          await window.UMP_API.saveDeviceToken(studentId, token);
          localStorage.setItem("ump_fcm_token_" + studentId, token);
        }
      }
      return token;
    } catch (err) {
      console.error("FCM token error:", err);
      return null;
    }
  }
};

// App khula/active ho tab agar push aaye, to browser notification ki jagah hamara toast dikhao
messaging.onMessage((payload) => {
  console.log("Foreground push received:", payload);
  const title = (payload.notification && payload.notification.title) || (payload.data && payload.data.title) || "Notification";
  const body  = (payload.notification && payload.notification.body)  || (payload.data && payload.data.body)  || "";
  if (window.__umpShowPushToast) window.__umpShowPushToast(title, body);
});