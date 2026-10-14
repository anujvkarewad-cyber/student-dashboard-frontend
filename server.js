/**
 * Cloud Run server for the student dashboard.
 *
 * Replaces the Vercel hosting that went down with 402 DEPLOYMENT_DISABLED.
 * One container now does what Vercel + the Cloudflare gateway used to do:
 *
 *   1. serves the static PWA (index.html, app.js, style.css, assets, icons)
 *   2. POST /api/proxy        -> the existing Vercel function in api/proxy.js,
 *                                run through a tiny req/res shim so the file
 *                                itself stays untouched and keeps its caches,
 *                                retries and Mongo routing
 *   3. /api/mentor/*          -> reverse proxy to the FastAPI backend
 *                                (MENTOR_API_URL), same path contract the
 *                                Cloudflare worker exposed, so the browser
 *                                keeps using same-origin "/api/mentor"
 *   4. /health, /api/health   -> Cloud Run health checks
 *
 * Every /api/* response is JSON, including errors. That is what kills the
 * "Server returned an unreadable response. Please try again." message the
 * students saw: the dead Vercel deployment answered with an HTML 402 page and
 * the clients' response.json() blew up on it.
 */

import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleAndroidDownload, streamAndroidApk } from "./lib/android-download.js";
import { handleProofUpload } from "./lib/proof-upload.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_DIR = path.resolve(process.env.PUBLIC_DIR || __dirname);
const MENTOR_API_URL = String(process.env.MENTOR_API_URL || "").replace(/\/+$/, "");
const JSON_BODY_LIMIT = 4 * 1024 * 1024; // matches the old Vercel bodyParser limit
const MENTOR_TIMEOUT_MS = Number(process.env.MENTOR_TIMEOUT_MS || 60000);

if (!MENTOR_API_URL) {
  console.warn("[boot] MENTOR_API_URL is not set — /api/mentor and the Mongo routes will fail.");
}

/* ------------------------------------------------------------------ *
 * Static file serving
 * ------------------------------------------------------------------ */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".pdf": "application/pdf",
};

// Source-only folders must never be reachable over HTTP, even though they sit
// in the repository the image is built from.
const BLOCKED_TOP_LEVEL = new Set([
  "api",
  "cloudflare",
  "content-pipeline",
  "mobile",
  "scripts",
  "node_modules",
  ".git",
  ".github",
  ".vercel",
  "test_reports",
]);

// Never cache the shell or anything that decides app behaviour; hash-free
// filenames mean a stale cache is how students get stuck on an old build.
const NO_CACHE_FILES = new Set([
  "/index.html",
  "/service-worker.js",
  "/firebase-messaging-sw.js",
  "/manifest.json",
]);

// Deployment metadata lives next to the static files in this repo-as-webroot
// layout; none of it belongs on the public internet.
const BLOCKED_FILES = new Set([
  "package.json",
  "package-lock.json",
  "server.js",
  "dockerfile",
  ".dockerignore",
  ".gcloudignore",
  "vercel.json",
  ".gitignore",
]);
const BLOCKED_EXTENSIONS = new Set([".md", ".gs", ".env", ".yml", ".yaml", ".toml", ".sh"]);

function isBlocked(relPath) {
  const parts = relPath.split("/").filter(Boolean);
  const [top] = parts;
  if (top && BLOCKED_TOP_LEVEL.has(top)) return true;
  const name = (parts[parts.length - 1] || "").toLowerCase();
  if (name.startsWith(".")) return true;
  if (parts.length === 1 && BLOCKED_FILES.has(name)) return true;
  if (BLOCKED_EXTENSIONS.has(path.extname(name))) return true;
  return false;
}

function cacheControlFor(urlPath, ext) {
  if (NO_CACHE_FILES.has(urlPath)) return "no-cache, no-store, must-revalidate";
  if (ext === ".html") return "no-cache, no-store, must-revalidate";
  if (urlPath.startsWith("/assets/") || urlPath.startsWith("/icon/")) {
    return "public, max-age=86400";
  }
  // App code has no content hash in its name: revalidate every load.
  return "public, max-age=0, must-revalidate";
}

async function resolveStatic(urlPath) {
  let rel = decodeURIComponent(urlPath.split("?")[0]);
  if (rel.endsWith("/")) rel += "index.html";
  if (rel === "") rel = "/index.html";
  if (rel.includes("\0")) return null;

  const candidate = path.resolve(PUBLIC_DIR, "." + rel);
  if (candidate !== PUBLIC_DIR && !candidate.startsWith(PUBLIC_DIR + path.sep)) return null;
  if (isBlocked(path.relative(PUBLIC_DIR, candidate).split(path.sep).join("/"))) return null;

  try {
    const stat = await fsp.stat(candidate);
    if (stat.isDirectory()) return resolveStatic(rel.replace(/\/?$/, "/"));
    return { file: candidate, stat, urlPath: rel };
  } catch {
    return null;
  }
}

function sendStatic(req, res, hit) {
  const ext = path.extname(hit.file).toLowerCase();
  const etag = `W/"${hit.stat.size}-${Number(hit.stat.mtimeMs).toString(36)}"`;
  const headers = {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Content-Length": hit.stat.size,
    "Cache-Control": cacheControlFor(hit.urlPath, ext),
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
  };
  if (hit.urlPath === "/service-worker.js" || hit.urlPath === "/firebase-messaging-sw.js") {
    headers["Service-Worker-Allowed"] = "/";
  }
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, { ETag: etag, "Cache-Control": headers["Cache-Control"] });
    res.end();
    return;
  }
  res.writeHead(200, headers);
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  fs.createReadStream(hit.file).pipe(res);
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function sendJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    ...headers,
  });
  res.end(payload);
}

function readBody(req, limit = JSON_BODY_LIMIT) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        // Pause rather than destroy: the socket must stay open long enough
        // for the handler to answer with JSON, otherwise the client sees a
        // dropped connection instead of a readable error.
        req.pause();
        reject(Object.assign(new Error("Payload too large"), { statusCode: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/* ------------------------------------------------------------------ *
 * /api/proxy — the Vercel handler, unchanged, behind a shim
 * ------------------------------------------------------------------ */

let proxyHandlerPromise = null;
function loadProxyHandler() {
  if (!proxyHandlerPromise) {
    proxyHandlerPromise = import("./api/proxy.js").then((mod) => mod.default);
  }
  return proxyHandlerPromise;
}

/** Minimal Vercel-compatible res: status().json(), setHeader(), send(), end(). */
function makeResShim(res) {
  let statusCode = 200;
  const headers = {};
  let finished = false;
  const shim = {
    get headersSent() {
      return finished || res.headersSent;
    },
    status(code) {
      statusCode = code;
      return shim;
    },
    setHeader(name, value) {
      headers[name] = value;
      return shim;
    },
    getHeader(name) {
      return headers[name];
    },
    json(body) {
      if (finished) return shim;
      finished = true;
      sendJson(res, statusCode, body, headers);
      return shim;
    },
    send(body) {
      if (finished) return shim;
      finished = true;
      if (body && typeof body === "object") return sendJson(res, statusCode, body, headers);
      const text = String(body ?? "");
      res.writeHead(statusCode, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        ...headers,
      });
      res.end(text);
      return shim;
    },
    end(body) {
      if (finished) return shim;
      finished = true;
      res.writeHead(statusCode, headers);
      res.end(body);
      return shim;
    },
  };
  return shim;
}

async function handleProxy(req, res, url) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "POST required" });
    return;
  }

  let body;
  try {
    const raw = await readBody(req);
    body = raw.length ? JSON.parse(raw.toString("utf8")) : {};
  } catch (err) {
    if (err && err.statusCode === 413) {
      sendJson(res, 413, { error: "Request is too large." });
      return;
    }
    sendJson(res, 400, { error: "Request body must be valid JSON." });
    return;
  }

  const query = Object.fromEntries(url.searchParams.entries());
  const reqShim = {
    method: req.method,
    url: req.url,
    headers: req.headers,
    body,
    query,
    cookies: {},
  };
  const resShim = makeResShim(res);

  try {
    const handler = await loadProxyHandler();
    await handler(reqShim, resShim);
  } catch (err) {
    console.error("[proxy] handler threw:", err && err.message);
    if (!resShim.headersSent) {
      sendJson(res, 502, { error: "Server is busy. Please try again in a moment." });
    }
  }

  // A handler that returns without answering would leave the client hanging
  // until its own timeout, which surfaces as the same unreadable-response
  // error. Always close with JSON.
  if (!resShim.headersSent) {
    sendJson(res, 502, { error: "No response from the server. Please try again." });
  }
}

/* ------------------------------------------------------------------ *
 * /api/mentor/* — reverse proxy to the FastAPI backend
 * ------------------------------------------------------------------ */

const HOP_BY_HOP = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-length",
  "accept-encoding",
]);

async function handleMentor(req, res, url) {
  if (!MENTOR_API_URL) {
    sendJson(res, 503, { error: "Backend is not configured (MENTOR_API_URL missing)." });
    return;
  }

  const suffix = url.pathname.replace(/^\/api\/mentor/, "") || "/";
  const target = MENTOR_API_URL + suffix + (url.search || "");

  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers[key] = value;
  }
  const serviceToken = String(process.env.MENTOR_SERVICE_TOKEN || "").trim();
  if (serviceToken) headers.authorization = `Bearer ${serviceToken}`;

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  let body;
  if (hasBody) {
    const raw = await readBody(req, 12 * 1024 * 1024);
    body = raw.length ? raw : undefined;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MENTOR_TIMEOUT_MS);
  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body,
      redirect: "follow",
      signal: controller.signal,
    });

    const outHeaders = {
      "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
      "Cache-Control": upstream.headers.get("cache-control") || "no-store",
      "Access-Control-Allow-Origin": "*",
    };
    const buffer = Buffer.from(await upstream.arrayBuffer());
    outHeaders["Content-Length"] = buffer.length;
    res.writeHead(upstream.status, outHeaders);
    res.end(req.method === "HEAD" ? undefined : buffer);
  } catch (err) {
    const aborted = err && err.name === "AbortError";
    console.error("[mentor] upstream failed:", suffix, err && err.message);
    sendJson(res, aborted ? 504 : 502, {
      error: aborted
        ? "The server is taking too long to respond. Please try again."
        : "Could not reach the server. Please try again in a moment.",
    });
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ *
 * /api/proof-upload — study proof to Google Drive (ported from the worker)
 * ------------------------------------------------------------------ */

async function handleProofUploadRoute(req, res) {
  try {
    const { status, body } = await handleProofUpload({
      method: req.method,
      headers: req.headers,
      readBody: (limit) => readBody(req, limit),
      mentorApiUrl: MENTOR_API_URL,
      env: process.env,
    });
    sendJson(res, status, body);
  } catch (err) {
    if (err && err.statusCode === 413) {
      sendJson(res, 413, { error: "Proof must be 10 MB or smaller" });
      return;
    }
    console.error("[proof] upload failed:", err && err.message);
    sendJson(res, 502, { error: "Proof upload failed. Please try again." });
  }
}

/* ------------------------------------------------------------------ *
 * /api/sheets — legacy Google Sheets function, loaded only on demand
 * ------------------------------------------------------------------ */

let sheetsHandlerPromise = null;
async function handleSheets(req, res, url) {
  if (!sheetsHandlerPromise) {
    sheetsHandlerPromise = import("./api/sheets.js")
      .then((mod) => mod.default)
      .catch((err) => {
        console.error("[sheets] not available:", err && err.message);
        return null;
      });
  }
  const handler = await sheetsHandlerPromise;
  if (!handler) {
    sendJson(res, 503, { error: "Sheets endpoint is not available on this deployment." });
    return;
  }
  let body = {};
  if (req.method !== "GET" && req.method !== "HEAD") {
    try {
      const raw = await readBody(req);
      body = raw.length ? JSON.parse(raw.toString("utf8")) : {};
    } catch {
      sendJson(res, 400, { error: "Request body must be valid JSON." });
      return;
    }
  }
  const resShim = makeResShim(res);
  try {
    await handler(
      {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body,
        query: Object.fromEntries(url.searchParams.entries()),
      },
      resShim,
    );
  } catch (err) {
    console.error("[sheets] handler threw:", err && err.message);
    if (!resShim.headersSent) sendJson(res, 502, { error: "Sheets request failed." });
  }
}

/* ------------------------------------------------------------------ *
 * Router
 * ------------------------------------------------------------------ */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Student-Id, X-Session-Password, X-File-Name",
        "Access-Control-Max-Age": "86400",
      });
      res.end();
      return;
    }

    if (pathname === "/health" || pathname === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        service: "student-dashboard-frontend",
        backendConfigured: Boolean(MENTOR_API_URL),
        time: new Date().toISOString(),
      });
      return;
    }

    if (pathname === "/download/android" || pathname === "/download/android/") {
      // Stable, non-expiring, single-hop stream (the URL handed to the app by
      // app.version). ?mode=redirect keeps the old 302 for links/emails.
      if (url.searchParams.get("mode") === "redirect") {
        await handleAndroidDownload(req, res);
      } else {
        await streamAndroidApk(req, res);
      }
      return;
    }

    if (pathname === "/api/proxy") {
      await handleProxy(req, res, url);
      return;
    }

    if (pathname === "/api/sheets") {
      await handleSheets(req, res, url);
      return;
    }

    if (pathname === "/api/mentor" || pathname.startsWith("/api/mentor/")) {
      await handleMentor(req, res, url);
      return;
    }

    if (pathname === "/api/proof-upload") {
      await handleProofUploadRoute(req, res);
      return;
    }

    // Anything else under /api must still answer JSON — never the HTML shell.
    if (pathname.startsWith("/api/")) {
      sendJson(res, 404, { error: `Unknown API route: ${pathname}` });
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    const hit = await resolveStatic(pathname);
    if (hit) {
      sendStatic(req, res, hit);
      return;
    }

    // SPA fallback: unknown non-file paths load the dashboard shell.
    if (!path.extname(pathname)) {
      const shell = await resolveStatic("/index.html");
      if (shell) {
        sendStatic(req, res, shell);
        return;
      }
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  } catch (err) {
    console.error("[server] unhandled:", err && err.stack);
    if (!res.headersSent) {
      if (pathname.startsWith("/api/")) sendJson(res, 500, { error: "Internal server error." });
      else {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Internal server error");
      }
    } else {
      res.end();
    }
  }
});

// Cloud Run can hold a connection open; keep the server's idle timeouts above
// the load balancer's so it never races a request to a closed socket.
server.keepAliveTimeout = 620000;
server.headersTimeout = 630000;
server.requestTimeout = 0;

server.listen(PORT, HOST, () => {
  console.log(`[boot] listening on http://${HOST}:${PORT}`);
  console.log(`[boot] static root: ${PUBLIC_DIR}`);
  console.log(`[boot] backend: ${MENTOR_API_URL || "(not configured)"}`);
});

const shutdown = (signal) => {
  console.log(`[shutdown] ${signal} received`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10000).unref();
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export default server;
