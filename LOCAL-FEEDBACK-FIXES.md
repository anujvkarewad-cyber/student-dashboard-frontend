# Student feedback fixes — local-only work, 18 Oct 2026

**Subsequent work:** see `UPDATE-RELIABILITY.md` for the owner's confirmed in-app APK update complaint, read-only release endpoint checks, and local updater repairs. The results below describe the zero-hour implementation checkpoint; the updater report contains the newer cumulative test counts. Neither checkpoint has been released.

## Scope and source provenance

This working directory is restored from the existing GitHub source, not rebuilt from the handover.

- Upstream repository: `anujvkarewad-cyber/student-dashboard-frontend`
- Pinned upstream commit: `c445f1871e0ed23ca8e54a9d3ed53db0e430b288` (14 Oct 2026).
- Source was obtained as a GitHub archive at that exact commit.
- Local Git baseline: `e80353c` (`chore: local snapshot ...`). This is a newly created **local snapshot commit**, NOT the original upstream history.
- There is no configured Git remote. No branch, commit, PR, release, or workflow was written to GitHub.
- Matching this upstream snapshot to the currently installed APK / running student web service has NOT been verified.

## Implemented locally

### Explicit honest zero-hour submission: Android and web

- Added **Aaj padhai nahi hui (0 hrs)** shortcut.
- Shortcut sets hours to 0 and selects the existing **No / reason** flow.
- Native shortcut clears hidden subjects, target, tomorrow target, and proof.
- Web shortcut dispatches the existing planned-choice change event, reusing the existing visibility / chip / hidden-field reset logic.
- Numeric zero is allowed; blank is not silently converted to a submission.
- Decimal hours, including comma decimal normalization, are supported.
- Negative, non-finite, malformed, hexadecimal/exponent notation, and values above 24 are rejected.
- Zero hours requires the no-study flow and a reason. The existing Other reason requires a nonblank explanation.
- Positive-study Yes/Maybe validation and proof requirements remain in place.
- No-study submissions do not read or upload stale study proof.
- Payload uses the existing `addStudyLog` action and numeric `hours: 0`. No attendance marking or leave request is created.
- No hours are padded or fabricated.

### Relevant code

- `mobile/src/screens/AddStudyLogScreen.tsx`: validation, zero shortcut, no-study proof guard, normalized payload hours.
- `app.js`: zero shortcut, validation, no-study proof guard.
- `index.html`: zero shortcut and explanatory text.
- `mobile/test/study-log-zero-hours.test.cjs`: regression coverage.
- `test/proxy-study-log.test.mjs`: zero-hour forwarding contract.
- `mobile/package.json`: added a test script only; version and dependency versions unchanged.

## Verification

Baseline before code changes:

- Root suite: 24 tests passed.
- Existing web workflow suite: 21 checks passed.
- Mobile TypeScript check: passed.
- New zero-hour regression suite against the original source: 36 passed / 23 failed, demonstrating the missing behavior.

After code changes:

- Root suite: **25 passed / 0 failed**.
- Existing web workflow suite: **21 checks passed**.
- Zero-hour client regression suite: **59 passed / 0 failed**.
- Mobile TypeScript check: **passed**.
- `node --check app.js`: passed.
- `git diff --check`: passed before commit.

Tests use the actual native screen transpiled to JavaScript with inert React/native/service mocks, and actual browser event callbacks extracted using the TypeScript AST and run in a VM. The proxy test uses a mocked fetch. Tests never contact production, upload files, send pushes, or submit a real student's data.

These are not real-device or full browser rendering tests. There has been no installed-APK, live web-service, or live backend end-to-end verification. The existing web workflow checks were rerun as regression checks only; no voice/receipt rubric work was performed.

Re-run without building an APK:

```bash
cd /home/user/student-app
npm test
cd mobile
npm ci --ignore-scripts --no-audit --no-fund  # only if dependencies are absent
npm test
npm run typecheck
```

Dependency directories are not persisted by workspace snapshots. Do not run `validate`, Expo export, Gradle, EAS, or deploy scripts as part of this local validation.

## Critical blockers — NOT fixed yet

### Current backend missing

The available backend repository (`anujvkarewad-cyber/ujjwal-pathak-project`) is an older reference only:

- Main commit: `5ded88f9ccc79df0236f2adda393b361433a38f2`, 10 Oct 2026.
- All 19 visible branch heads were checked.
- None of those branch trees contains `backend/routers/attendance.py`, `backend/group_bucket.py`, `backend/week_window.py`, or `frontend/src/utils/weeklyPoster.js` from the 18 Oct handover.
- Handover commits `3b3c69ac` and `f621579` could not be resolved through the repository API.
- Reference archive is in `/home/user/github-inspection/backend-reference`, NOT `/home/user/backend`.
- Reference backend source was NOT edited, imported, executed, or deployed.

Obtain `UPM-handover.bundle` (handover describes approximately 4.1 MB, SHA256 prefix `6fde1089505bdf4c`, HEAD `3b3c69ac`) or the existing 18 Oct workspace archive including any uncommitted changes. Verify actual contents; do not trust the expected hash blindly. Do not recreate missing backend features from documentation.

### Server-side zero-day stats

The older reference code contains zero-hour filters in both personal stats and weekly reporting; it also drops entire zero-total weeks. This client patch does NOT fix those server responses.

Web optimistic state already increments entries for a successful zero-hour submission without increasing hours. The later server refresh is authoritative and can still return incorrect counts until the current backend is fixed. Native refreshes server stats immediately. Do not fake client-side counts to conceal that problem.

On the current backend, verify valid zero-day preservation, invalid/missing-hours handling, unique-day versus row counting, duplicate/imported-row deduplication, latest submission date, all-zero weeks, and existing total-hours behavior.

### Absent/leave ranking

NOT implemented. Obtain and inspect the current attendance index, ranking inputs, scoring denominators, ranking eligibility, period boundaries and callers, reminder/rank-drop paths, and stored historical reports first.

Proposed tests: absent and leave excluded only within the eligible enrollment/window; overlapping excuse records deduplicated; submissions and excuses cannot produce attendance above 100%; all-excused / no-eligible-day handling; genuine unexcused missing submissions still count as missed; zero-hour valid submission counts; group membership and board invariants unchanged.

Do not invent study hours or silently change the hours/MCQ scoring policy while correcting attendance.

## Published podium protection and release gate

- No ranking, podium, report, or production record has been changed.
- Before backend changes, identify already-published weeks and inspect their existing immutable result / snapshot storage.
- Preserve previously published winners, places, and scores; do not reconstruct them by reranking with new logic or changed data.
- Define and confirm an explicit scoring effective week/version for the next eligible closed week. A formula cutoff alone is not enough if historical results still recompute from mutable source data.
- Add tests that published podium output is identical before and after the fix.
- Keep Sunday–Saturday windows, group buckets, and existing batch-board behavior intact.
- Preserve the handover's weekly-report hold; do not arm the scheduler.
- Do not release this client change as an end-to-end fix until current backend changes and matching integration tests pass.

## Deferred / prohibited actions

Voice-note input and receipt-marking rubric inspection remain deferred.

No new APK, app bundle, Expo export, release version bump, production deployment, environment change, database write, student push/message, GitHub push, or CI trigger was performed. Each release/production action requires the owner's explicit permission.

The shared GitHub access token was used only in memory for read-only GitHub requests; it was not stored in the project, archive, Git config, or test logs. The owner should revoke/rotate the token because it was shared in chat.
