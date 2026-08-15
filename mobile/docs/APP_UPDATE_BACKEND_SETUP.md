# Direct APK update channel (outside Play Store)

Version 1.10.0 is the one-time manually installed baseline. Starting with this version, the app checks the existing Apps Script API for a newer Android release, downloads the APK to private cache, and opens Android's package installer. Android always requires the student to confirm the final installation.

## 1. Add API route

Add this case to `handleAction`:

```js
case 'app.version': return getAndroidAppVersion();
```

Add this function outside `handleAction`:

```js
function getAndroidAppVersion() {
  const props = PropertiesService.getScriptProperties();
  return {
    version: String(props.getProperty('APP_ANDROID_VERSION') || '1.10.0'),
    versionCode: Number(props.getProperty('APP_ANDROID_VERSION_CODE') || 14),
    minimumVersionCode: Number(props.getProperty('APP_ANDROID_MIN_VERSION_CODE') || 14),
    apkUrl: String(props.getProperty('APP_ANDROID_APK_URL') || ''),
    releaseNotes: String(props.getProperty('APP_ANDROID_RELEASE_NOTES') || ''),
    forceUpdate: String(props.getProperty('APP_ANDROID_FORCE_UPDATE') || 'false').toLowerCase() === 'true',
    publishedAt: String(props.getProperty('APP_ANDROID_PUBLISHED_AT') || '')
  };
}
```

Save, create a new Web App deployment version, and keep the same `/exec` URL.

## 2. Permanent APK hosting

GitHub Actions artifacts expire and this repository is private, so they cannot be used by the app's updater. Upload each final APK to the existing Firebase Storage project, for example:

```text
android-releases/UPM-v1.10.0.apk
```

Copy the Firebase **download URL** containing `alt=media` and a download token. The URL must be HTTPS and must download the APK without requiring a Google/Firebase sign-in.

## 3. Script Properties for the baseline

In Apps Script → Project Settings → Script Properties, add:

```text
APP_ANDROID_VERSION = 1.10.0
APP_ANDROID_VERSION_CODE = 14
APP_ANDROID_MIN_VERSION_CODE = 14
APP_ANDROID_APK_URL = <Firebase Storage direct download URL>
APP_ANDROID_RELEASE_NOTES = Native push notifications and secure in-app updater.
APP_ANDROID_FORCE_UPDATE = false
APP_ANDROID_PUBLISHED_AT = 2026-08-15
```

Because installed v1.10.0 also has code 14, it will not prompt to install itself.

## 4. Publishing the next update

1. Build a higher version code, e.g. v1.10.1 / code 15.
2. Upload that APK to Firebase Storage.
3. Update `APP_ANDROID_VERSION`, `APP_ANDROID_VERSION_CODE`, `APP_ANDROID_APK_URL`, notes and date.
4. Set `APP_ANDROID_MIN_VERSION_CODE` to the oldest still-supported build.
5. Set `APP_ANDROID_FORCE_UPDATE=true` only for a critical security or compatibility update.

No Apps Script redeployment is needed when only Script Property values change.

## Security notes

- Never use a private GitHub artifact URL in `APP_ANDROID_APK_URL`.
- Never put Firebase service-account credentials or `FCM_PRIVATE_KEY` in Script Properties used by the app-version response.
- Keep the Android signing key stable. Android rejects an APK update signed by a different key.
- The current preview pipeline signs with the template key. Move to a private production keystore before treating this as a permanent public distribution channel.
