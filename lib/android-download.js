const RELEASE_MANIFEST_URL =
  "https://raw.githubusercontent.com/anujvkarewad-cyber/UPM-Android-Releases/main/latest.json";

const RELEASE_BUCKET = "ump-dashboard-android-releases-566076646952";
const RELEASE_PATH_PREFIX = `/${RELEASE_BUCKET}/`;

const DEFAULT_FALLBACK_URL =
  "https://storage.googleapis.com/ump-dashboard-android-releases-566076646952/releases/v1.14.6/UPM-v1.14.6-41-release.apk";

const MANIFEST_TIMEOUT_MS = 8_000;

export function isAllowedAndroidApkUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return (
      url.protocol === "https:" &&
      url.hostname === "storage.googleapis.com" &&
      url.pathname.startsWith(RELEASE_PATH_PREFIX) &&
      url.pathname.toLowerCase().endsWith(".apk") &&
      !url.username &&
      !url.password
    );
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
 * in UPM's dedicated public GCS release bucket are accepted, so a malformed or
 * compromised manifest cannot turn this endpoint into an open redirect.
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
  const body = `Downloading the latest UPM Android app:\n${release.apkUrl}\n`;
  res.writeHead(302, {
    Location: release.apkUrl,
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
