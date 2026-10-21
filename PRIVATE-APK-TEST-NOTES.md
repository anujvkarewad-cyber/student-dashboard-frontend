# Private owner-test candidate — not a student release

Version1.15.4/code48, original Android package and verified release46 signing identity.
Install as an update; do NOT uninstall or clear app data. If Android rejects the update, stop and report the message—older Expo-signed variants may have a different certificate.

True OTA native configuration points to the existing @anujkarewad/ujjwal-pathak-mentorship project. No OTA update has been published, no channel mapping changed, and no device-validated baseline has been approved. Phone cold-start/offline/rollback acceptance is pending.

This is a PERSONAL TEST candidate, not confirmation that every agreed feature is finished. Production backend/web code has NOT been deployed. Backend-dependent changes (including exclusive Group1/Group2/Both mentor-test targeting, new Daily Full10 issuance/scoring/auth and workbook/receipt services) cannot be fully exercised against the unchanged production server. Official issuance/scoring rollout remains unarmed. Existing student data and published podiums were not changed.

Do not share with students or publish until remaining integration/feature gates and owner acceptance are complete. Artifact evidence contains the actual APK checksum, certificate, package and compiled OTA runtime. A successful native build is not production or real-device acceptance.

## Recorder correction in this candidate
Separate Start/Stop buttons and visible recording/permission/preparing/error states. After the first microphone permission grant, the app asks for a fresh Start tap; it does not auto-record. Native start is checked, failed/empty clips are rejected, and cancellation/background cannot start delayed recording. Existing clip limits and privacy are retained.

Phone acceptance: grant microphone if requested → Start → speak for 5–10 seconds → verify running timer → Stop → Replay and hear your voice → explicitly Save → close/reopen the private library. Also test Cancel/background deletion of unsaved clips and preservation of existing account/receipt data. A failure must be reported with the displayed error; no uninstall/data-clear workaround.

## OTA/runtime gate
The previous code47 artifact had different clean-source and compiled runtime fingerprints. Its hashes are historical, not this candidate's values. This new build captures the preflight runtime and must compare it with the actual packaged fingerprint; mismatches fail candidate verification and are retained only as NOT-FOR-INSTALL diagnostics. Do not force a hash, ignore native source, approve a baseline or publish OTA to pass this gate. Device OTA delivery/rollback remains unverified even if runtime equality passes.
