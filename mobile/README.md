# Ujjwal Pathak Mentorship — Native mobile app

A separate React Native + Expo Android client for the existing student dashboard. It uses native navigation, controls and encrypted credential storage; it is not a WebView wrapper.

## Safety boundary

- The original web app files are not imported or modified by this app.
- The existing Apps Script, Sheets and Vercel proxy are not modified.
- Mock mode remains the local-development default, so development cannot write production data accidentally.
- Connected modes consume the same existing `POST /api/proxy` action/payload contract used by `api.js`; no Apps Script, Sheet or proxy change is required.
- **Live preview** authenticates and reads real data while the API client blocks every mutation.
- **Full live** enables the existing backend’s study-log, proof, password-recovery/change and feedback-read writes after an explicit runtime warning. The production APK profile starts directly in Full live and locks out mode switching.
- Focus, Study Receipt and Daily MCQ remain intentionally device-local because the current backend has no corresponding endpoints.

## Current native flows

- Student login and encrypted session restore
- Forgot password → OTP → reset password
- Dashboard, metrics, 7-day rhythm, announcements and mentor guidance
- Daily tracker history and native study-log form with photo/PDF proof
- Leaderboard and personal rank summary
- Weekly reports
- Group I/Group II → Subject → Category → File study-material hierarchy with protected in-app Drive preview; latest Drive/Sheet rows are fetched whenever Material or a subject folder is opened, with pull-to-refresh as fallback
- YPT-style Focus Room timer with subject selection, session targets, pause/resume, daily totals and local history
- Study Receipts with closed-book self-recall, recall-effort score and 24-hour memory checks
- Separate Group I and Group II Daily MCQ Challenges with a balanced 7 normal + 3 case-study format, timers, persistence, streaks and source-aware explanation review
- Unlimited MCQ Practice Zone with Group I/II/Combined, subject, exact official ICAI module chapter, Normal/Case Study, Easy/Medium/Hard, configurable session size and incorrect-answer retry
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

The preview APK includes separate deterministic 10-question challenges for CA Intermediate Group I and Group II. Each challenge deliberately mixes **7 normal MCQs + 3 original case-study MCQs**, and has its own daily attempt, 10-minute timer, result and streak. Attempts survive navigation/app restarts and store explanations locally.

The source manifest targets ICAI BoS material applicable for the September 2026 examination (official study-material applicability notice, amendments/developments page, and MCQ/case-scenario portal), last reviewed on 15 August 2026. The app does not copy or mirror ICAI questions: the included questions are original practice content mapped to exact official module chapters. They remain visibly labelled **draft** until a mentor verifies chapter, source page, applicable attempt and amendments. Production needs a managed question-bank API that can deactivate stale questions when a newer amendment set is published.

### Official chapter taxonomy

`src/data/icaiChapterCatalog.ts` contains the canonical 94-chapter catalogue transcribed from the official ICAI BoS material applicable for May 2026 onwards: paper/section, module, chapter number, exact title, official source page and curriculum order. Both Daily MCQ and Unlimited Practice display this mapping. Chapter filters include only chapters currently represented in the draft bank and follow official paper/module/chapter order rather than alphabetical order.

Every question ID has an explicit canonical chapter ID in `src/data/mcqMetadata.ts`. Validation fails closed for a missing, stale or cross-subject mapping; there is no generated “general” chapter fallback. Questions based on the Indian Contract Act and basic bookkeeping were replaced because those topics are not chapters in the current CA Intermediate Paper 2 / Advanced Accounting May 2026 module structure. On upgrade, completed legacy attempts remain available for aggregate history/streaks, while an unfinished legacy session (or a same-day legacy Daily Challenge) is safely refreshed so changed question text is never paired with an old answer.

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

Mock mode is used when `EXPO_PUBLIC_BACKEND_MODE` is absent. A safe build can explicitly switch between Mock, Live preview and Full live from the login screen.

## Run against the existing API

Create `mobile/.env.local` (ignored by Git). Start with read-only validation:

```env
EXPO_PUBLIC_BACKEND_MODE=live-readonly
EXPO_PUBLIC_ALLOW_MODE_SWITCH=false
EXPO_PUBLIC_API_BASE_URL=https://student-dashboard-frontend-iota.vercel.app
```

After read validation with a designated test student, enable the full existing contract:

```env
EXPO_PUBLIC_BACKEND_MODE=live
EXPO_PUBLIC_ALLOW_MODE_SWITCH=false
EXPO_PUBLIC_API_BASE_URL=https://student-dashboard-frontend-iota.vercel.app
```

`EXPO_PUBLIC_API_BASE_URL` can be either the deployment origin or a complete `/api/proxy` URL. Full live supports the existing login, dashboard, tracker, proof upload, leaderboard, reports, announcements, mentor notes, study material, feedback-read, OTP reset and password-change actions. Test mutations only with the dedicated test student before wider distribution.

## Validate

```bash
npm run typecheck
npm run validate
```

`validate` type-checks the code and creates a production Android JavaScript bundle. It does not call the backend.

## Direct APK updates outside Play Store

Version 1.10.0 is the one-time manually installed updater baseline. In Full Live mode the app checks the existing API on startup and when returning to foreground. If `app.version` reports a higher Android version code, the app shows an optional or mandatory update modal, downloads the HTTPS APK into private cache and opens Android's installer. Android always asks the student to confirm the final installation.

The release APK must be hosted at a permanent public HTTPS download URL; private/expiring GitHub Actions artifacts are not valid updater URLs. Firebase Storage plus Apps Script Properties is the configured publishing model. Backend and release instructions are in `docs/APP_UPDATE_BACKEND_SETUP.md`.

## APK profiles

`eas.json` contains three direct-install APK profiles:

```bash
# Safe sample-data APK; login screen can explicitly opt into connected modes
npx eas-cli build --platform android --profile preview

# Locked real-data/no-write validation APK
npx eas-cli build --platform android --profile apk-readonly

# Locked Full live APK with the complete existing backend contract
npx eas-cli build --platform android --profile apk
```

All profiles produce APKs rather than Play Store AABs. Validate the Full live build with the dedicated test student—including exactly one small study-log submission and its proof—before wider distribution. Preserve the generated Android signing key so future APK updates install over the current version.

## Native push notifications

The Android app is registered in the existing `ump-dashboard` Firebase project. On a physical Full Live device, the app requests Android notification permission, obtains the raw FCM token and stores it through the existing `saveDeviceToken` backend action. Foreground alerts, token rotation, background notification taps and deep links to Material, Tracker, Reports and Daily MCQ are handled natively.

The Apps Script must also include the Android-specific `android.notification` payload and re-enable one summary push after manual Drive-note sync; exact instructions are in `docs/NATIVE_PUSH_SETUP.md`. Keep `FCM_PRIVATE_KEY` only in Apps Script Properties—never in the APK or repository.
