# Updated Apps Script Block — Exact Application Steps

## Step 1: Open your Google Sheet
Go to the same spreadsheet used for the student dashboard.

## Step 2: Open Apps Script
Extensions → Apps Script.

## Step 3: Replace the FCM block
In `Code.gs` (or your existing script file):
- Find the line starting with `const FCM_PROJECT_ID`.
- Select everything from that line to the end of the file.
- Delete it.
- Copy the entire contents of `APPS_SCRIPT_FCM_FIX.gs` from this repo.
- Paste it in its place.

## Step 4: Verify Script Properties (required)
In the Apps Script editor:
- Click Project Settings (gear icon) → Script Properties.
- Ensure these properties exist:

| Property | Example Value |
|---|---|
| `FCM_PRIVATE_KEY` | The full PEM private key from Firebase service account JSON (`-----BEGIN PRIVATE KEY-----\n...`) |
| `FCM_CLIENT_EMAIL` | `firebase-adminsdk-fbsvc@ump-dashboard.iam.gserviceaccount.com` |
| `FCM_PROJECT_ID` | `ump-dashboard` |

If `FCM_PRIVATE_KEY` is missing, the weekly trigger and all pushes will fail silently.

## Step 5: Apply weekly guard (already included in new block)
The updated `sendWeeklyReportPushes()` already includes:
- `LockService.getScriptLock()` (30-second timeout)
- `LAST_WEEKLY_REPORT_PUSH_WEEK` property check
- Only pushes if the current week hasn't been pushed yet

No extra steps needed — the guard is automatic after pasting the new block.

## Step 6: Re-deploy (if needed)
If you have a web app deployment (`/exec` URL) in Vercel env `APPS_SCRIPT_URL`:
- In Apps Script: Deploy → Manage deployments → Edit → New version → Deploy.
- Copy the new `/exec` URL.
- Update Vercel environment variable `APPS_SCRIPT_URL` with the new URL.
- Redeploy Vercel.

## Step 7: Verify the guard works
In Apps Script editor, select function:
- `sendWeeklyReportPushes()`
- Click Run.

Expected log output (first run of the week):
```
✅ Weekly report pushes completed: X sent for week 2026-34
```

Expected log output (if already pushed this week):
```
✅ Weekly report already pushed for week 2026-34 — skipping.
```

## Step 8: Install/re-install triggers (optional)
If you want fresh triggers:
- Select `createWeeklyReportTrigger()` → Run.
- Select `createStreakReminderTrigger()` → Run.

These delete any existing triggers with the same handler and create new ones.
