# True OTA + tested automatic student releases

**Status: locally prepared and tested; NOT activated, built, published or deployed.**

The owner agreed that a one-time base APK update is acceptable so compatible future JavaScript/UI/assets changes can arrive without the student downloading/installing another APK.

## Intended experience

1. Once the tested OTA-capable base APK is installed, Expo Updates checks at app launch and downloads compatible updates in the background.
2. A downloaded update applies on the next normal **cold start**. Merely returning a still-running app to the foreground is not necessarily a cold start.
3. No update/install button, forced mid-session restart, or periodic APK prompt is added for ordinary JS changes. There is deliberately no `reloadAsync()` call that can interrupt a study form, timed test or unsaved activity.
4. The cached/embedded app starts immediately instead of waiting for the network. Expo's anti-bricking measures stay enabled. These mechanisms reduce failure risk; they do not guarantee recovery from every application/data bug.
5. Backend-only changes do not need an APK. Student web changes use normal browser refresh/navigation and the existing network-first app-shell behavior. Native modules, permissions, SDK or runtime changes still require a new native APK.

**This source patch cannot make an already-installed non-OTA APK support OTA.** Existing code-46 APKs need the one-time native baseline. Future APK releases remain separate, explicit operations.

## Implemented locally

### OTA configuration

- Added SDK-57-compatible `expo-updates` (`~57.0.24`, lock resolves to `57.0.26`) without upgrading the existing Expo/React Native versions or unrelated dependencies.
- `mobile/app.config.js` composes the existing `app.json`; identity, package, permissions and version remain unchanged by default.
- Default: `updates.enabled=false`. Enabling requires `UPM_OTA_ENABLED=1`, the **real** `EAS_PROJECT_ID`, and explicit `UPM_OTA_CHANNEL=preview|production`.
- No project ID or owner was guessed, no EAS project was created, and no account/token was configured.
- Enabled configuration: native fingerprint runtime; ON_LOAD checking; launch wait zero; embedded update enabled; anti-bricking not disabled; explicit EAS channel header.
- Separate `ota-preview` and `ota-production` build profiles. Existing profiles remain non-OTA by default. Preview inherits the existing read-only profile.
- Removed stale `EXPO_PUBLIC_APP_VERSION=1.14.6` entries from EAS profiles so the actual app version is not mislabeled. A conflicting EAS environment override is blocked at release preflight.

### Release checks

- `mobile/tools/ota-preflight.cjs` resolves the native runtime using the installed SDK implementation; it does not build an APK, export or publish JS, or create a project.
- `mobile/ota-baselines.json` deliberately contains **null** preview/production records. Publication stays blocked until the real baseline has been tested and recorded.
- Preflight requires exact project, runtime, gateway, app version, versionCode and backend-mode agreement with the approved baseline; it requires the tested APK checksum, signing-certificate fingerprint and build reference.
- Native-runtime overrides and unreviewed tracked-native workflows are rejected.
- Baseline building needs a new versionCode (minimum 47 based on the inspected current code 46); code/version are not bumped here. Recheck the actual latest release before choosing final version numbers.
- `publish-ota.cjs` also checks the tested commit equals local HEAD and current remote main. No stale commit publication.
- OTA publication never calls Gradle/EAS Build, writes latest.json, changes versionCode, or sends student pushes/messages.

### Automatic release workflow — off until activated

`.github/workflows/student-auto-release.yml` runs only after the existing CI workflow succeeds for a **same-repository main push**, and only when the owner explicitly sets `UPM_AUTO_RELEASE_ENABLED=true`.

It checks out the exact tested SHA, verifies the approved runtime using the actual EAS production environment, deploys/verifies the student web candidate, then publishes compatible Android JS/assets to the production OTA channel. PRs, forks, failing CI and missing identities cannot publish through this workflow.

All existing CI suites remain required; mobile regression tests were added to CI alongside typechecking.

### Student web release protection

`scripts/auto-deploy-student-web.sh` is inert outside explicitly enabled CI. It:

- Only permits the reviewed student target: project `ump-dashboard`, region `asia-south1`, service `student-dashboard`.
- Refuses to deploy the mentor backend (`ujjwal-pathak-app`).
- Uses a no-traffic candidate revision and checks `/api/health`, the app shell and the SHA256 of served `app.js` before promotion.
- Checks source freshness again after Cloud Build.
- Preserves existing environment, secrets, IAM and resource settings; it does not set/update environment variables or enable public access.
- Restores the actual previous traffic split if the post-promotion smoke test fails.
- Leaves candidate tags for operator diagnosis; tag retention/cleanup can be decided during activation.

The old deploy script is NOT called because it contains a legacy MENTOR_API_URL default that is not safe to assume.

**Web and Expo OTA are separate services, not an atomic transaction.** The web stage can succeed before OTA publication fails. Use backward-compatible APIs/data migrations, inspect both release stages, and roll back deliberately if needed. A health check and bundle hash are not a complete UI/integration test.

### Accidental build/deploy paths guarded locally

- Removed the production APK workflow's main-push trigger. It remains manually dispatched with `publish_live=false` by default; an explicit OTA-baseline option runs preflight before prebuild.
- Native build dependencies include dev tools even under NODE_ENV=production so regression/typechecking can actually run.
- The retired Vercel workflow is manual-only and opt-in via `UPM_LEGACY_VERCEL_DEPLOY_ENABLED`.
- This does NOT disable any separate hosting-provider Git integration or externally configured deploy hook. Those must be audited before pushing.
- Temporary WIF credential files and signing keys are excluded from Git, Docker and Cloud Run source uploads.

## Verification performed

- **132 mobile tests passed**, including existing 59 zero-hour and 24 updater tests, 41 OTA/configuration/workflow checks and 8 mocked web-release lifecycle tests.
- **25 root tests** and **21 existing web workflow checks** passed.
- **4 gateway tests** and **38 content-pipeline tests** passed.
- Full mobile TypeScript check passed.
- Workflow YAML parsing and shell syntax checks passed.
- Default Expo config resolves with OTA disabled.
- Disabled publication/preflight fails closed.
- SDK runtime resolution succeeded locally with clearly synthetic test-only project/gateway values. These fixtures were NOT recorded in the baseline ledger and were NOT sent to EAS or used to publish anything.
- Web lifecycle tests run the actual shell script with fake git/gcloud/curl executables. They verify no-traffic failures, stale-source rejection, exact-source checks, promotion and restoration of a prior 60/40 traffic split. No real deployment occurred.

Not verified yet: real Expo ownership, EAS environment contents, real baseline runtime/artifact/signing continuity, native cold-start/background behavior on a device, actual EAS publication, real WIF/IAM permissions, actual Cloud Build/deployment or end-to-end rollback. These are activation prerequisites, not completed checks.

## One-time activation prerequisites

1. **Real Expo project link/ID.** None exists in the inspected source. Use the owner's actual Expo project; if none exists, create/link one with explicit authorization. Do not use test IDs from unit tests.
2. **Secure access setup.** Put EXPO_TOKEN in repository/environment Secrets, not chat or source. Configure actual EAS production/preview environments. Add GCP Workload Identity Federation restricted to this repository/main branch and a least-privileged deploy service account. No account IDs/provider paths have been invented here.
3. **Repository review.** Apply this patch on a normal branch from the real upstream history. This workspace uses local snapshot commits and has no remote; do not force-push it over upstream. Protect main and restrict workflow/Secrets/baseline-ledger changes. Audit and disable unwanted legacy hosting integrations before the first push.
4. **Restore current mentor backend.** `UPM-handover.bundle` / the 18 Oct backend archive is still missing. Fix absent/leave scoring and authoritative zero-hour day counts on that actual source, preserving published podiums. This pipeline only covers the student repo; it does not pretend to deploy the absent backend.
5. **Build ONE new native baseline when approved.** Choose a currently-unused increasing versionCode and suitable app version, keep the existing Android package/signing certificate, use the real project and correct channel, and verify the APK's embedded runtime equals the OTA runtime from the same environment. This has NOT been built now.
6. **Controlled phone tests.** Confirm upgrade without uninstall/data loss, login, proof upload, tracker, test/MCQ state, background download, offline startup, cached fallback, next-cold-start OTA application and rollback on affected Android devices. Test JS-only changes through preview before production. Do not force-reload students mid-session.
7. **Record actual approved baselines.** Populate each ledger channel only with measured projectId, runtimeVersion, gatewayOrigin, native version/code, backendMode, APK SHA256, certificate SHA256, tested build reference, and `deviceValidated:true`. The ledger is a review record, not independent cryptographic proof of device validation.
8. **One-time activation.** Only after approval, configure the `student-production` environment and repository variables, then enable UPM_AUTO_RELEASE_ENABLED. Routine merged/tested compatible updates can then publish automatically; no recurring student install is needed. Native runtime changes fail preflight and require a separately tested baseline.

Required repository/environment configuration (no values embedded):

- Variables: `EAS_PROJECT_ID`, `EXPO_PUBLIC_API_BASE_URL`, `GCP_PROJECT_ID`, `GCP_REGION`, `GCP_WEB_SERVICE`, `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_DEPLOY_SERVICE_ACCOUNT`, `UPM_AUTO_RELEASE_ENABLED`.
- Secret: `EXPO_TOKEN`; existing Android signing secrets remain necessary only for native builds.
- EAS environment: matching OTA project/channel/enabled flag and gateway/backend-mode values; no stale display-version override. Preview must stay separate from production.

For initial validation, keep release flags off. Do not use a fake ID to get past preflight.

## Rollback discipline

- Web smoke-test failure after promotion attempts to restore the saved traffic split; if that fails, the workflow explicitly reports operator intervention needed.
- OTA rollback/republication must target the actual tested project/channel/runtime through Expo's supported rollback mechanism. Validate it in preview before activation; no rollback command has been run here.
- Do not automatically delete user data, uninstall the app, force a binary downgrade or undo published podiums.
- Keep backend/data changes backward-compatible with both the old and new JS versions. OTA error recovery cannot undo irreversible migrations.

## References

- Expo SDK 57 Updates: https://docs.expo.dev/versions/v57.0.0/sdk/updates/
- Runtime compatibility: https://docs.expo.dev/eas-update/runtime-versions/
- Release channels and deployment: https://docs.expo.dev/eas-update/deployment/
- GitHub Actions integration: https://docs.expo.dev/eas-update/github-actions/

Fingerprint runtime policy is intentionally conservative. Its real build/update/environment consistency must be validated on this project before activation; local fixture tests are not a substitute.


## 20 October 2026 build-authorization update

Owner has approved candidate APK build work, not OTA publication or production release. Superseding any earlier opt-in/non-OTA profile instructions: every existing EAS profile now requires UPM_APK_BUILD=1 and UPM_OTA_ENABLED=1 with an explicit channel; the signed workflow always runs baseline preflight and refuses ota_baseline=false. The old unsigned preview workflow is inert/manual-only. Direct Expo prebuild/run:android configuration also rejects disabled OTA. Local non-native inspection/JS export can remain offline; that is not an APK route. Targeted tests45/45 pass. No native build or remote workflow run has occurred.

The real EAS project and original signing credentials are still unverified. Old Drive app.json/eas.json backups do not supply a project ID and must not overwrite the current gateway/version. Do not create a replacement signing key. Verify the original released/installed certificate before producing an upgrade candidate. All broader feature/integration gates in NEXT-APK-MASTER-CHECKLIST.md still apply.


## 21 October candidate and signing reference

Source candidate is1.15.3/code47. Current released46 APK checksum and signature were verified in full; `mobile/released-apk-reference.json` records its public certificate fingerprint. `tools/check-release-identity.cjs` checks the package, increasing versionCode, actual certificate and unchanged public reference; the signed workflow invokes it before native prebuild and after signing. A certificate fingerprint is NOT the private key. Existing Expo ID and original private signing access remain missing/unverified. No new project/link/key, native build, publication or live manifest edit. Older phone variants still require in-place upgrade acceptance. See `/home/user/apk-preparation/HANDOVER.md` for current tests and access steps.
