
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

const STUDENT_TOOLS = new Set(["messages.thread", "messages.send", "ai.ask", "ai.dailyTarget", "ai.evaluate", "revision.plan"]);
const STUDENT_WRITES = new Set(["addStudyLog", "deleteStudyLog", "attendance.markAbsent", "attendance.requestLeave", "attendance.cancelLeave", "feedback.read"]);
const BLOCKED_MENTOR_WRITES = new Set(["announcements.create", "notes.create", "notes.finalizeUpload", "notes.delete", "students.addNote", "feedback.send"]);
function studentHeaders(req) {
  return {
    "X-Student-Id": String(req.headers?.["x-student-id"] || req.headers?.["X-Student-Id"] || "").trim(),
    "X-Session-Password": String(req.headers?.["x-session-password"] || req.headers?.["X-Session-Password"] || "")
  };
}

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

// Every protected dashboard read reaches the current-account boundary.
// No private cache or ID-keyed in-flight sharing, and no legacy read fallback.
function emptyReadResult(action) {
  return action === "getStats" ? {} : [];
}

async function mongoDashboardRead(action, req) {
  const payload = studyLogPayload(req);
  const controller = new AbortController();
  // 4s was too tight for the shared backend: cold starts and Mongo bursts made
  // ordinary dashboard reads die as 502s at busy hours (68/day by 28-Oct-2026).
  // The backend now keeps one warm instance; 10s covers its p99.
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const dashRes = await fetch(`${MENTOR_API_URL}/api/student-dashboard/get`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...studentHeaders(req) },
      body: JSON.stringify({
        action: action,
        payload: payload,
        studentId: payload.studentId || ""
      }),
      signal: controller.signal
    });
    if (!dashRes.ok) {
      const error = new Error("Protected dashboard request failed.");
      error.status = [401,403].includes(dashRes.status) ? dashRes.status : 502;
      throw error;
    }
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
    if (STUDENT_TOOLS.has(action)) init.headers = { ...(init.headers || {}), ...studentHeaders(req) };
    const response = await fetch(url, init);
    if (STUDENT_TOOLS.has(action) && [401,403].includes(response.status)) return res.status(response.status).json({ error: "Student session unavailable. Sign in again." });
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
  // These reads depend on current owner/membership/access; neither response
  // caching nor ID-keyed in-flight sharing may bypass the backend check.
  res.setHeader("Cache-Control", "no-store");
  try {
    res.status(200).json(await mongoDashboardRead(action, req));
  } catch (error) {
    res.status(error.status || 502).json({ error: [401,403].includes(error.status)
      ? "Student session unavailable. Sign in again." : "Dashboard could not refresh." });
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
    if (result && ["not_found", "removed", "access_blocked"].includes(result.code)) return { result };
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

async function mirrorStudyLogToMongo(payload, gasResult, actorHeaders) {
  // One authoritative write attempt only. A lost acknowledgement can follow a
  // committed write; never resend here or fall through to another provider.
  const unknown = "Save outcome is unknown. Keep this draft and check Study tracker before retrying.";
  const failure = (message) => ({ status: 502, result: { success: false, message } });
  if (!MENTOR_API_URL) return failure("Study log was not sent: the save service is unavailable. Keep this draft.");
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, 12000);
  try {
    const response = await fetch(MENTOR_API_URL + "/api/student-dashboard/write", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...actorHeaders },
      body: JSON.stringify({ action: "addStudyLog", payload, result: gasResult || {} }),
      signal: controller.signal
    });
    if ([401,403].includes(response.status)) return { status: response.status,
      result: { success: false, message: "Student session unavailable. Keep your draft and sign in again." } };
    if (!response.ok) {
      // A backend error may occur AFTER Mongo committed (e.g. leaderboard
      // rebuild failure). Do not interpret every HTTP error as a failed write.
      const rejected = response.status >= 400 && response.status < 500 && response.status !== 408;
      return failure(rejected
        ? "The server rejected this study log. Keep your draft and check Study tracker before retrying."
        : unknown);
    }
    if (response.status !== 200) return failure(unknown); // Accepted/queued is not saved.
    const data = await response.json();
    const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
    if (!object(data)) return failure(unknown);
    const nested = object(data.result) ? data.result : null;
    if (data.ok === false || data.success === false || data.error ||
        (nested && (nested.ok === false || nested.success === false || nested.error))) {
      return failure("The server rejected this study log. Keep your draft and check Study tracker before retrying.");
    }
    // Present status flags must be booleans; malformed values must not be
    // ignored just because another part of the envelope says true.
    for (const part of [data, nested]) {
      if (!part) continue;
      for (const flag of ["ok", "success"]) {
        if (Object.prototype.hasOwnProperty.call(part, flag) && typeof part[flag] !== "boolean") return failure(unknown);
      }
    }
    // Canonical backend acknowledgement. Preserve its existing proof/stats.
    if (data.ok === true && nested && nested.success === true) {
      return { status: 200, result: nested };
    }
    // Narrow compatibility with the existing top-level acknowledgement fixture;
    // never use it to override a present, malformed or contradictory result.
    if (data.ok === true && data.success === true &&
        !Object.prototype.hasOwnProperty.call(data, "result")) {
      return { status: 200, result: { success: true } };
    }
    return failure(unknown);
  } catch {
    // Do not log payloads, credentials, provider bodies or raw exception text.
    return failure(unknown);
  } finally {
    clearTimeout(timer);
  }
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
    if (BLOCKED_MENTOR_WRITES.has(updateAction)) {
      return res.status(403).json({ error: "Mentor action requires verified authorization." });
    }
    if (MONGO_DASHBOARD_ACTIONS.has(updateAction) || STUDENT_WRITES.has(updateAction) || updateAction === "saveDeviceToken" || STUDENT_TOOLS.has(updateAction)) {
      res.setHeader("Cache-Control", "no-store");
      // Compatibility: installed v1.15.2 (build 46) apps send NO session headers —
      // their generic call() predates the header mechanism. Hard-rejecting them
      // blanks those students' dashboards ("Student authentication required").
      // Until the new session-header APK is rolled out fleet-wide, serve
      // headerless calls exactly like the 15-Oct gateway did — forward as-is;
      // the backend read/write path performs no header check of its own.
      // When every student is on the session-header APK, fail closed here again.
    }
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
      } catch {
        // An unavailable/rejected account service is never permission to use
        // the retired provider. This also protects the /api/sheets alias.
      }
      return res.status(502).json({ result: {
        success: false, message: "Password service unavailable. Please try again."
      } });
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
          headers: { "Content-Type": "application/json", ...studentHeaders(req) },
          body: JSON.stringify({ studentId, token })
        });
        if ([401,403].includes(response.status)) return res.status(response.status).json({ error: "Student session unavailable. Sign in again." });
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


    if (updateAction === "addStudyLog") {
      // Mongo is the production source of truth. APPS_SCRIPT_URL now points to
      // the narrowly scoped password-reset/proof service, so forwarding this
      // action there would save the row in Mongo and then misleadingly tell the
      // student "This option is not available." Return the authoritative write
      // result immediately instead.
      const saved = await mirrorStudyLogToMongo(studyLogPayload(req), {}, studentHeaders(req));
      return res.status(saved.status).json({ result: saved.result });
    }

    if (STUDENT_WRITES.has(updateAction)) {
      try {
        const upstream = await fetch(`${MENTOR_API_URL}/api/student-dashboard/write`, {
          method: "POST", headers: { "Content-Type": "application/json", ...studentHeaders(req) },
          body: JSON.stringify({ action: updateAction, payload: studyLogPayload(req) })
        });
        if ([401,403].includes(upstream.status)) return res.status(upstream.status).json({ error: "Student session unavailable. Sign in again." });
        const body = await upstream.json();
        if (!upstream.ok || body?.ok !== true || body?.result?.success !== true) {
          return res.status(502).json({ result: { success: false, message: "The change could not be confirmed." } });
        }
        return res.status(200).json({ result: body.result });
      } catch {
        return res.status(502).json({ error: "The change could not be confirmed." });
      }
    }

    if (updateAction === "validateStudent") return res.status(503).json({ error: "Student lookup verification unavailable." });
    if (!["forgotPassword", "verifyOTP", "resetPassword"].includes(updateAction)) {
      return res.status(403).json({ error: "Unreviewed action denied." });
    }
    if (!process.env.APPS_SCRIPT_URL) {
      // Study Log writes have already returned through the authoritative
      // acknowledgement handler above; only other legacy actions reach here.
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
      return res.status(502).json({
        error: "Google server busy hai. 15 second wait karke ek baar phir try karo."
      });
    }

    if (!response.ok) {
      return res.status(502).json({
        error: "Google server busy hai. 15 second wait karke ek baar phir try karo."
      });
    }

    let data;
    try {
      data = JSON.parse(rawText);
    } catch (parseErr) {
      return res.status(502).json({
        error: "Apps Script returned a non-JSON response."
      });
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
