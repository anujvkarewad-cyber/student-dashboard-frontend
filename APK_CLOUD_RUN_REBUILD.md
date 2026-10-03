# Naya APK — Cloud Run par shift (v1.14.5 / versionCode 40)

## Naya APK kyun zaroori hai

Students ke paas jo APK hai (v1.14.2 / code 37), uske bundle me ye URL **baked**
hai:

```
https://student-dashboard-frontend-iota.vercel.app
```

Ye Vercel deployment band hai (402), isliye app ko HTML error page milta hai aur
`response.json()` crash karti hai → *"Server returned an unreadable response."*

App me **OTA / expo-updates nahi** hai, aur `*.vercel.app` domain Vercel ke
control me hai — isliye bina naye build ke URL badalna **sambhav nahi**. Ek hi
raasta: naya APK.

---

## Cloud Run par kya ready hai

Naya APK sab kuch **ek hi origin** se karega:

| App kya call karta hai | Cloud Run par route | Status |
|---|---|---|
| `<origin>/api/proxy` | `api/proxy.js` (Mongo routing, cache, retry) | ✅ live |
| `<origin>/api/mentor/*` | FastAPI backend ko reverse proxy | ✅ live |
| `<origin>/api/proof-upload` | Drive upload (worker se port kiya gaya) | ⚙️ env chahiye (neeche) |

---

## Step 1 — Proof upload ke secrets Cloud Run par daalein

Study log bina proof ke save nahi hota, isliye ye step **chhodna nahi hai**.
Wahi service account aur folder use kijiye jo Cloudflare worker me tha.

```bash
cd ~/student-dashboard-frontend

# service account key file Cloud Shell me upload karein (upload-key.json),
# phir use Secret Manager me daalein
gcloud secrets create ump-drive-sa --data-file=upload-key.json 2>/dev/null \
  || gcloud secrets versions add ump-drive-sa --data-file=upload-key.json

# Cloud Run service account ko padhne ki permission
PROJNUM=$(gcloud projects describe ump-dashboard --format='value(projectNumber)')
gcloud secrets add-iam-policy-binding ump-drive-sa \
  --member="serviceAccount:${PROJNUM}-compute@developer.gserviceaccount.com" \
  --role=roles/secretmanager.secretAccessor

gcloud run services update student-dashboard --region asia-south1 \
  --set-secrets GOOGLE_SERVICE_ACCOUNT_JSON=ump-drive-sa:latest \
  --update-env-vars DRIVE_PROOF_FOLDER_ID=<Drive folder ka ID>
```

> Folder ID wahi hai jo worker ke `DRIVE_PROOF_FOLDER_ID` secret me tha. Drive
> folder ko service account ke email ke saath **Editor** access dena zaroori hai.
> Key file use karne ke baad `rm upload-key.json` kar dijiye.

Check:
```bash
curl -s -X PUT https://student-dashboard-566076646952.asia-south1.run.app/api/proof-upload \
  -H 'Content-Type: image/png' -H 'X-Student-Id: TEST123' -H 'X-Session-Password: x'
# "Session expired. Sign in again."  -> configured hai (401)
# "Proof upload is not configured"   -> secrets abhi missing hain (501)
```

## Step 2 — EAS env ko naye URL par set karein

```bash
cd ~/student-dashboard-frontend/mobile
npx eas-cli@latest login

npx eas-cli@latest env:create --environment production \
  --name EXPO_PUBLIC_API_BASE_URL \
  --value https://student-dashboard-566076646952.asia-south1.run.app \
  --visibility plaintext --force

npx eas-cli@latest env:list --environment production   # verify
```

Agar `EXPO_PUBLIC_MENTOR_SYNC_SECRET` pehle se set hai to usse haath mat lagaiye.

## Step 3 — Build

Repo me version pehle hi bump kar diya gaya hai: **1.14.5 / versionCode 40**
(`mobile/app.json`, `mobile/eas.json`, `mobile/src/config.ts`).

```bash
cd ~/student-dashboard-frontend/mobile
npx eas-cli@latest build --platform android --profile apk
```

Build ~15-25 min leta hai. Ant me APK ka download link milega.

## Step 4 — Release + force update

1. APK download karke `UPM-Android-Releases` repo me naya release banaiye:
   tag `v1.14.5-40`, file `UPM-v1.14.5-40-release.apk`
2. Us repo ki `latest.json` update kijiye:

```json
{
  "version": "1.14.5",
  "versionCode": 40,
  "minimumVersionCode": 40,
  "apkUrl": "https://github.com/anujvkarewad-cyber/UPM-Android-Releases/releases/download/v1.14.5-40/UPM-v1.14.5-40-release.apk",
  "sha256": "<shasum -a 256 APK se>",
  "notes": "App ab Google Cloud Run par. Login aur dashboard ka error theek.",
  "publishedAt": "2026-10-03T00:00:00Z"
}
```

`minimumVersionCode: 40` ka matlab: purane app me force-update screen aayegi.

> ⚠️ Lekin dhyan dein: purana app ye update-check bhi **Vercel ke zariye** karta
> hai (`app.version` → `/api/proxy`), jo band hai. Isliye kai students ko
> force-update screen dikhegi hi nahi — unhe APK link **WhatsApp/Telegram par
> manually** bhejna padega. Ye sabse zaroori step hai.

## Step 5 — Verify

Naya APK install karke:
- Login
- Stats / study log / announcements / leaderboard
- **Proof ke saath study log add** (Drive upload test)
- MCQ bank load (pehli baar ~7 MB)

Logs:
```bash
gcloud run services logs read student-dashboard --region asia-south1 --limit 50
```

---

## Aage ke liye sujhav

Aaj ki dikkat ki jadd: **URL app ke andar hard-coded tha.** Dobara na ho iske
liye ek me se ek kar lijiye:

1. **Custom domain** (sabse accha) — jaise `app.ujjwalpathak.com` ko Cloud Run
   par map kijiye, aur APK me wahi daalein. Aage hosting badle to sirf DNS
   badlega, naya APK nahi banana padega.
2. **expo-updates (OTA)** — chhote JS-level changes bina Play Store/APK ke
   bheje ja sakenge.
3. **Remote config** — app boot par ek chhoti `config.json` (GitHub raw par)
   padhe aur wahan se API origin le.
