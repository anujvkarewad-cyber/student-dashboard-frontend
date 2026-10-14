import assert from "node:assert/strict";
import test from "node:test";

import { Writable } from "node:stream";

import {
  androidDownloadConfig,
  apkFilenameFromUrl,
  isAllowedAndroidApkUrl,
  resolveAndroidApkUrl,
  resolveAndroidApkDownloadUrl,
  resolveRedirectChain,
  streamAndroidApk,
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

test("resolveAndroidApkDownloadUrl resolves github once (cached) and passes GCS through", async () => {
  const SIGNED = "https://release-assets.githubusercontent.com/github-production-release-asset/133/abc?sig=cached";
  let heads = 0;
  const fetchImpl = async (url) => {
    heads += 1;
    if (url === GITHUB_APK_URL) {
      return new Response(null, { status: 302, headers: { location: SIGNED } });
    }
    return new Response(null, { status: 200, headers: { "content-length": "1" } });
  };
  const first = await resolveAndroidApkDownloadUrl(GITHUB_APK_URL, { fetchImpl });
  const headsAfterFirst = heads; // one HEAD per hop (github 302 -> signed 200)
  const second = await resolveAndroidApkDownloadUrl(GITHUB_APK_URL, { fetchImpl });
  assert.equal(first, SIGNED);
  assert.equal(second, SIGNED);
  assert.equal(heads, headsAfterFirst); // second call served from the TTL cache
  const gcs = await resolveAndroidApkDownloadUrl(RELEASE_URL, { fetchImpl });
  assert.equal(gcs, RELEASE_URL);
  assert.equal(heads, headsAfterFirst); // GCS URLs are already direct - no extra hop
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

// --- stable in-app update delivery (14-Oct-2026) -----------------------------
//
// Students were getting stuck on the blocking update modal because the gateway
// handed the app a release-assets signed URL that expired after ~1h while the app
// kept retrying it. /download/android now streams the bytes from our own origin.

function mockRes() {
  const chunks = [];
  const res = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  res.chunks = chunks;
  res.statusCode = null;
  res.headers = null;
  res.writeHead = (status, headers) => {
    res.statusCode = status;
    res.headers = headers || {};
    return res;
  };
  return res;
}

const APK_BODY = "APK-BYTES-0123456789";

function apkResponse(status = 200, extraHeaders = {}) {
  return new Response(APK_BODY, {
    status,
    headers: {
      "content-length": String(APK_BODY.length),
      "content-type": "application/octet-stream",
      ...extraHeaders,
    },
  });
}

function apkFetch({ apkStatus = 200, apkHeaders = {}, onUpstream } = {}) {
  return async (url, init) => {
    if (String(url).startsWith("https://raw.githubusercontent.com/")) {
      return new Response(
        JSON.stringify({
          version: "1.15.1",
          versionCode: 45,
          apkUrl:
            "https://github.com/anujvkarewad-cyber/UPM-Android-Releases/releases/download/v1.15.1-45/UPM-v1.15.1-45-release.apk",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (onUpstream) onUpstream(url, init);
    return apkResponse(apkStatus, apkHeaders);
  };
}

test("apkFilenameFromUrl keeps the release asset name and never leaks a path", () => {
  assert.equal(
    apkFilenameFromUrl(
      "https://github.com/anujvkarewad-cyber/UPM-Android-Releases/releases/download/v1.15.1-45/UPM-v1.15.1-45-release.apk",
    ),
    "UPM-v1.15.1-45-release.apk",
  );
  assert.equal(apkFilenameFromUrl("not a url"), "UPM-release.apk");
});

test("streamAndroidApk pipes the APK with real headers instead of redirecting", async () => {
  const res = mockRes();
  await streamAndroidApk({ method: "GET", headers: {} }, res, {
    fetchImpl: apkFetch(),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Content-Type"], "application/vnd.android.package-archive");
  assert.equal(res.headers["Content-Length"], String(APK_BODY.length));
  assert.equal(res.headers["Accept-Ranges"], "bytes");
  assert.equal(res.headers["Cache-Control"], "no-store, no-cache, must-revalidate");
  assert.match(
    res.headers["Content-Disposition"],
    /^attachment; filename="UPM-v[\d.]+-\d+-release\.apk"$/,
  );
  assert.equal(Buffer.concat(res.chunks).toString(), APK_BODY);
});

test("streamAndroidApk forwards a Range request (206 + Content-Range)", async () => {
  const res = mockRes();
  let sentRange = "";
  await streamAndroidApk({ method: "GET", headers: { range: "bytes=0-9" } }, res, {
    fetchImpl: apkFetch({
      apkStatus: 206,
      apkHeaders: { "content-range": "bytes 0-9/21" },
      onUpstream: (_url, init) => {
        sentRange = init.headers.range;
      },
    }),
  });
  assert.equal(sentRange, "bytes=0-9");
  assert.equal(res.statusCode, 206);
  assert.equal(res.headers["Content-Range"], "bytes 0-9/21");
});

test("streamAndroidApk answers HEAD without a body", async () => {
  const res = mockRes();
  await streamAndroidApk({ method: "HEAD", headers: {} }, res, { fetchImpl: apkFetch() });
  assert.equal(res.statusCode, 200);
  assert.equal(res.chunks.length, 0);
});

test("streamAndroidApk redirects instead of truncating above Cloud Run's 32 MiB cap", async () => {
  const res = mockRes();
  await streamAndroidApk({ method: "GET", headers: {} }, res, {
    fetchImpl: apkFetch({ apkHeaders: { "content-length": String(40 * 1024 * 1024) } }),
  });
  assert.equal(res.statusCode, 302);
  assert.match(res.headers.Location, /UPM-v[\d.]+-\d+-release\.apk$/);
  // the body is the tiny "Downloading…" hint, never (a truncated slice of) the APK
  assert.match(Buffer.concat(res.chunks).toString(), /^Downloading the latest UPM Android app:/);
  assert.doesNotMatch(Buffer.concat(res.chunks).toString(), /APK-BYTES/);
});

test("streamAndroidApk still streams small assets (under the cap)", async () => {
  const res = mockRes();
  await streamAndroidApk({ method: "GET", headers: {} }, res, { fetchImpl: apkFetch() });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Content-Length"], String(APK_BODY.length));
});

test("streamAndroidApk falls back to the canonical release URL when the upstream fails", async () => {
  const res = mockRes();
  await streamAndroidApk({ method: "GET", headers: {} }, res, {
    fetchImpl: apkFetch({ apkStatus: 500 }),
  });
  assert.equal(res.statusCode, 302);
  assert.match(
    res.headers.Location,
    /^https:\/\/github\.com\/anujvkarewad-cyber\/UPM-Android-Releases\/releases\/download\//,
  );
  // Still no expiry in that URL - it is the canonical github.com release path.
  assert.equal(/[?&]se=/.test(res.headers.Location), false);
});

test("streamAndroidApk rejects an unapproved upstream and other methods", async () => {
  const bad = mockRes();
  await streamAndroidApk({ method: "GET", headers: {} }, bad, {
    resolveRelease: async () => ({ apkUrl: "https://evil.example/fake.apk", source: "manifest" }),
    fetchImpl: apkFetch(),
  });
  assert.equal(bad.statusCode, 503);

  const post = mockRes();
  await streamAndroidApk({ method: "POST", headers: {} }, post, { fetchImpl: apkFetch() });
  assert.equal(post.statusCode, 405);
});
