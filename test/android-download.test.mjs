import assert from "node:assert/strict";
import test from "node:test";

import {
  androidDownloadConfig,
  isAllowedAndroidApkUrl,
  resolveAndroidApkUrl,
  resolveRedirectChain,
} from "../lib/android-download.js";

const RELEASE_URL =
  "https://storage.googleapis.com/ump-dashboard-android-releases-566076646952/releases/v1.15.0/UPM-v1.15.0-42-release.apk";
const GITHUB_APK_URL =
  "https://github.com/anujvkarewad-cyber/UPM-Android-Releases/releases/download/v1.15.0-44/UPM-v1.15.0-44-release.apk";

test("accepts GCS-bucket APKs and rejects other hosts/paths", () => {
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

test("accepts the official GitHub release APK and rejects look-alikes", () => {
  assert.equal(isAllowedAndroidApkUrl(GITHUB_APK_URL), true);
  // Wrong repo path on github.com must not be trusted.
  assert.equal(
    isAllowedAndroidApkUrl(
      "https://github.com/some-other-user/UPM-Android-Releases/releases/download/v1/x.apk",
    ),
    false,
  );
  // Non-.apk asset on the correct path is rejected.
  assert.equal(
    isAllowedAndroidApkUrl(
      "https://github.com/anujvkarewad-cyber/UPM-Android-Releases/releases/download/v1/notes.txt",
    ),
    false,
  );
  // A github URL outside the releases/download path is rejected.
  assert.equal(
    isAllowedAndroidApkUrl("https://github.com/anujvkarewad-cyber/UPM-Android-Releases/raw/main/x.apk"),
    false,
  );
});

test("resolves the latest GitHub release APK from the manifest", async () => {
  const result = await resolveAndroidApkUrl({
    now: () => 555,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({ version: "1.15.0", versionCode: 44, apkUrl: GITHUB_APK_URL }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
  });
  assert.deepEqual(result, { apkUrl: GITHUB_APK_URL, source: "manifest", versionCode: 44 });
});

test("resolveRedirectChain follows GitHub's 302 to the final signed asset URL", async () => {
  const SIGNED =
    "https://release-assets.githubusercontent.com/github-production-release-asset/133/abc?sig=xyz";
  const seen = [];
  const finalUrl = await resolveRedirectChain(GITHUB_APK_URL, {
    fetchImpl: async (url, init) => {
      seen.push({ url, method: init && init.method, redirect: init && init.redirect });
      if (url === GITHUB_APK_URL) {
        return new Response(null, { status: 302, headers: { location: SIGNED } });
      }
      return new Response(null, {
        status: 200,
        headers: { "content-length": "54630381", "accept-ranges": "bytes" },
      });
    },
  });
  assert.equal(finalUrl, SIGNED);
  // Must probe with HEAD + manual redirect so we can read the Location.
  assert.equal(seen[0].method, "HEAD");
  assert.equal(seen[0].redirect, "manual");
});

test("resolveRedirectChain returns the URL unchanged when there is no redirect", async () => {
  const finalUrl = await resolveRedirectChain(RELEASE_URL, {
    fetchImpl: async () =>
      new Response(null, { status: 200, headers: { "content-length": "100" } }),
  });
  assert.equal(finalUrl, RELEASE_URL);
});

test("resolveRedirectChain gives up gracefully and keeps the last good URL", async () => {
  const finalUrl = await resolveRedirectChain(GITHUB_APK_URL, {
    fetchImpl: async () => {
      throw new Error("network down");
    },
  });
  // On failure we still hand back the canonical github URL (browser can follow it).
  assert.equal(finalUrl, GITHUB_APK_URL);
});
