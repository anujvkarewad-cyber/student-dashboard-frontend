import assert from "node:assert/strict";
import test from "node:test";

import {
  androidDownloadConfig,
  isAllowedAndroidApkUrl,
  resolveAndroidApkUrl,
} from "../lib/android-download.js";

const RELEASE_URL =
  "https://storage.googleapis.com/ump-dashboard-android-releases-566076646952/releases/v1.15.0/UPM-v1.15.0-42-release.apk";

test("accepts APKs only from the dedicated UPM GCS release bucket", () => {
  assert.equal(isAllowedAndroidApkUrl(RELEASE_URL), true);
  assert.equal(
    isAllowedAndroidApkUrl(
      "https://storage.googleapis.com/another-bucket/releases/fake.apk",
    ),
    false,
  );
  assert.equal(isAllowedAndroidApkUrl("https://example.com/fake.apk"), false);
  assert.equal(
    isAllowedAndroidApkUrl(
      "https://storage.googleapis.com/ump-dashboard-android-releases-566076646952/releases/not-an-apk.txt",
    ),
    false,
  );
});

test("resolves the latest approved APK with a cache-busting manifest request", async () => {
  let requestedUrl = "";
  let requestedInit;
  const result = await resolveAndroidApkUrl({
    now: () => 123456789,
    fetchImpl: async (url, init) => {
      requestedUrl = url;
      requestedInit = init;
      return new Response(JSON.stringify({
        version: "1.15.0",
        versionCode: 42,
        apkUrl: RELEASE_URL,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });

  assert.equal(requestedUrl, `${androidDownloadConfig.manifestUrl}?ts=123456789`);
  assert.equal(requestedInit.cache, "no-store");
  assert.equal(requestedInit.headers["Cache-Control"], "no-cache, no-store, max-age=0");
  assert.deepEqual(result, {
    apkUrl: RELEASE_URL,
    source: "manifest",
    versionCode: 42,
  });
});

test("rejects an unapproved manifest redirect and uses the verified fallback", async () => {
  const result = await resolveAndroidApkUrl({
    fetchImpl: async () => new Response(JSON.stringify({
      versionCode: 999,
      apkUrl: "https://malicious.example/fake.apk",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  });

  assert.deepEqual(result, {
    apkUrl: androidDownloadConfig.fallbackUrl,
    source: "fallback",
  });
});

test("uses the verified fallback when the manifest is unavailable", async () => {
  const result = await resolveAndroidApkUrl({
    fetchImpl: async () => {
      throw new Error("network unavailable");
    },
  });

  assert.deepEqual(result, {
    apkUrl: androidDownloadConfig.fallbackUrl,
    source: "fallback",
  });
});
