
export const config = {
  api: {
    bodyParser: {
      sizeLimit: "4mb"
    }
  }
};

export const maxDuration = 60;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const RETRY_STATUSES = new Set([404, 408, 429, 500, 502, 503, 504]);
const BUDGET_MS = 50000;
const ATTEMPT_MS = 18000;
// Legacy deployments must configure this explicitly. There is intentionally no
// provider fallback: production APK traffic now enters through Cloudflare.
const MENTOR_API_URL = String(process.env.MENTOR_API_URL || "").replace(/\/$/, "");
const MONGO_DASHBOARD_ACTIONS = new Set([
  "getStats",
  "getStudyLog",
  "getWeeklyReports",
  "getAnnouncements",
  "getLeaderboard",
  "getStudentMentorNotes",
  "getStudentFeedback",
  "notes.listForStudent",
  // On-leave / absent banner in the app (14-Oct-2026).
  "attendance.status"
]);

async function attemptOnce(url, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: controller.signal
    });
    const rawText = await response.text();
    return { response, rawText };
  } catch (err) {
    if (err && err.name === "AbortError") {
      return { response: { ok: false, status: 408 }, rawText: "" };
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// 429/503/504 means Apps Script is already full. A retry doubles the pile-up.
const NO_RETRY_STATUSES = new Set([429, 503, 504]);

async function postAppsScript(url, body) {
  const started = Date.now();
  const first = await attemptOnce(url, body, ATTEMPT_MS);
  const elapsed = Date.now() - started;
  const retryable = !first.response.ok
    && RETRY_STATUSES.has(first.response.status)
    && !NO_RETRY_STATUSES.has(first.response.status);
  const remaining = BUDGET_MS - elapsed;
  if (retryable && elapsed < 12000 && remaining > 14000) {
    await sleep(800 + Math.floor(Math.random() * 800));
    return attemptOnce(url, body, Math.min(ATTEMPT_MS, BUDGET_MS - (Date.now() - started)));
  }
  return first;
}

// Dashboard reads are the open-app storm: 200 students x 8 calls.
// Shared reads (leaderboard, announcements) are identical, so one warm
// instance serves them from memory. A Mongo miss must NOT fall through to
// Apps Script — that is the 30-concurrent wall. Empty is correct for a
// student who has not logged study yet.
const READ_CACHE = new Map();
const READ_INFLIGHT = new Map();
// Leaderboard responses are student-specific; never share their cache/in-flight key.
const SHARED_READS = new Set(["getAnnouncements"]);

function emptyReadResult(action) {
  return action === "getStats" ? {} : [];
}

function readCacheKey(action, req) {
  if (SHARED_READS.has(action)) return "shared:" + action;
  const payload = (req.body && req.body.payload) || {};
  const id = String(payload.studentId || (req.body && req.body.studentId) || "").trim().toUpperCase();
  return action + ":" + id;
}

function readTtlMs(action) {
  return SHARED_READS.has(action) ? 5 * 60 * 1000 : 45 * 1000;
}

function readCacheGet(key) {
  const hit = READ_CACHE.get(key);
  if (!hit) return null;
  if (Date.now() > hit.until) {
    READ_CACHE.delete(key);
    return null;
  }
  return hit.body;
}

function readCachePut(key, body, ttl) {
  if (!body || body.error) return;
  READ_CACHE.set(key, { until: Date.now() + ttl, body: body });
  if (READ_CACHE.size > 500) {
    const oldest = READ_CACHE.keys().next().value;
    READ_CACHE.delete(oldest);
  }
}

async function mongoDashboardRead(action, req) {
  const payload = studyLogPayload(req);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const dashRes = await fetch(`${MENTOR_API_URL}/api/student-dashboard/get`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: action,
        payload: payload,
        studentId: payload.studentId || ""
      }),
      signal: controller.signal
    });
    const dashData = await dashRes.json();
    if (dashData && dashData.found) return { result: dashData.result };
    return { result: emptyReadResult(action) };
  } finally {
    clearTimeout(timer);
  }
}

async function serveMentorTool(req, res, action) {
  const payload = (req.body && req.body.payload) || {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), action === "ai.evaluate" ? 50000 : 25000);
  try {
    let url = MENTOR_API_URL;
    let init = { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal };
    if (action === "ai.ask") {
      url += "/api/ai/ask";
      init.body = JSON.stringify({
        studentId: payload.studentId || "",
        question: payload.question || "",
        chapterId: payload.chapterId || "",
        history: payload.history || []
      });
    } else if (action === "messages.thread") {
      url += "/api/messages/thread?studentId=" + encodeURIComponent(payload.studentId || "");
      init = { method: "GET", signal: controller.signal };
    } else if (action === "messages.send") {
      url += "/api/messages/send";
      init.body = JSON.stringify({
        studentId: payload.studentId || "",
        studentName: payload.studentName || "",
        text: payload.text || ""
      });
    } else if (action === "ai.dailyTarget") {
      url += "/api/ai/daily-target?studentId=" + encodeURIComponent(payload.studentId || "");
      init = { method: "GET", signal: controller.signal };
    } else if (action === "revision.plan") {
      url += "/api/revision/plan?studentId=" + encodeURIComponent(payload.studentId || "");
      init = { method: "GET", signal: controller.signal };
    } else if (action === "ai.evaluate") {
      url += "/api/ai/evaluate";
      init.body = JSON.stringify({
        studentId: payload.studentId || "",
        question: payload.question || "",
        studentAnswer: payload.studentAnswer || "",
        subject: payload.subject || "",
        chapterId: payload.chapterId || "",
        concept: payload.concept || "",
        confidence: payload.confidence || ""
      });
    } else {
      res.status(400).json({ error: "Unknown tool." });
      return;
    }
    const response = await fetch(url, init);
    const data = await response.json();
    res.status(200).json({ result: data });
  } catch (err) {
    console.error("Mentor tool failed:", action, err && err.message);
    res.status(200).json({ result: { ok: false, error: "The tutor service is busy. Please try again." } });
  } finally {
    clearTimeout(timer);
  }
}

async function serveScaledRead(req, res, action) {
  if (!MONGO_DASHBOARD_ACTIONS.has(action)) return false;
  // A mentor deletion must be reflected on the very next student refresh.
  // Do not serve announcement results from the old five-minute shared cache.
  if (action === "getAnnouncements" || action === "notes.listForStudent") {
    res.setHeader("Cache-Control", "no-store");
    try {
      res.status(200).json(await mongoDashboardRead(action, req));
    } catch (err) {
      console.error("Content read failed:", err && err.message);
      res.status(200).json({ result: [] });
    }
    return true;
  }
  const key = readCacheKey(action, req);
  const ttl = readTtlMs(action);
  const cached = readCacheGet(key);
  if (cached) {
    res.status(200).json(cached);
    return true;
  }

  let job = READ_INFLIGHT.get(key);
  if (!job) {
    job = mongoDashboardRead(action, req).then(function (body) {
      readCachePut(key, body, ttl);
      return body;
    });
    READ_INFLIGHT.set(key, job);
    job.finally(function () { READ_INFLIGHT.delete(key); });
  }

  try {
    const body = await job;
    res.status(200).json(body);
  } catch (err) {
    console.error("Scaled read failed:", action, err && err.message);
    res.status(200).json({ result: emptyReadResult(action) });
  }
  return true;
}

function isSept2026(value) {
  const t = String(value || "").trim().toLowerCase();
  if (!t) return false;
  if (/sept(?:ember)?\s*20?26/.test(t)) return true;
  if (/\bsep(?:t)?[\s./-]*26\b/.test(t)) return true;
  return false;
}

function sept26Closed() {
  return {
    result: {
      success: false,
      code: "group_closed",
      message: "Sept 2026 access is closed."
    }
  };
}

function isClosedCohort(result) {
  if (!result || result.success !== true) return false;
  const attempt = String(result.attempt || result.examAttempt || result.exam || "").trim();
  const batch = String(result.batch || "").trim();
  if (isSept2026(attempt) || isSept2026(batch)) return true;
  if (!attempt) return true;
  return false;
}

function loginPayload(req) {
  const payload = (req.body && req.body.payload) || {};
  return {
    studentId: payload.studentId || req.body?.studentId || "",
    password: payload.password || req.body?.password || "",
    currentPassword: payload.currentPassword || req.body?.currentPassword || "",
    newPassword: payload.newPassword || payload.password || req.body?.newPassword || ""
  };
}

function studyLogPayload(req) {
  const payload = Object.assign({}, (req.body && req.body.payload) || {});
  if (!payload.studentId && req.body && req.body.studentId) payload.studentId = req.body.studentId;
  return payload;
}

async function tryMongoLogin(req) {
  const action = req.body?.action;
  const fields = loginPayload(req);
  if (action === "validateLogin") {
    const response = await fetch(`${MENTOR_API_URL}/api/student-auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId: fields.studentId, password: fields.password })
    });
    const data = await response.json();
    const result = data.result || data;
    if (result && result.success === true) {
      if (isClosedCohort(result)) return sept26Closed();
      return { result };
    }
    if (result && result.code === "wrong_password") return { result };
    if (result && result.code === "group_closed") return { result };
    // "Student ID not found" must reach the student. Previously it returned null,
    // which the caller turned into "Sept 2026 access is closed" - so a simple typo
    // in the ID looked like the exam cohort being shut down.
    if (result && result.code === "not_found") return { result };
    return null;
  }
  if (action === "changePassword") {
    const response = await fetch(`${MENTOR_API_URL}/api/student-auth/change-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        studentId: fields.studentId,
        currentPassword: fields.currentPassword,
        newPassword: fields.newPassword
      })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.detail || data?.error || `Password service failed (${response.status}).`);
    }
    // A rejected password change is still an authoritative backend response.
    // Returning null here used to fall through to the retired Apps Script;
    // Cloud Run has no APPS_SCRIPT_URL, so students saw a misleading HTTP 503
    // instead of "current password is incorrect" or "student not found".
    const result = Object.prototype.hasOwnProperty.call(data || {}, "result") ? data.result : data;
    if (result && typeof result === "object") return { result };
    throw new Error("Password service returned an invalid response.");
  }
  return null;
}

async function mirrorStudyLogToMongo(payload, gasResult) {
  // Only the explicitly configured host; never fail over to retired providers.
  const hosts = MENTOR_API_URL ? [MENTOR_API_URL] : [];
  const body = JSON.stringify({ action: "addStudyLog", payload, result: gasResult || {} });
  for (let i = 0; i < hosts.length; i++) {
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, 12000);
    try {
      const response = await fetch(hosts[i] + "/api/student-dashboard/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: controller.signal
      });
      if (response.ok) return true;
      console.error("Mongo study-log write rejected:", hosts[i], response.status);
    } catch (err) {
      console.error("Mongo study-log mirror failed:", hosts[i], err && err.message);
    } finally {
      clearTimeout(timer);
    }
  }
  return false;
}

export default async function handler(req, res) {
  try {
    /**
 * Build the stable, non-expiring download URL for the app.
 *
 * The URL points at our own origin (/download/android), which streams the APK with a
 * real Content-Length and no redirect. Students keep working downloads even hours
 * after the update banner appeared - the previous behaviour (a 1-hour signed
 * release-assets URL, cached for the session and reused on every Retry) is what made
 * "maximum bachon ko update krte samay issue" happen.
 */
function stableApkDownloadUrl(req, canonicalUrl) {
  const headers = (req && req.headers) || {};
  const first = (value) => String(value || "").split(",")[0].trim();
  const host = first(headers["x-forwarded-host"]) || first(headers.host);
  const proto = first(headers["x-forwarded-proto"]) || "https";
  const override = String(process.env.APP_ANDROID_STABLE_URL || "").trim();
  if (override) return override;
  if (host) return `${proto}://${host}/download/android`;
  return canonicalUrl; // last resort: the canonical (non-expiring) release URL
}

const updateAction = req.body?.action || req.query?.action;
    if (updateAction === "ai.ask" || updateAction === "ai.dailyTarget" || updateAction === "ai.evaluate" || updateAction === "revision.plan" || updateAction === "messages.thread" || updateAction === "messages.send") {
      await serveMentorTool(req, res, updateAction);
      return;
    }
    if (await serveScaledRead(req, res, updateAction)) return;
    if (updateAction === "app.version") {
      // Try live latest.json from releases repo first (always up-to-date), fallback to env vars
      try {
        // Cache-bust: raw.githubusercontent.com can briefly serve the previous
        // manifest generation after a release (same reason android-download.js
        // appends ?ts=). Without it app.version lags a new release by minutes.
        const manifestUrl = "https://raw.githubusercontent.com/anujvkarewad-cyber/UPM-Android-Releases/main/latest.json";
        const latestRes = await fetch(`${manifestUrl}${manifestUrl.includes("?") ? "&" : "?"}ts=${Date.now()}`, { cache: "no-store" });
        if (latestRes.ok) {
          const latest = await latestRes.json();
          if (latest && latest.versionCode) {
            // Resolve GitHub's double-redirect to a single-hop signed URL so the
            // in-app downloader (incl. older v1.14.6 force-update modal) and any
            // download manager finish instead of stalling on content-length:0.
            // NEVER hand the app a release-assets.githubusercontent.com signed URL:
            // it expires after ~1h, the app caches it for the session and retries it
            // forever, and the student ends up stuck on the blocking update modal.
            // Our own /download/android streams the bytes with no expiry and no
            // redirect - the same origin the app already talks to.
            const canonicalApkUrl = String(latest.apkUrl || process.env.APP_ANDROID_APK_URL || "").trim();
            const apkUrl = stableApkDownloadUrl(req, canonicalApkUrl);
            return res.status(200).json({
              result: {
                version: latest.version || process.env.APP_ANDROID_VERSION || "1.11.8",
                versionCode: Number(latest.versionCode || process.env.APP_ANDROID_VERSION_CODE || 30),
                minimumVersionCode: Number(latest.minimumVersionCode || process.env.APP_ANDROID_MIN_VERSION_CODE || latest.versionCode || 30),
                apkUrl,
                downloadUrl: canonicalApkUrl || apkUrl,
                releaseNotes: latest.notes || process.env.APP_ANDROID_RELEASE_NOTES || "ChatGPT-style AI assistant UI - headings, bold without stars, bullets, tables, avatar + typing bar fix",
                forceUpdate: true,
                publishedAt: latest.publishedAt || process.env.APP_ANDROID_PUBLISHED_AT || new Date().toISOString().slice(0, 10)
              }
            });
          }
        }
      } catch (e) {
        console.error("latest.json fetch failed, falling back to env", e && e.message);
      }
      const canonicalFallbackUrl =
        process.env.APP_ANDROID_APK_URL ||
        "https://github.com/anujvkarewad-cyber/UPM-Android-Releases/releases/download/v1.11.8-30/UPM-v1.11.8-30-release.apk";
      const fallbackApkUrl = stableApkDownloadUrl(req, canonicalFallbackUrl);
      return res.status(200).json({
        result: {
          version: process.env.APP_ANDROID_VERSION || "1.11.8",
          versionCode: Number(process.env.APP_ANDROID_VERSION_CODE || 30),
          minimumVersionCode: Number(process.env.APP_ANDROID_MIN_VERSION_CODE || 30),
          apkUrl: fallbackApkUrl,
          downloadUrl: canonicalFallbackUrl,
          releaseNotes: process.env.APP_ANDROID_RELEASE_NOTES || "ChatGPT-style AI assistant UI - headings, bold without stars, bullets, tables, avatar + typing bar fix",
          forceUpdate: true,
          publishedAt: process.env.APP_ANDROID_PUBLISHED_AT || new Date().toISOString().slice(0, 10)
        }
      });
    }

    if (updateAction === "validateLogin") {
      try {
        const mongoHit = await tryMongoLogin(req);
        if (mongoHit) return res.status(200).json(mongoHit);
      } catch (mongoErr) {
        // The backend could not be reached. This is an outage, NOT a cohort
        // closure - reporting it as "Sept 2026 access is closed" hid the outage
        // and would have told Jan 2027 students their exam was shut.
        console.error("Mongo login unreachable:", mongoErr && mongoErr.message);
        return res.status(200).json({
          result: {
            success: false,
            code: "server_unreachable",
            message: "Could not reach the server. Please check your internet and try again in a moment."
          }
        });
      }
      // Reached the backend but it returned something unrecognised.
      return res.status(200).json(sept26Closed());
    }

    if (updateAction === "changePassword") {
      try {
        const mongoHit = await tryMongoLogin(req);
        if (mongoHit) return res.status(200).json(mongoHit);
      } catch (mongoErr) {
        console.error("Mongo password change fallback to Apps Script:", mongoErr && mongoErr.message);
      }
    }

    if (updateAction === "saveDeviceToken") {
      // FCM device-token registration lives on the FastAPI backend now. The
      // legacy Apps Script answer ("This option is not available") silently
      // killed every server push, so this must never fall through to it.
      const payload = (req.body && req.body.payload) || {};
      const studentId = String(payload.studentId || req.body?.studentId || "").trim();
      const token = String(payload.token || "").trim();
      if (!MENTOR_API_URL) {
        return res.status(200).json({
          result: { success: false, message: "Push registration is not available on this deployment." }
        });
      }
      try {
        const response = await fetch(`${MENTOR_API_URL}/api/push/device-token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ studentId, token })
        });
        const data = await response.json().catch(() => ({}));
        const result = (data && data.result) || { success: response.ok };
        return res.status(200).json({ result });
      } catch (tokenErr) {
        console.error("saveDeviceToken forward failed:", tokenErr && tokenErr.message);
        return res.status(200).json({
          result: { success: false, message: "Could not register the notification token." }
        });
      }
    }

    if (MONGO_DASHBOARD_ACTIONS.has(updateAction)) {
      try {
        const payload = studyLogPayload(req);
        const dashRes = await fetch(`${MENTOR_API_URL}/api/student-dashboard/get`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: updateAction,
            payload,
            studentId: payload.studentId || ""
          })
        });
        const dashData = await dashRes.json();
        if (dashData && dashData.found) return res.status(200).json({ result: dashData.result });
      } catch (dashErr) {
        console.error("Mongo dashboard fallback:", dashErr && dashErr.message);
      }
    }

    if (updateAction === "addStudyLog") {
      // Mongo is the production source of truth. APPS_SCRIPT_URL now points to
      // the narrowly scoped password-reset/proof service, so forwarding this
      // action there would save the row in Mongo and then misleadingly tell the
      // student "This option is not available." Return the authoritative write
      // result immediately instead.
      const saved = await mirrorStudyLogToMongo(studyLogPayload(req), {});
      if (saved) return res.status(200).json({ result: { success: true } });
      return res.status(502).json({
        result: { success: false, message: "Could not save your study log. Please try again." }
      });
    }

    if (
      updateAction === "attendance.markAbsent" ||
      updateAction === "attendance.requestLeave" ||
      updateAction === "attendance.cancelLeave"
    ) {
      // Student self-reported leave / absent. Mongo (via FastAPI) is the source of
      // truth so the mentor tracker sees it immediately.
      try {
        const payload = studyLogPayload(req);
        const attRes = await fetch(`${MENTOR_API_URL}/api/student-dashboard/write`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: updateAction, payload }),
        });
        const attData = await attRes.json();
        const result = (attData && attData.result) || attData || {};
        return res.status(200).json({ result: { success: result.success !== false, ...result } });
      } catch (err) {
        console.error("attendance write failed:", err && err.message);
        return res.status(502).json({
          result: { success: false, message: "Save nahi hua. Internet check karke phir try karo." },
        });
      }
    }

    if (updateAction === "deleteStudyLog") {
      try {
        const payload = studyLogPayload(req);
        const delRes = await fetch(`${MENTOR_API_URL}/api/student-dashboard/write`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "deleteStudyLog", payload })
        });
        const delData = await delRes.json();
        const result = (delData && delData.result) || delData || {};
        return res.status(200).json({ result: { success: result.success !== false, ...result } });
      } catch (err) {
        return res.status(502).json({ error: "Delete failed. Try again." });
      }
    }

    if (!process.env.APPS_SCRIPT_URL) {
      // Cloud Run runs without Apps Script: the FastAPI backend is the source
      // of truth. A study log must still be saved rather than failing the
      // student with a misconfiguration error.
      if (updateAction === "addStudyLog") {
        await mirrorStudyLogToMongo(studyLogPayload(req), {});
        return res.status(200).json({ result: { success: true } });
      }
      return res.status(503).json({
        error: `This action is not available right now (${updateAction || "unknown"}).`
      });
    }

    const body = JSON.stringify(req.body);
    let response;
    let rawText;
    try {
      ({ response, rawText } = await postAppsScript(process.env.APPS_SCRIPT_URL, body));
    } catch (fetchErr) {
      if (updateAction === "addStudyLog") {
        await mirrorStudyLogToMongo(studyLogPayload(req), {});
        return res.status(200).json({ result: { success: true, message: "Saved on Mongo. Sheet retry pending." } });
      }
      return res.status(502).json({
        error: "Google server busy hai. 15 second wait karke ek baar phir try karo."
      });
    }

    if (!response.ok) {
      if (updateAction === "addStudyLog") {
        await mirrorStudyLogToMongo(studyLogPayload(req), {});
        return res.status(200).json({ result: { success: true, message: "Saved on Mongo. Sheet retry pending." } });
      }
      return res.status(502).json({
        error: "Google server busy hai. 15 second wait karke ek baar phir try karo."
      });
    }

    let data;
    try {
      data = JSON.parse(rawText);
    } catch (parseErr) {
      if (updateAction === "addStudyLog") {
        await mirrorStudyLogToMongo(studyLogPayload(req), {});
        return res.status(200).json({ result: { success: true } });
      }
      return res.status(502).json({
        error: "Apps Script returned a non-JSON response."
      });
    }

    if (updateAction === "addStudyLog") {
      await mirrorStudyLogToMongo(studyLogPayload(req), data && data.result);
    }

    if (updateAction === "validateLogin") {
      const result = data && data.result;
      if (result && result.success === true && isClosedCohort(result)) {
        return res.status(200).json(sept26Closed());
      }
    }

    return res.status(200).json(data);

  } catch (err) {
    return res.status(500).json({
      error: err.message
    });
  }
}
