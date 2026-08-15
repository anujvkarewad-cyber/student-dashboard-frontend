# Ujjwal Pathak Mentorship — Native mobile app

A separate React Native + Expo Android client for the existing student dashboard. It uses native navigation, controls and encrypted credential storage; it is not a WebView wrapper.

## Safety boundary

- The original web app files are not imported or modified by this app.
- The existing Apps Script, Sheets and Vercel proxy are not modified.
- Mock mode is the default, so local development cannot write production data accidentally.
- Live mode only consumes the same existing `POST /api/proxy` action/payload contract used by `api.js`.
- The login screen provides a persisted **Live read-only** mode. It can authenticate and fetch real data, while every backend mutation is blocked in the API client. Local-only Focus, Study Receipt and Daily MCQ data continue to work.

## Current native flows

- Student login and encrypted session restore
- Forgot password → OTP → reset password
- Dashboard, metrics, 7-day rhythm, announcements and mentor guidance
- Daily tracker history and native study-log form with photo/PDF proof
- Leaderboard and personal rank summary
- Weekly reports
- Group I/Group II and subject-wise study material with protected in-app Drive preview
- YPT-style Focus Room timer with subject selection, session targets, pause/resume, daily totals and local history
- Study Receipts with closed-book self-recall, recall-effort score and 24-hour memory checks
- Separate Group I and Group II Daily MCQ Challenges with 10 deterministic questions each, timers, persistence, streaks and explanation review
- In-app notification center with unread badge, MCQ/memory-review reminders, filters and read state
- Profile, password update and logout
- Cached dashboard data plus pull-to-refresh
- Time-aware hero with opt-in local weather, adaptive colors and glass surfaces

## Protected note previews

Notes open inside the app through the Google Drive `/preview` surface. The app does not provide download or external-open actions, blocks download/export navigations, hides common download/print controls, and prevents screen capture while the native preview is open. The Drive owner should also open each file's sharing settings and disable **Viewers and commenters can see the option to download, print, and copy**. No client app can make displayed content mathematically copy-proof, but using both controls provides the strongest practical restriction.

## Focus timer privacy

Focus sessions and active timer state are stored locally per student on the device. The timer survives navigation, pause/resume and app restarts by using timestamps, and the screen remains awake while a session runs. It does not write timer data to Apps Script or Google Sheets in this version.

On session completion, the app creates three closed-book recall prompts from the student's subject and declared target. The resulting Study Receipt clearly labels its score as **recall effort**, not academic correctness. A 24-hour self-reported memory check is scheduled locally and appears in the notification center when due. Source-grounded AI grading remains disabled until a secure server-side AI endpoint and mentor-approved PDF sources are configured; no AI secret is shipped in the APK.

## Daily MCQ content safety

The preview APK includes separate deterministic 10-question challenges for CA Intermediate Group I and Group II, selected from a local foundation-question bank. Each group has its own daily attempt, 10-minute timer, result and streak. Attempts survive navigation/app restarts and store explanations locally. The bank is visibly labelled **demo draft** and must not be treated as mentor-approved exam preparation. Before the connected release, questions need mentor approval, syllabus/version metadata, source citations, and a managed question-bank API.

## Location and weather privacy

The dashboard requests foreground location only while the app is in use. Coordinates are sent directly from the device to the key-free Open-Meteo forecast API and are never sent to the mentorship backend. Precise coordinates are not persisted; only the latest weather summary and broad city/region label are cached for 30 minutes. If permission is denied or weather is unavailable, the UI falls back to a fully functional local-time theme.

## Run safely

```bash
cd mobile
npm install
npm start
```

Mock login:

```text
Student ID: UMP2407
Password:   demo123
OTP:        123456
```

Mock mode is used when `EXPO_PUBLIC_USE_MOCKS` is absent or not equal to `false`.

## Run against the existing API

Create `mobile/.env.local` (ignored by Git):

```env
EXPO_PUBLIC_USE_MOCKS=false
EXPO_PUBLIC_READ_ONLY=true
EXPO_PUBLIC_API_BASE_URL=https://student-dashboard-frontend-iota.vercel.app
```

`EXPO_PUBLIC_API_BASE_URL` can be either the deployment origin or a complete `/api/proxy` URL. No backend change is required.

Use a designated test student for login validation. The current connected mode is deliberately read-only: `addStudyLog`, password recovery/reset/change, and feedback-read updates throw before any backend request is sent.

## Validate

```bash
npm run typecheck
npm run validate
```

`validate` type-checks the code and creates a production Android JavaScript bundle. It does not call the backend.

## APK profiles

`eas.json` contains two direct-install APK profiles:

```bash
# Safe sample-data APK
npx eas-cli build --platform android --profile preview

# Existing-backend-connected APK
npx eas-cli build --platform android --profile apk
```

Both profiles produce an APK rather than a Play Store AAB. The final connected APK must be tested with a dedicated student account before wider sharing. Preserve the generated Android signing key so future APK updates install over the current version.

## Native push notifications

Native FCM is intentionally not enabled yet. It requires adding an Android app in Firebase and the matching `google-services.json`. That is additive and does not alter the existing web Firebase app. It should be configured after the core APK has passed real-device tests.
