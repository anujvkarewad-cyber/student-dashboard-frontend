# Emergency Cloudflare Free gateway + Android 1.14.4 (39)

This migration removes provider URLs from the APK. The APK calls one Cloudflare Worker; encrypted Worker secrets select Apps Script, the mentor service and Google Drive. Proof binaries go directly to the Worker/Drive route and never enter the JSON proxy.

## 1. Prepare Google Drive (do not paste credentials into GitHub or chat)

1. In Google Cloud, enable **Google Drive API** in the project used for the dashboard.
2. Create a dedicated service account and download its JSON key once.
3. In Drive, create/select the proof folder and share it with the service-account email as **Editor**.
4. Copy the folder ID from `drive.google.com/drive/folders/<FOLDER_ID>`.
5. Keep the JSON key outside this repository. Rotate it immediately if it is ever committed or shared.

The gateway accepts PDF/JPEG/PNG/WebP, authenticates the saved student session, enforces **10 MiB (10,485,760 bytes)**, uploads the original binary to that folder and returns a Drive URL.

## 2. Apply the Apps Script compatibility line

In the production Apps Script `addStudyLog` action, replace `let proofUrl='';` with:

```js
let proofUrl = String(payload.proofUrl || '');
```

The exact migration is also in `APPS_SCRIPT_CLOUDFLARE_MIGRATION.gs`. Create a new Apps Script deployment version and retain its `/exec` URL. This preserves old base64 clients while 1.14.4 sends the already-uploaded `proofUrl`.

## 3. Create and encrypt Cloudflare Worker settings

A Cloudflare Free account is sufficient. Install dependencies and authenticate locally:

```bash
cd cloudflare
npm install
npx wrangler login
```

Add secrets interactively. Wrangler encrypts them at rest and does not write their values to `wrangler.toml`:

```bash
npx wrangler secret put APPS_SCRIPT_URL
npx wrangler secret put MENTOR_ORIGIN
npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_EMAIL
npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
npx wrangler secret put DRIVE_PROOF_FOLDER_ID
# only if the mentor service requires a machine token:
npx wrangler secret put MENTOR_SERVICE_TOKEN
```

For the private key, paste the complete `-----BEGIN PRIVATE KEY-----` value. Literal `\n` or real line breaks are both supported. `MENTOR_ORIGIN` is the single current upstream origin; there is no Vercel/Render fallback in code.

Deploy and verify:

```bash
npm test
npx wrangler deploy
curl https://upm-emergency-gateway.<your-subdomain>.workers.dev/health
```

Expected: `{"ok":true,"service":"upm-emergency-gateway"}`. Do not expose the Worker secret values in Cloudflare Variables, build logs, screenshots or the APK.

## 4. Encrypt the APK gateway setting in EAS

The public Worker origin is not a secret cryptographically, but storing it in EAS keeps build configuration centralized and prevents accidental provider fallbacks. In the Expo project run:

```bash
cd mobile
npx eas-cli env:create production --name EXPO_PUBLIC_API_BASE_URL \
  --value https://upm-emergency-gateway.<your-subdomain>.workers.dev \
  --visibility sensitive
npx eas-cli env:create preview --name EXPO_PUBLIC_API_BASE_URL \
  --value https://upm-emergency-gateway.<your-subdomain>.workers.dev \
  --visibility sensitive
```

Do **not** add `/api/proxy`; the app derives `/api/proxy`, `/api/proof-upload` and `/api/mentor` from this one origin. Production has no default URL and fails closed if the EAS value is absent.

## 5. Smoke test before release

Use only a designated test student:

1. Test login, dashboard reads and logout.
2. Turn off the Worker/upstream briefly and restart the app. A previously validated encrypted session must still open; a wrong password must still clear/reject the session.
3. Submit one small PDF proof, then one file just below 10 MiB. Confirm each Drive URL appears in the study-log Sheet.
4. Confirm a file above 10 MiB is rejected before upload.
5. Test password change, update check and mentor/AI routes.

## 6. Build the signed 1.14.4 / 39 APK

`mobile/app.json` is pinned to version `1.14.4`, Android version code `39`; `eas.json` reads the production EAS environment.

```bash
cd mobile
npm ci
npm run typecheck
npm run validate
npx eas-cli build --platform android --profile apk
```

At the signing prompt, reuse the **same existing Android keystore** used for 1.14.2/37. Choosing a new keystore makes Android reject an in-place update. Prefer EAS-managed credentials; if credentials are local, keep `credentials.json`, `.jks`, passwords and aliases outside Git. Never send them in chat.

Download the APK from the completed EAS build and verify it before publishing:

```bash
apksigner verify --verbose --print-certs UPM-v1.14.4-39-release.apk
apkanalyzer manifest version-name UPM-v1.14.4-39-release.apk
apkanalyzer manifest version-code UPM-v1.14.4-39-release.apk
sha256sum UPM-v1.14.4-39-release.apk
```

Compare the signer SHA-256 certificate digest with the currently installed/released APK. Expected manifest values are `1.14.4` and `39`.

## 7. Publish the updater manifest

Create release/tag `v1.14.4-39` in `UPM-Android-Releases`, upload `UPM-v1.14.4-39-release.apk`, and update `latest.json` only after device installation succeeds:

```json
{
  "version": "1.14.4",
  "versionCode": 39,
  "minimumVersionCode": 37,
  "apkUrl": "https://github.com/anujvkarewad-cyber/UPM-Android-Releases/releases/download/v1.14.4-39/UPM-v1.14.4-39-release.apk",
  "sha256": "<verified sha256>",
  "notes": "Emergency Cloudflare gateway, 10 MB direct Drive proof upload, and outage-safe saved sessions.",
  "publishedAt": "<ISO-8601 UTC>"
}
```

Use `forceUpdate: false` for a staged rollout. Raise `minimumVersionCode` or enable a forced update only after multiple devices have successfully upgraded and rollback has been tested.
