# Full Live Signed APK — Existing Update Channel Publish Steps

Note: The sandbox environment does not have Java or Android SDK installed, so the APK could not be fully built here. Follow these exact steps on a machine with Android SDK + signing keystore.

## Prerequisites (local or CI)
- Node.js 22+
- Java 17 (Temurin) installed and `JAVA_HOME` set
- Android SDK with build-tools 36.0.0 and platforms android-36
- A valid Android signing keystore (`.jks`) for your package `com.ujjwalpathak.mentorship`

## Step 1: Generate Android project (live mode, not mock)
```bash
cd mobile
export EXPO_PUBLIC_USE_MOCKS=false
export NODE_ENV=production
npx expo prebuild --platform android --clean --no-install
```

This creates `mobile/android/` with the full native project.

## Step 2: Configure signing (if not already configured)
In `mobile/android/app/build.gradle` (or `gradlew.properties`):

```gradle
android {
    signingConfigs {
        release {
            storeFile file("/path/to/your/ump-release-key.jks")
            storePassword System.getenv("STORE_PASSWORD")
            keyAlias System.getenv("KEY_ALIAS")
            keyPassword System.getenv("KEY_PASSWORD")
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
    }
}
```

## Step 3: Set environment variables for build
```bash
export STORE_PASSWORD="your_keystore_password"
export KEY_ALIAS="ump-release"
export KEY_PASSWORD="your_key_password"
```

## Step 4: Build the release APK
```bash
cd mobile/android
chmod +x gradlew
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a --no-daemon
```

The signed APK will be at:
```
mobile/android/app/build/outputs/apk/release/app-release.apk
```

## Step 5: Rename and verify version
```bash
cp app/build/outputs/apk/release/app-release.apk UPM-v1.10.1-15-release.apk
unzip -p UPM-v1.10.1-15-release.apk AndroidManifest.xml | grep -o 'android:versionName="[^"]*"'
unzip -p UPM-v1.10.1-15-release.apk AndroidManifest.xml | grep -o 'android:versionCode="[^"]*"'
```
Expected:
- `versionName="1.10.1"`
- `versionCode="15"`

## Step 6: Publish to existing update channel
The existing update channel is the `AppUpdateProvider` backend (`api/getAppRelease`).

Option A — Direct upload to your server:
- Upload `UPM-v1.10.1-15-release.apk` to your update server URL (e.g., `https://your-server.com/updates/UPM-v1.10.1-15-release.apk`).
- Update the backend database/spreadsheet that feeds `api/getAppRelease` with:
  - `version`: `1.10.1`
  - `versionCode`: `15`
  - `apkUrl`: the direct download URL
  - `forceUpdate`: `false` (optional)
  - `minimumVersionCode`: `14` (optional, to ensure older versions see the update)

Option B — Update the spreadsheet directly:
If your backend reads from a Google Sheet named `AppReleases` (or similar):
- Open the sheet.
- Add/update the row with:
  - `version`: `1.10.1`
  - `versionCode`: `15`
  - `apkUrl`: `https://your-cdn.com/UPM-v1.10.1-15-release.apk`
  - `releaseNotes`: `Notification improvements, persistent clear all, weekly report guard`

After updating the backend data, open the app on an Android device with `backendMode: 'live'`. It should detect the new version within 6 hours (or immediately when `AppState` changes to active) and show the update modal.

## Step 7: Verify on device
1. Install the APK (`adb install` or download from the server).
2. Open the app.
3. Go to Profile → Should see `Installed: v1.10.1` and `New: v1.10.1` (if same version, it won't show; if you set `versionCode` higher, it will prompt).
4. Check that notifications work via Profile → Enable Notifications → Should show "✅ Enabled on this device".
