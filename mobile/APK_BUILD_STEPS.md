# Phone preview: safe APK build

Arena's GitHub App can push ordinary source files, but GitHub blocks it from creating workflow files. The repository owner only needs to copy one prepared file into GitHub's workflow directory.

## Add the workflow on GitHub

1. Open: <https://github.com/anujvkarewad-cyber/student-dashboard-frontend>
2. From the branch dropdown, select:
   `arena/01a0012a-student-dashboard-frontend`
3. Open `mobile/APK_BUILD_WORKFLOW.yml` and use the **Copy raw file** button to copy its complete contents.
4. Choose **Add file → Create new file**.
5. In the filename field, enter exactly:
   `.github/workflows/mobile-preview-apk.yml`
6. Paste the copied workflow content.
7. Click **Commit changes** and confirm that the commit is going directly to `arena/01a0012a-student-dashboard-frontend` — not `main`.
8. Return to Arena and send: `workflow file add ho gayi`.

No password, access token, OTP, keystore or other credential needs to be shared in chat.

## What happens next

GitHub Actions will build a standalone Android APK using safe mock mode:

- `EXPO_PUBLIC_USE_MOCKS=true`
- No calls to the mentorship backend
- No changes to Apps Script or Google Sheets
- Demo login: `UMP2407` / `demo123`
- Demo OTP: `123456`

After the build succeeds, open the repository's **Actions** tab, select **Build safe mobile preview APK**, open the latest run, and download the artifact named **UPM-safe-preview-APK**. Extract the downloaded ZIP to get `UPM-safe-preview.apk`.

On Android, allow installation from the browser/file manager when prompted. Because this is a private preview APK rather than a Play Store release, Android may show an unknown-source or Play Protect confirmation.
