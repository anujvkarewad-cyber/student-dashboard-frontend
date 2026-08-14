# Ujjwal Pathak Mentorship — Native mobile app

A separate React Native + Expo Android client for the existing student dashboard. It uses native navigation, controls and encrypted credential storage; it is not a WebView wrapper.

## Safety boundary

- The original web app files are not imported or modified by this app.
- The existing Apps Script, Sheets and Vercel proxy are not modified.
- Mock mode is the default, so local development cannot write production data accidentally.
- Live mode only consumes the same existing `POST /api/proxy` action/payload contract used by `api.js`.

## Current native flows

- Student login and encrypted session restore
- Forgot password → OTP → reset password
- Dashboard, metrics, 7-day rhythm, announcements and mentor guidance
- Daily tracker history and native study-log form with photo/PDF proof
- Leaderboard and personal rank summary
- Weekly reports
- Subject-wise notes/study material
- Profile, password update and logout
- Cached dashboard data plus pull-to-refresh
- Time-aware hero with opt-in local weather, adaptive colors and glass surfaces

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
EXPO_PUBLIC_API_BASE_URL=https://student-dashboard-frontend-iota.vercel.app
```

`EXPO_PUBLIC_API_BASE_URL` can be either the deployment origin or a complete `/api/proxy` URL. No backend change is required.

Use only a designated test student for write-flow testing (`addStudyLog`, password changes) because a connected build sends real actions to the existing backend.

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
