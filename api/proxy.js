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
const MENTOR_API_URL = (process.env.MENTOR_API_URL || "https://ujjwal-pathak-mentor-api.onrender.com").replace(/\/$/, "");
const MONGO_LOGIN_ACTIONS = new Set(["validateLogin", "changePassword"]);
const MONGO_DASHBOARD_ACTIONS = new Set([
  "getStats",
  "getStudyLog",
  "getWeeklyReports",
  "getAnnouncements",
  "getLeaderboard",
  "getStudentMentorNotes",
  "getStudentFeedback"
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

async function postAppsScript(url, body) {
  const started = Date.now();
  const first = await attemptOnce(url, body, ATTEMPT_MS);
  const elapsed = Date.now() - started;
  const retryable = !first.response.ok && RETRY_STATUSES.has(first.response.status);
  const remaining = BUDGET_MS - elapsed;
  if (retryable && elapsed < 12000 && remaining > 14000) {
    await sleep(800 + Math.floor(Math.random() * 800));
    return attemptOnce(url, body, Math.min(ATTEMPT_MS, BUDGET_MS - (Date.now() - started)));
  }
  return first;
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
    if (result && result.success === true) return { result };
    if (result && result.code === "wrong_password") return { result };
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
    const result = data.result || data;
    if (result && result.success === true) return { result };
    return null;
  }
  return null;
}

async function mirrorStudyLogToMongo(payload, gasResult) {
  const hosts = [MENTOR_API_URL, "https://ujjwal-pathak-project.onrender.com"];
  const body = JSON.stringify({ action: "addStudyLog", payload, result: gasResult || {} });
  for (let i = 0; i < hosts.length; i++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(function () { controller.abort(); }, 12000);
      const response = await fetch(hosts[i] + "/api/student-dashboard/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: controller.signal
      });
      clearTimeout(timer);
      if (response.ok) return;
    } catch (err) {
      console.error("Mongo study-log mirror failed:", hosts[i], err && err.message);
    }
  }
}

export default async function handler(req, res) {
  try {
    const updateAction = req.body?.action || req.query?.action;
    if (updateAction === "app.version") {
      return res.status(200).json({
        result: {
          version: process.env.APP_ANDROID_VERSION || "1.10.4",
          versionCode: Number(process.env.APP_ANDROID_VERSION_CODE || 19),
          minimumVersionCode: Number(process.env.APP_ANDROID_MIN_VERSION_CODE || 17),
          apkUrl: process.env.APP_ANDROID_APK_URL || "",
          releaseNotes: process.env.APP_ANDROID_RELEASE_NOTES || "",
          forceUpdate: String(process.env.APP_ANDROID_FORCE_UPDATE || "false").toLowerCase() === "true",
          publishedAt: process.env.APP_ANDROID_PUBLISHED_AT || new Date().toISOString().slice(0, 10)
        }
      });
    }

    if (MONGO_LOGIN_ACTIONS.has(updateAction)) {
      try {
        const mongoHit = await tryMongoLogin(req);
        if (mongoHit) return res.status(200).json(mongoHit);
      } catch (mongoErr) {
        console.error("Mongo login fallback to Apps Script:", mongoErr && mongoErr.message);
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
      await mirrorStudyLogToMongo(studyLogPayload(req), {});
    }

    if (!process.env.APPS_SCRIPT_URL) {
      return res.status(500).json({
        error: "Server misconfigured: APPS_SCRIPT_URL is missing."
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

    return res.status(200).json(data);

  } catch (err) {
    return res.status(500).json({
      error: err.message
    });
  }
}
