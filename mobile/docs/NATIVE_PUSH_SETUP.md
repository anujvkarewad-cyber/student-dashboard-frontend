# Native Android push setup

The React Native client is ready to request Android notification permission, obtain the raw FCM token, save it through the existing `saveDeviceToken` action, refresh live content on foreground receipt, and route notification taps.

## 1. Firebase Android app (owner action)

In Firebase Console, open the existing `ump-dashboard` project and add an Android app:

- Android package name: `com.ujjwalpathak.mentorship`
- App nickname: `UPM Android`
- SHA certificate: optional for FCM-only setup

Download `google-services.json` and place it at `mobile/google-services.json`. This file contains client configuration, not the FCM service-account private key. Never place the service-account JSON or `FCM_PRIVATE_KEY` in the repository or APK.

Then add this property inside `expo.android` in `mobile/app.json`:

```json
"googleServicesFile": "./google-services.json"
```

## 2. Apps Script Android notification payload

In `sendFcmToToken_`, retain the existing `data` and `webpush` values, but replace the Android block:

```js
android: { priority: 'HIGH' },
```

with:

```js
android: {
  priority: 'HIGH',
  notification: {
    title: safeTitle,
    body: safeBody,
    channel_id: 'ump-updates',
    sound: 'default',
    tag: dataPayload.tag,
    color: '#3157D5'
  }
},
```

This gives Android an OS-rendered background notification while preserving the website's data-only service-worker handling.

## 3. Manual Drive-drop material push

`syncNotesFromDrive()` currently skips push after adding new Drive files. Replace that skipped-push block with:

```js
if (addedCount > 0) {
  const summary = addedCount === 1
    ? 'A new study material is available.'
    : addedCount + ' new study materials are available.';
  sendPushToAll('New study material added', summary, {
    link: '/#notes',
    tag: 'notes-sync-' + Date.now()
  });
}
```

`createNote()` already sends its own push. A file uploaded through `createNote()` is already present in the Notes sheet, so the later Drive scan skips it by file ID and does not send a duplicate.

## 4. Security cleanup

Remove this line from `handleAction`:

```js
Logger.log('PAYLOAD = ' + JSON.stringify(payload));
```

It can log passwords, OTPs and file chunks. Keep only action-name logging.

Keep `FCM_PRIVATE_KEY` only in Apps Script Properties. Never paste it into chat, source control, `google-services.json`, or the mobile app.

## 5. Device validation

1. Install the newly built APK on a physical Android device.
2. Sign in with the dedicated test student.
3. Allow notifications when Android prompts.
4. Confirm a row for that student appears in `DeviceTokens`.
5. Run `testPushToStudent` with the test student ID.
6. Test foreground, background and fully closed app states.
7. Upload one Drive PDF, run notes sync, and confirm tapping the push opens Material and refreshes the new file.
