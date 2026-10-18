# In-app APK update reliability — local repair, 18 Oct 2026

**Subsequent owner decision:** a one-time OTA-capable base APK is acceptable. See `TRUE-OTA-SETUP.md` for the later local `expo-updates` configuration and guarded release automation. It is disabled pending real project identity and device validation; nothing has been built/published/deployed. The source findings below describe the earlier pre-OTA inspection.

## User clarification and constraints

The owner confirmed:
- “OTA” means the existing in-app APK download followed by Android's Install/Update confirmation.
- The main observed problem is **download stuck/failed**.

Do not reinterpret this as a request to migrate to Expo JS OTA. The inspected repository has no configured expo-updates runtime/channel. Do not build, publish, force-update students, deploy, or send messages without explicit permission. Preserve working flows and existing zero-hour changes.

## What was inspected

Pinned client baseline: `c445f1871e0ed23ca8e54a9d3ed53db0e430b288`, restored from the existing repository, not rebuilt. Existing local zero-hour commit: `35d76f6`.

- `mobile/src/context/AppUpdateContext.tsx`
- `mobile/src/components/AppUpdateOverlay.tsx`
- `mobile/app.json`, `mobile/eas.json`, mobile package manifest and lockfile
- The installed, pinned Expo file-system implementation and TypeScript contract
- `api/proxy.js`, `api/sheets.js`, `lib/android-download.js`, `server.js`
- Existing update setup/build/migration documentation and download tests

### Local code findings

1. The installer guard stayed true after a successful return/cancel from the installer, so **Open installer again** could not open it again. Reproduced using the actual callback and mocked Android APIs: two calls, only one launch.
2. Identical progress callbacks reset the stall clock even if no additional bytes arrived.
3. Stalled native downloads were not aborted, although the pinned Expo API supports `AbortSignal`.
4. A final Expo synthetic `size/size` progress callback could overwrite a previously larger advertised total, weakening truncation detection.
5. Progress could show 100% before the native promise and file checks completed.
6. Manual retries could start overlapping update pipelines; phase-dependent callback identity could retrigger the startup checking effect.
7. Exactly zero available storage bypassed the prior low-storage condition.
8. `forceUpdate: true` is hardcoded in the two inspected gateway metadata handlers. This is a lockout risk, not proof that it causes every download failure.

### Public endpoint checks (read-only)

- Public `latest.json`: HTTP 200, version `1.15.2`, version code 46, minimum version code 46; no explicit forceUpdate property returned.
- The gateway's `app.version` action: version `1.15.2`, code 46, minimum 46, **forceUpdate true**.
- GET on `/api/proxy?action=app.version` returned 405, so the same read-only action was inspected using its required POST transport with an empty payload. No student ID, credentials, write action or notification action was sent.
- HEAD on `/download/android` followed redirects and returned HTTP 200 from `release-assets.githubusercontent.com`, APK content type, content length **54,676,349 bytes**, `Accept-Ranges: bytes`.
- HEAD on the manifest APK link returned the same size/type/status.

Only metadata/headers were read. No full APK was downloaded and no real-device download was tested. This proves the endpoint was reachable from the sandbox at the time, not that it works on all student devices/networks. No root cause is asserted for every student's reported failure.

## Implemented locally

- Use the existing Expo API's AbortSignal to cancel stalled native transfers and downloads on provider unmount.
- Watch actual byte increases, not merely callback activity.
- Ignore late callbacks and clean up failed/late partial files without replacing a newer ready APK.
- Preserve the maximum advertised byte total and check exact size equality when a positive total is known.
- Keep in-progress percentage below 100%; show a file-checking message when all reported bytes have arrived. Enter ready only after existing minimum/exact-size checks pass.
- Retry transient stalls with the existing bounded budget: initial attempt plus at most three retries and backoff.
- Ensure one download/retry loop at a time, including rapid Retry taps and concurrent checks.
- Keep autoUpdate callback identity independent of the visual phase to avoid phase changes retriggering startup checks.
- Clear installer guard on both return/cancel and error; preserve the downloaded file for another installer attempt.
- Reject zero-free-space before starting a transfer.
- Change “downloaded and verified” wording to accurately say the file size was checked.

No endpoint URLs, version numbers, dependencies, Android package identity, signing configuration, gateway update policy, or release metadata were changed. All application code changes in this repair are limited to the Android update provider and its UI.

## Tests and limits

`mobile/test/app-update-reliability.test.cjs` executes the real source callbacks after TypeScript transpilation with mocked native APIs, filesystem, timers and network. It covers:
- repeated identical callbacks and silent stalls;
- timeout cancellation and cleanup;
- delayed completion/progress after timeout;
- file finalization and exact-size mismatch (short and oversized);
- healthy slow transfer and unknown total size;
- full storage;
- installer return/cancel, error and double taps;
- bounded retry, retry success, overlapping pipeline guards;
- no further retries after unmount;
- optional policy preserved;
- no phase-dependent startup effect retrigger.

After this repair:
- **24 updater regression tests passed**.
- **59 existing zero-hour regression tests passed**.
- **25 root tests passed**.
- **21 existing web workflow checks passed**.
- Full mobile TypeScript check passed.
- Diff whitespace check passed before commit.

Logs and endpoint audit results are in `/home/user/verification/`.

These are callback/unit regression tests, not a full React lifecycle integration test, device test, release build or production rollout. The dependency-stability assertion is structural; full lifecycle behavior still needs device validation.

Byte-size checks are not cryptographic verification. A transfer without a real Content-Length still has only the minimum-file-size check; this change does not add checksum validation. Retries start a fresh transfer; native byte-range pause/resume has not been implemented. Header support for Range does not establish that the current native downloader resumes.

## Release blockers / next verification

1. Identify an affected installed version/build and reproduce on that phone/network. The inspected repo is not yet proven byte-for-byte identical to the installed APK.
2. Test Wi-Fi and mobile data, dropped connection, no-progress callbacks, foreground/background, finalization delay, low storage, Retry, permission-denied/cancel/reopen installer and successful upgrade without losing login/data.
3. Verify release APK package ID, increasing versionCode and signing certificate continuity before any install test. Do not tell students to uninstall as a workaround.
4. Validate the full release download, size and checksum through its real URL, including slow networks and retries. The HEAD check alone is insufficient.
5. Separately agree on release policy: optional rollout vs required minimum version. Do not silently flip live forceUpdate or minimumVersionCode. The current gateway can still block older clients.
6. If repair requires new native client code, it will only reach installed clients through a tested APK release using the existing in-app update mechanism. This local source patch cannot alter an APK already on a phone. Do not publish it yet.
7. If true JS OTA is desired later, treat that as a separate migration with its own compatible native baseline and rollout/rollback plan; not as an unannounced fix here.

## Other pending work

The latest 18 Oct mentor backend is still missing. Absent/leave ranking and authoritative zero-hour submitted-day stats remain blocked on the actual current backend bundle/archive. Historical podiums remain untouched. Voice/receipt rubric work remains deferred.
