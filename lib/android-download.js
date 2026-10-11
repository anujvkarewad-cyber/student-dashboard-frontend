const RELEASE_MANIFEST_URL =
  "https://raw.githubusercontent.com/anujvkarewad-cyber/UPM-Android-Releases/main/latest.json";

const RELEASE_BUCKET = "ump-dashboard-android-releases-566076646952";
const RELEASE_PATH_PREFIX = `/${RELEASE_BUCKET}/`;
// Official GitHub release assets for the same releases repo. The APK is only
// published here (the GCS bucket lags / lacks the newest build), so this host
// must be trusted too - otherwise every request silently falls back to a stale
// GCS APK. Pinned to the exact repo path so the endpoint can never become an
// open redirect to an arbitrary github.com file.
const GITHUB_RELEASE_HOST = "github.com";
const GITHUB_RELEASE_PATH_PREFIX = "/anujvkarewad-cyber/UPM-Android-Releases/releases/download/";

const DEFAULT_FALLBACK_URL =
  "https://storage.googleapis.com/ump-dashboard-android-releases-566076646952/releases/v1.14.6/UPM-v1.14.6-41-release.apk";

const MANIFEST_TIMEOUT_MS = 8_000;

export function isAllowedAndroidApkUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.username || url.password) return false;
    if (url.pathname.toLowerCase().endsWith(".apk") !== true) return false;
    const fromGcs =
      url.hostname === "storage.googleapis.com" &&
      url.pathname.startsWith(RELEASE_PATH_PREFIX);
    const fromGithub =
      url.hostname === GITHUB_RELEASE_HOST &&
      url.pathname.startsWith(GITHUB_RELEASE_PATH_PREFIX);
    return fromGcs || fromGithub;
  } catch {
    return false;
  }
}

function safeFallbackUrl() {
  const configured = String(process.env.ANDROID_DOWNLOAD_FALLBACK_URL || "").trim();
  return isAllowedAndroidApkUrl(configured) ? configured : DEFAULT_FALLBACK_URL;
}

/**
 * Resolve the current production APK from latest.json.
 *
 * The cache-busting query parameter matters because raw.githubusercontent.com
 * can briefly serve an earlier manifest generation after a release. Only APKs
 * from UPM's dedicated public GCS release bucket or the official
 * anujvkarewad-cyber/UPM-Android-Releases GitHub release path are accepted, so
 * a malformed or compromised manifest cannot turn this endpoint into an open
 * redirect.
 */
export async function resolveAndroidApkUrl({
  fetchImpl = globalThis.fetch,
  now = Date.now,
  timeoutMs = MANIFEST_TIMEOUT_MS,
} = {}) {
  const fallback = safeFallbackUrl();
  if (typeof fetchImpl !== "function") return { apkUrl: fallback, source: "fallback" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const separator = RELEASE_MANIFEST_URL.includes("?") ? "&" : "?";
    const response = await fetchImpl(`${RELEASE_MANIFEST_URL}${separator}ts=${now()}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache, no-store, max-age=0",
      },
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
    });

    if (!response.ok) throw new Error(`release manifest returned HTTP ${response.status}`);
    const latest = await response.json();
    const versionCode = Number(latest && latest.versionCode);
    const apkUrl = String((latest && latest.apkUrl) || "").trim();

    if (!Number.isInteger(versionCode) || versionCode < 1) {
      throw new Error("release manifest has an invalid versionCode");
    }
    if (!isAllowedAndroidApkUrl(apkUrl)) {
      throw new Error("release manifest has an unapproved APK URL");
    }

    return { apkUrl, source: "manifest", versionCode };
  } catch (error) {
    console.warn("[android-download] using verified fallback:", error && error.message);
    return { apkUrl: fallback, source: "fallback" };
  } finally {
    clearTimeout(timer);
  }
}

const REDIRECT_HOP_TIMEOUT_MS = 8_000;
const MAX_REDIRECT_HOPS = 5;

/**
 * Follow a URL's redirect chain server-side and return the final destination.
 *
 * GitHub release download URLs answer with a 302 whose body is
 * `content-length: 0`, then hop again to a short-lived signed
 * `release-assets.githubusercontent.com` URL that carries the real bytes.
 * Several Android browsers and the platform DownloadManager read that first
 * `content-length: 0`, so the actual 54 MB body never reconciles and the
 * download appears "stuck at 100%" (or finalises as an empty/broken file).
 * Resolving the chain here lets us 302 the browser straight to the final
 * signed URL - a single clean 200 with a correct `content-length` and
 * `accept-ranges: bytes`, which downloads reliably.
 *
 * The signed URL is short-lived, but this runs per request so the browser
 * always receives a freshly-minted one.
 */
export async function resolveRedirectChain(value, { fetchImpl = globalThis.fetch } = {}) {
  let current = String(value || "");
  if (typeof fetchImpl !== "function") return current;
  for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop += 1) {
    let controller;
    let timer;
    try {
      controller = new AbortController();
      timer = setTimeout(() => controller.abort(), REDIRECT_HOP_TIMEOUT_MS);
      const res = await fetchImpl(current, {
        method: "HEAD",
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": "UPM-Android-Download-Redirect/1.0" },
      });
      const status = Number(res && res.status);
      const location = res && res.headers && res.headers.get && res.headers.get("location");
      if (status >= 300 && status < 400 && location) {
        current = new URL(location, current).toString();
        continue;
      }
      return current;
    } catch {
      return current; // resolution failed - hand back the best URL we have
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return current;
}

function isGithubReleaseHost(value) {
  try {
    return new URL(String(value || "")).hostname === GITHUB_RELEASE_HOST;
  } catch {
    return false;
  }
}

export async function handleAndroidDownload(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    const body = "Method not allowed\n";
    res.writeHead(405, {
      Allow: "GET, HEAD",
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(req.method === "HEAD" ? undefined : body);
    return;
  }

  const release = await resolveAndroidApkUrl();
  // GitHub release URLs need their redirect chain resolved server-side so the
  // browser lands on a single clean 200 with a real content-length. GCS URLs
  // are already direct, so skip the extra hop for them.
  const location = isGithubReleaseHost(release.apkUrl)
    ? await resolveRedirectChain(release.apkUrl)
    : release.apkUrl;
  const body = `Downloading the latest UPM Android app:\n${location}\n`;
  res.writeHead(302, {
    Location: location,
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-cache, no-store, max-age=0, must-revalidate",
    Pragma: "no-cache",
    Expires: "0",
    "X-Content-Type-Options": "nosniff",
    "X-UPM-Download-Source": release.source,
  });
  res.end(req.method === "HEAD" ? undefined : body);
}

export const androidDownloadConfig = Object.freeze({
  manifestUrl: RELEASE_MANIFEST_URL,
  fallbackUrl: DEFAULT_FALLBACK_URL,
  releaseBucket: RELEASE_BUCKET,
});
