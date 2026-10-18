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
// A mass update means ~200 students hitting this route within minutes. The manifest
// is tiny but raw.githubusercontent rate-limits, so cache the successful read for a
// minute. Only the real (global) fetch is cached - tests that inject a fetch keep
// their existing cold-cache behaviour.
const MANIFEST_CACHE_TTL_MS = 60 * 1000;
let manifestCache = { apkUrl: "", source: "", versionCode: 0, at: 0 };

export async function resolveAndroidApkUrl({
  fetchImpl = globalThis.fetch,
  now = Date.now,
  timeoutMs = MANIFEST_TIMEOUT_MS,
} = {}) {
  const fallback = safeFallbackUrl();
  if (typeof fetchImpl !== "function") return { apkUrl: fallback, source: "fallback" };

  const cacheable = fetchImpl === globalThis.fetch;
  if (cacheable && manifestCache.apkUrl && now() - manifestCache.at < MANIFEST_CACHE_TTL_MS) {
    const { apkUrl, source, versionCode } = manifestCache;
    return source === "manifest" ? { apkUrl, source, versionCode } : { apkUrl, source };
  }

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

    if (cacheable) manifestCache = { apkUrl, source: "manifest", versionCode, at: now() };
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

// The in-app updater (incl. the older v1.14.6 force-update modal) and the email
// link both stall on GitHub's double-redirect (first hop is content-length:0).
// Handing clients the resolved, single-hop signed URL lets any downloader finish.
// Signed URLs live ~1h, so a short cache bounds GitHub HEAD requests (unauthenticated
// rate limit) while staying fresh; on any resolution failure we fall back to the
// canonical github URL, which is the previous (working-in-browsers) behaviour.
const RESOLVED_CACHE_TTL_MS = 10 * 60 * 1000;
let resolvedCache = { input: "", output: "", at: 0 };

export async function resolveAndroidApkDownloadUrl(value, opts) {
  const input = String(value || "");
  if (!isGithubReleaseHost(input)) return input;
  const now = Date.now();
  if (
    resolvedCache.input === input &&
    resolvedCache.output &&
    now - resolvedCache.at < RESOLVED_CACHE_TTL_MS
  ) {
    return resolvedCache.output;
  }
  const output = await resolveRedirectChain(input, opts);
  resolvedCache = { input, output, at: now };
  return output;
}

const UPSTREAM_HEAD_TIMEOUT_MS = 15_000;

// Cloud Run refuses any single HTTP response above 32 MiB
// ("HTTP response was too large: 33555403. The limit is: 33554432.") and fails the
// request with a 500 instead of truncating - so a ~52 MB APK can never be piped
// through this service. Anything bigger than the cap is answered with a fresh 302
// to the release asset instead (GitHub's CDN, which also supports Range/resume).
const MAX_INLINE_RESPONSE_BYTES = 33_554_432;

/** The APK filename to advertise in Content-Disposition. */
export function apkFilenameFromUrl(value) {
  try {
    const last = new URL(String(value || "")).pathname.split("/").filter(Boolean).pop() || "";
    return /^[\w.+-]+\.apk$/i.test(last) ? last : "UPM-release.apk";
  } catch {
    return "UPM-release.apk";
  }
}

function sendRedirectToApk(res, location, source, status = 302) {
  const body = `Downloading the latest UPM Android app:\n${location}\n`;
  res.writeHead(status, {
    Location: location,
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-cache, no-store, max-age=0, must-revalidate",
    Pragma: "no-cache",
    Expires: "0",
    "X-Content-Type-Options": "nosniff",
    "X-UPM-Download-Source": source,
  });
  res.end(body);
}

function sendSimpleJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

/**
 * Stream the current APK through THIS origin.
 *
 * Why not just redirect (see handleAndroidDownload)? Because the gateway used to hand
 * the app a *resolved* release-assets.githubusercontent.com URL that expires after ~1h.
 * The app keeps the release object for the whole session and reuses it on every Retry,
 * so any student who started the download late - or whose download needed a second
 * attempt - was left staring at a blocking force-update modal, retrying a dead URL.
 *
 * This endpoint's URL never expires and never redirects: the bytes are piped from the
 * GitHub/GCS release asset (a datacenter-to-datacenter fetch), so the phone only has to
 * talk to the same origin it already uses for /api/proxy.
 */
export async function streamAndroidApk(req, res, opts = {}) {
  const {
    fetchImpl = globalThis.fetch,
    resolveRelease = () => resolveAndroidApkUrl({ fetchImpl: globalThis.fetch }),
  } = opts;

  if (req.method !== "GET" && req.method !== "HEAD") {
    sendSimpleJson(res, 405, { error: "Method not allowed" });
    return;
  }
  if (typeof fetchImpl !== "function") {
    sendSimpleJson(res, 503, { error: "Download is not available right now." });
    return;
  }

  let release;
  try {
    release = await resolveRelease();
  } catch {
    release = null;
  }
  const upstreamUrl = release && release.apkUrl;
  if (!isAllowedAndroidApkUrl(upstreamUrl)) {
    sendSimpleJson(res, 503, { error: "No approved APK is available right now." });
    return;
  }
  const source = (release && release.source) || "unknown";

  const range = req.headers && req.headers.range;
  const controller = new AbortController();
  const headTimer = setTimeout(() => controller.abort(), UPSTREAM_HEAD_TIMEOUT_MS);
  let upstream = null;
  try {
    upstream = await fetchImpl(upstreamUrl, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        accept: "application/octet-stream,*/*",
        "user-agent": "UPM-Android-Download/2.0",
        ...(range ? { range: String(range) } : {}),
      },
    });
  } catch {
    upstream = null;
  } finally {
    clearTimeout(headTimer);
  }

  const status = upstream ? Number(upstream.status) : 0;
  if (!upstream || (status !== 200 && status !== 206)) {
    if (upstream && upstream.body && typeof upstream.body.cancel === "function") {
      try {
        await upstream.body.cancel();
      } catch {
        /* ignore */
      }
    }
    // Never leave a student stranded: hand back the canonical (non-expiring) release URL
    // and let the client follow it itself.
    sendRedirectToApk(res, upstreamUrl, source);
    return;
  }

  const upstreamLength = upstream.headers.get("content-length");
  const contentRange = upstream.headers.get("content-range");
  const upstreamBytes = Number(upstreamLength);
  const wantsWholeFile = !contentRange && !range;

  // Never start a stream that Cloud Run is guaranteed to kill halfway: for a full
  // (non-Range) request bigger than the 32 MiB response cap, redirect instead so the
  // phone downloads the whole APK straight from the release CDN.
  if (
    wantsWholeFile &&
    Number.isFinite(upstreamBytes) &&
    upstreamBytes > MAX_INLINE_RESPONSE_BYTES
  ) {
    if (upstream.body && typeof upstream.body.cancel === "function") {
      try {
        await upstream.body.cancel();
      } catch {
        /* ignore */
      }
    }
    sendRedirectToApk(res, upstreamUrl, source);
    return;
  }

  const headers = {
    "Content-Type": "application/vnd.android.package-archive",
    "Content-Disposition": `attachment; filename="${apkFilenameFromUrl(upstreamUrl)}"`,
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "X-Content-Type-Options": "nosniff",
    "X-UPM-Download-Source": source,
  };
  if (upstreamLength) headers["Content-Length"] = upstreamLength;
  if (contentRange) headers["Content-Range"] = contentRange;

  res.writeHead(status, headers);
  if (req.method === "HEAD" || !upstream.body) {
    res.end();
    if (upstream.body && typeof upstream.body.cancel === "function") {
      try {
        await upstream.body.cancel();
      } catch {
        /* ignore */
      }
    }
    return;
  }

  // Imported lazily so this module stays importable in edge runtimes that only use
  // the manifest/URL helpers.
  const [{ Readable }, { pipeline }] = await Promise.all([
    import("node:stream"),
    import("node:stream/promises"),
  ]);
  // Once the pipeline owns the stream it is locked, so cancelling it afterwards would
  // throw "ReadableStream is locked" as an unhandled rejection - guard with a flag.
  let streamDone = false;
  const abortUpstream = () => {
    if (streamDone) return;
    const body = upstream.body;
    if (body && typeof body.cancel === "function") {
      try {
        Promise.resolve(body.cancel()).catch(() => {});
      } catch {
        /* ignore */
      }
    }
  };
  res.on("close", abortUpstream);
  try {
    await pipeline(Readable.fromWeb(upstream.body), res);
  } catch {
    // Client hung up or the upstream dropped mid-file. The app verifies the size and
    // retries, so tearing the socket down is the correct, quiet outcome here.
    abortUpstream();
    try {
      res.destroy();
    } catch {
      /* ignore */
    }
  } finally {
    streamDone = true;
    res.off("close", abortUpstream);
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
  if (req.method === "HEAD") {
    res.writeHead(302, {
      Location: location,
      "Content-Length": "0",
      "Cache-Control": "no-cache, no-store, max-age=0, must-revalidate",
      "X-UPM-Download-Source": release.source,
    });
    res.end();
    return;
  }
  sendRedirectToApk(res, location, release.source);
}

export const androidDownloadConfig = Object.freeze({
  manifestUrl: RELEASE_MANIFEST_URL,
  fallbackUrl: DEFAULT_FALLBACK_URL,
  releaseBucket: RELEASE_BUCKET,
});
