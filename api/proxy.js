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

export default async function handler(req, res) {
  try {
    const updateAction = req.body?.action || req.query?.action;
    if (updateAction === "app.version") {
      return res.status(200).json({
        result: {
          version: process.env.APP_ANDROID_VERSION || "1.10.2",
