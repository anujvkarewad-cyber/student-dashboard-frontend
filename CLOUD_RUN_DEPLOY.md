# Cloud Run Deployment — Student Dashboard

Vercel account `402 DEPLOYMENT_DISABLED` se band ho gaya, isliye ye app ab
**Google Cloud Run** par chalega. Backend (FastAPI + MongoDB Atlas) pehle hi
Cloud Run par live hai — usme koi change nahi hua.

---

## 1. Students ko jo error aa raha tha

```
Server returned an unreadable response. Please try again.
```

Ye message `mobile/src/api/client.ts` se aata hai jab `response.json()` fail
hoti hai. Band Vercel deployment **HTML ka 402 error page** return kar raha
tha, JSON nahi — isliye parse crash ho rahi thi.

Fix do hisson me hai:

1. Ek chalu host jo `/api/proxy` par hamesha JSON deta hai (ye deployment).
2. Naye server me **har `/api/*` response JSON hi hai** — 404, 500, timeout,
   sab. Chahe kuch bhi toote, client ko "unreadable response" dobara nahi
   milega; usko asli error message dikhega.

---

## 2. Architecture — pehle vs ab

**Pehle (Vercel + Cloudflare):**

```
browser/APK ──> Vercel static files
            └─> Vercel function /api/proxy ──> FastAPI backend
            └─> Cloudflare worker /api/mentor/* ──> FastAPI backend
```

**Ab (ek hi Cloud Run service):**

```
browser/APK ──> Cloud Run container (server.js)
                 ├─ static files      (index.html, app.js, style.css, assets, icon)
                 ├─ POST /api/proxy   -> api/proxy.js (bilkul wahi Vercel function)
                 ├─ GET /download/android -> APK ka live stream (kabhi expire
                 │                          nahi hota; app isi URL se update karta hai)
                 ├─ /api/mentor/*     -> FastAPI backend (reverse proxy)
                 └─ /health, /api/health
```

Humne **proxy wala option** chuna hai (seedha backend call karwane ke bajaye),
kyunki:

- Frontend ka default `window.MENTOR_API_URL = "/api/mentor"` same-origin hi
  rehta hai → **koi CORS issue nahi**, frontend JS me koi change nahi.
- `api/proxy.js` ka saara logic — in-memory read cache, in-flight de-dup,
  retry budget, cohort checks, Mongo routing, `app.version` — jaisa tha waisa
  hi chalta rehta hai. Ye logic 200 students ke "sab ek saath app kholte hain"
  storm ko sambhalta hai; use dobara likhna risky hota.
- Purana APK (jo `<origin>/api/proxy` call karta hai) bina rebuild ke bhi
  Cloud Run URL par kaam karega.

---

## 3. Naye / badle hue files

| File | Kaam |
|---|---|
| `server.js` | Node HTTP server — static files + `/api/proxy` shim + `/api/mentor` proxy + health. **Zero npm dependencies** (sirf Node standard library). |
| `Dockerfile` | `node:20-alpine`, koi build step nahi, koi `npm install` nahi. |
| `.dockerignore`, `.gcloudignore` | `mobile/`, `content-pipeline/`, `cloudflare/`, `.git` image/upload se bahar. |
| `scripts/deploy-cloudrun.sh` | One-command deploy + smoke test. |
| `package.json` | `start` script, `engines: node >=20`, `googleapis` ab `optionalDependencies` me (sirf legacy `/api/sheets` ke liye). |
| `api/proxy.js` | Ek chhota change: `APPS_SCRIPT_URL` na ho to `addStudyLog` Mongo me save hota hai aur baaki legacy actions saaf JSON 503 dete hain (pehle 500 "misconfigured" aata tha). |

`index.html`, `app.js`, `api.js`, `mentor-host.js` — **inme koi change nahi**.

---

## 4. Deploy karne ka tarika (Cloud Shell)

```bash
git clone https://github.com/anujvkarewad-cyber/student-dashboard-frontend.git
cd student-dashboard-frontend
git checkout arena/01a10189-student-dashboard-frontend

./scripts/deploy-cloudrun.sh
```

Script ye karta hai: project set, APIs enable, `gcloud run deploy --source .`,
phir health/`/api/proxy` smoke test. Defaults:

| Setting | Value |
|---|---|
| project | `ump-dashboard` |
| region | `asia-south1` |
| service | `student-dashboard` |
| auth | `--allow-unauthenticated` |
| min instances | `1` (cold start se bachne ke liye — login slow nahi lagega) |
| max instances | `10` |
| memory / cpu | `512Mi` / `1` |
| `MENTOR_API_URL` | `https://ujjwal-pathak-app-566076646952.asia-south1.run.app` |

Manual command (agar script na chalana ho):

```bash
gcloud config set project ump-dashboard

gcloud run deploy student-dashboard \
  --source . \
  --region asia-south1 \
  --allow-unauthenticated \
  --port 8080 \
  --min-instances 1 --max-instances 10 \
  --memory 512Mi --cpu 1 --concurrency 80 --timeout 1800 \
  --set-env-vars MENTOR_API_URL=https://ujjwal-pathak-app-566076646952.asia-south1.run.app
```

---

## 5. Environment variables

| Variable | Zaroori? | Kaam |
|---|---|---|
| `MENTOR_API_URL` | **Haan** | FastAPI backend ka base URL. Iske bina login/dashboard kuch nahi chalega. |
| `PORT` | Nahi | Cloud Run khud deta hai (8080). |
| `APPS_SCRIPT_URL` | Nahi | Sirf tab set karein jab purana Apps Script abhi bhi live hai aur `forgotPassword` / `verifyOTP` / `resetPassword` / `validateStudent` / `saveDeviceToken` jaise legacy actions chahiye. |
| `MENTOR_SERVICE_TOKEN` | Nahi | Agar backend bearer token maangta ho (abhi nahi maangta). |
| `APP_ANDROID_*` | Nahi | `app.version` ke fallback. Live `latest.json` pehle try hota hai. |

---

## 6. Deploy ke baad verify

```bash
URL=$(gcloud run services describe student-dashboard --region asia-south1 --format='value(status.url)')

curl -s $URL/api/health
# {"ok":true,"service":"student-dashboard-frontend","backendConfigured":true,...}

curl -s -X POST $URL/api/proxy -H 'Content-Type: application/json' \
  -d '{"action":"getAnnouncements","payload":{}}'
# {"result":[...]}   <- JSON, HTML nahi. Yahi "unreadable response" ka fix hai.

curl -s $URL/api/mentor/api/health
# backend health, same-origin route se
```

Browser me `$URL` kholiye aur ek test student se login kijiye. DevTools →
Network me `/api/proxy` par `200` + `application/json` dikhna chahiye.

---

## 7. Students ko nayi URL par bhejna

1. **Web users** — naya Cloud Run URL share kijiye. Behtar: `ump-dashboard`
   ke custom domain ko Cloud Run par map kijiye taaki purana link kaam karta
   rahe:
   ```bash
   gcloud beta run domain-mappings create \
     --service student-dashboard --domain app.example.com --region asia-south1
   ```
   Phir DNS me jo record gcloud batata hai wo daal dijiye.

2. **Android APK** — purana APK (v1.14.2/37) ke bundle me Vercel URL baked hai,
   isliye naya build zaroori hai. Pura tarika: **`APK_CLOUD_RUN_REBUILD.md`**.
   Proof upload (`/api/proof-upload`) ab Cloud Run par bhi maujood hai
   (`lib/proof-upload.js`) — bas Drive ke secrets set karne honge.

3. **Service worker** — `index.html`, `service-worker.js`,
   `firebase-messaging-sw.js`, `manifest.json` `no-store` ke saath serve hote
   hain, isliye students purane cached build par atke nahi rahenge.

---

## 8. Purani hosting ka kya karein

- `vercel.json` aur `.github/workflows/vercel-auto-deploy.yml` repo me abhi
  bhi hain. Vercel account dead hai, isliye wo workflow sirf fail hoga —
  Cloud Run settle hone ke baad use delete/disable kar dijiye.
- `cloudflare/` worker ko abhi mat hataiye: purane APK builds usi gateway par
  hain, aur proof upload wahi handle karta hai.

---

## 9. Local testing

```bash
MENTOR_API_URL=https://ujjwal-pathak-app-566076646952.asia-south1.run.app \
PORT=8080 node server.js
# http://localhost:8080
```

Docker se:

```bash
docker build -t ump-dashboard .
docker run -p 8080:8080 \
  -e MENTOR_API_URL=https://ujjwal-pathak-app-566076646952.asia-south1.run.app \
  ump-dashboard
```


---

## 7. App update delivery fix (14-Oct-2026)

**Problem:** `app.version` students ko GitHub ka *signed* URL deta tha
(`release-assets.githubusercontent.com/...&se=<1 ghante baad expire>`). App us URL
ko poore session ke liye yaad rakhta hai aur har **Retry** par wahi bhejta hai. Jo
student modal aane ke kaafi der baad download karta - ya jiska download ek baar fail
hokar retry hua - uske paas dead URL reh jaata tha: blocking modal, hamesha fail.
Isi wajah se "maximum bachon ko update krte samay issue" aa raha tha.

**Fix (sirf server-side - koi student APK update nahi chahiye):**

| Change | File |
|---|---|
| `app.version` ab apne hi origin ka stable URL deta hai: `https://<origin>/download/android` (no expiry, no redirect) | `api/proxy.js` |
| Naya `streamAndroidApk`: APK bytes seedha stream karta hai - 200, asli `Content-Length`, `Accept-Ranges: bytes`, `Content-Type: application/vnd.android.package-archive`. Range/206 pass-through. Upstream fail ho to canonical GitHub release URL par 302 | `lib/android-download.js` |
| `/download/android?mode=redirect` = purana 302 (website/email links) | `server.js` |
| Manifest read 60s cache (200 students ek saath → raw.githubusercontent rate-limit se bachav) | `lib/android-download.js` |
| `--timeout 1800` + `--update-env-vars` (existing env/secrets wipe na hon) | `scripts/deploy-cloudrun.sh` |

Tests: `npm test` (16 android-download tests incl. 5 naye streaming tests) - sab pass.

**Deploy (ye ek hi cheez bachi hai):**

```bash
cd student-dashboard-frontend && ./scripts/deploy-cloudrun.sh
```

Deploy ke baad students ko sirf itna: **app band karke dobara kholo** → naya
`app.version` milega (stable URL) aur update chal jayega. Jo students already
update kar chuke hain, unke liye kuch nahi badalta.
