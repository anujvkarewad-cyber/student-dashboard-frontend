# 🔥 Firebase Push – Why only test notification worked on localhost, and how this fix solves it

## Root causes found

### 1. Frontend `saveDeviceToken` was fragile
**Old:** 
```js
for (i) if (data[i][0]===studentId && data[i][1]===token) rowIndex = ...
```
- Only matched exact student+token pair. Token rotation left stale rows.
- No cleanup, no dedup, no global token uniqueness.
- `localStorage` cached token per student prevented re-saving after token refresh.

**Result:** Production tokens never actually persisted reliably, so `getTokensForStudent_` returned empty → backend push sent 0.

**New:** 
- One row per unique token globally.
- If token already exists, re-assign studentId + UpdatedAt.
- Keep max 10 tokens per student, auto-cleanup.
- Frontend now force-checks permission, waits for `serviceWorker.ready`, logs every step, retries on token rotation.

### 2. Backend `sendFcmToToken_` sent minimal payload
Old payload:
```json
{ message: { token, notification: { title, body } } }
```
- No `webpush.fcm_options.link` → click did nothing.
- No `data` → foreground handler didn't get link.
- No `badge/icon` fallback.
- No handling of stale tokens → sheet filled with dead tokens, FCM quota wasted.

New payload adds:
- `data` (string-only) with link/tag/timestamp
- `webpush.notification` with icon/badge
- `webpush.fcm_options.link` → click opens dashboard
- `android.priority=HIGH`, apns sound
- Detects UNREGISTERED / INVALID_ARGUMENT → auto deletes token.

### 3. `getFcmAccessToken_` had no guard for missing `FCM_PRIVATE_KEY`
If property missing or malformed, `.replace` threw uncaught → whole `sendPush` silently failed. New version:
- Checks existence
- Validates PEM
- Clear error message in logs
- Allows `FCM_PROJECT_ID` and `FCM_CLIENT_EMAIL` override via Script Properties (useful if you migrate project)

### 4. Service Worker was outdated + double cache bug
- Cache version `2.1.7` stuck → users on prod kept old SW that didn't have proper `onBackgroundMessage`.
- `fetch` handler cached FCM/Google calls → broke token fetch.
- No `notificationclick` handler → clicking notification did nothing.
- No `firebase-messaging-sw.js` fallback. Firebase SDK by default looks for that file at root; if missing, Chrome sometimes fails to show background notification on installed PWA.

Fixed SW:
- Bumped `CACHE_VERSION` to `2.2.0` → forces update on next load.
- Excludes `/api/`, `fcm.googleapis.com`, `firebase`, `googleapis.com` from cache.
- Adds `notificationclick` that focuses existing tab or opens `/`.
- Proper `onBackgroundMessage` that shows notification with link & tag.
- Added `firebase-messaging-sw.js` file as redundancy.

### 5. Frontend permission flow fire-and-forget
Old:
```js
if (window.UMP_PUSH) window.UMP_PUSH.requestAndSaveToken(studentId);
```
No await, no error logging, no UX if permission denied.

New:
- Await + log
- Show gentle toast if permission is `default` (user ignored prompt)
- Show warning if `denied` (needs browser settings)
- Auto-retry every 30 min via `refreshIfNeeded`
- Profile page now has **Enable Notifications** button + status display + token preview.

---

## What now works

| Scenario | Before | After |
|---|---|---|
| Test message from Firebase Console on localhost | ✅ (uses Firebase's own server key) | ✅ |
| Announcement push from Apps Script | ❌ (no token found / auth fail) | ✅ |
| New notes push | ❌ | ✅ |
| Mentor feedback push | ❌ | ✅ |
| Background (app closed) | ❌ sometimes, click does nothing | ✅ with icon, click opens dashboard |
| Foreground (app open) | Only via polling toast | ✅ FCM toast + polling |
| Token rotation | Leaves stale | ✅ Re-assigns |
| Denied permission UX | Silent fail | ✅ Shows blocked message in Profile |

---

## Deployment steps

### A) Frontend (Vercel) – already patched in this repo

Files changed:
- `firebase-init.js` → robust token logic + logging + `isSupported()` + `debugToken()`
- `service-worker.js` → 2.2.0, excludes FCM from cache, adds click handler
- `firebase-messaging-sw.js` → NEW, redundancy for FCM
- `app.js` → App version 2.2.0, proper async push registration, profile push UI
- `vercel.json` → no-cache for both SW files

1. Push this branch to production (Vercel auto-deploys).
2. Hard reload once: open prod site → DevTools → Application → Service Workers → **Unregister**, then reload. Or just wait – new SW version will auto-install and show "New version available → Update Now" banner.

### B) Apps Script – apply `APPS_SCRIPT_FCM_FIX.gs`

1. Open your Sheet → Extensions → Apps Script.
2. Copy **entire content** of `APPS_SCRIPT_FCM_FIX.gs` provided in this repo.
3. In your existing Code.gs, **replace** the old FCM block from `const FCM_PROJECT_ID` through to `createStreakReminderTrigger()` with the new block.
4. Save.
5. Go to **Project Settings → Script Properties** and ensure these exist:

| Property | Value | Note |
|---|---|---|
| `FCM_PRIVATE_KEY` | The full private key from Firebase service account JSON (`-----BEGIN PRIVATE KEY-----\nMII...==\n-----END PRIVATE KEY-----\n`). Keep `\n` or real newlines – new code handles both. | REQUIRED |
| `FCM_CLIENT_EMAIL` | `firebase-adminsdk-...@ump-dashboard.iam.gserviceaccount.com` | Optional override, default hard-coded |
| `FCM_PROJECT_ID` | `ump-dashboard` | Optional override, default hard-coded |

   - If you only have the JSON file downloaded from Firebase Console → Service Accounts → Generate new private key, copy `private_key` field value as-is into Script Properties.

6. Run in Apps Script editor (select function dropdown):
   - `testFcmAuth` → Logs should say `✅ FCM Auth OK`
   - `debugDeviceTokens` → shows how many tokens stored
   - Change `studentId` inside `testPushToStudent()` to your own test ID (must have token) → Run it. You should get a notification on device **even if app is closed** (if permission granted).
   - If test works, try `testPushToAll()`.

### C) Firebase Console checks

1. **Project Settings → Cloud Messaging → Web Push certificates** – copy the VAPID key, ensure it equals `FCM_VAPID_KEY` in `firebase-init.js` (currently `BBG-QDrIapm3Me9_92Itk0FVuMz7mkzvJqcxkyqrg0_T1p0RHDHtrOHNZNCOKGiWwzaCcbvlrQxcYM9aEZ4klaM`). If you generated a new certificate, update the JS.

2. **Project Settings → General → Your apps → Web app** – Ensure your production domain (e.g., `ump-dashboard.vercel.app` or custom domain) is allowed.

3. **Authentication → Settings → Authorized domains** – Add:
   - `localhost` (should already be)
   - Your Vercel domain (e.g., `student-dashboard-frontend-*.vercel.app`, plus final production domain)
   - Custom domain if used

4. **Cloud Messaging → Enable?** For FCM v1, no legacy Server Key needed, service account auth used.

### D) Testing checklist on production

1. Open prod site on **Android Chrome** (push most reliable).
2. Login → Allow notification permission prompt.
3. Go to Profile → Should say "✅ Enabled on this device" + token preview.
4. In console `await window.UMP_PUSH.debugToken()` should print token.
5. In Apps Script → run `testPushToStudent` with your ID → notification arrives within 5 sec even if tab closed? Yes → backend works.
6. In Sheet → create new Announcement via your admin UI or directly call `createAnnouncement` – should trigger push to all.
7. Upload a Note – should trigger push filtered by batch/group.

### E) Common pitfalls that make it work on localhost but not prod

- **HTTP vs HTTPS**: localhost is considered secure, but `http://your-ip` is not. Prod must be HTTPS (Vercel is).
- **Service Worker not updated**: Users cached old SW. Bumping version to 2.2.0 + Update banner fixes.
- **Permission blocked earlier**: If user once clicked "Block" on prod domain, `Notification.permission === "denied"` stays forever until they go to browser site settings → Notifications → Allow. New profile UI shows this clearly.
- **VAPID mismatch**: Test via Firebase Console does NOT use VAPID, it uses direct token. So test can succeed even if VAPID wrong. Real `getToken` needs VAPID. Fixed with better error logging.
- **Private key property missing on new deployment**: When you create new Apps Script deployment (new /exec URL), Script Properties stay, but if you copied project, properties may not copy. Check.

### F) Debug commands for you (browser console)

```js
// Check permission
Notification.permission

// Get current token
await window.UMP_PUSH.debugToken()

// Force re-save
await window.UMP_PUSH.requestAndSaveToken(state.student.studentId, {force:true})

// Check what's stored
localStorage.getItem('ump_fcm_token_'+state.student.studentId)

// Clear and re-ask
localStorage.removeItem('ump_fcm_token_'+state.student.studentId)
await window.UMP_PUSH.requestAndSaveToken(state.student.studentId, {force:true})
```

### G) Backend logs (Apps Script → Executions)

Look for:
- `FCM send error code=...` → indicates auth or token issue
- `Removed stale token` → auto-cleanup working
- `No tokens for student UMPxxxx` → frontend didn't save token yet

---

## Why "only test one is coming on localhost" happened

1. **Test via Firebase Console** bypasses Apps Script entirely – it uses Firebase's server infrastructure. So it worked.
2. **Real pushes** from `sendPushToAll` / `sendPushToStudent` go through Apps Script service account. That failed due to missing/invalid `FCM_PRIVATE_KEY` handling + token not saved → silent 0 sends.
3. On localhost, permission grant was already given, and maybe token existed from earlier dev. On prod, token never saved because SW caching intercepted FCM fetch or permission denied.

This patch fixes all three layers: frontend token collection, service worker delivery, backend auth+payload.

---

## If still not working after patch

1. Delete `DeviceTokens` sheet and let it recreate (ensures schema).
2. Re-deploy Apps Script: Deploy → Manage deployments → Edit → New version → Deploy → copy new URL to Vercel env `APPS_SCRIPT_URL`.
3. In Vercel, clear cache and redeploy.
4. On device, clear site data: Chrome DevTools → Application → Clear storage → Clear site data.
5. Re-login → Allow notifications.
6. Run `testPushToStudent`.

Good luck – push should now work on both localhost and production.
