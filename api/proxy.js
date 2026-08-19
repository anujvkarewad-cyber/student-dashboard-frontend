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

// Stay under Vercel function limit. vercel.json is 60s; keep a 50s budget.
const BUDGET_MS = 50000;
const ATTEMPT_MS = 18000;

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
  // Retry only if the first fail was relatively quick and we still have time.
  if (retryable && elapsed < 12000 && remaining > 14000) {
    await sleep(800 + Math.floor(Math.random() * 800));
    return attemptOnce(url, body, Math.min(ATTEMPT_MS, BUDGET_MS - (Date.now() - started)));
  }
  return first;
}

export default async function handler(req, res) {
  try {

    // ── app.version: served directly from Vercel env vars (no Apps Script) ──
    const updateAction = req.body?.action || req.query?.action;
    if (updateAction === "app.version") {
      return res.status(200).json({
        result: {
          version: process.env.APP_ANDROID_VERSION || "1.10.2",
          versionCode: Number(process.env.APP_ANDROID_VERSION_CODE || 16),
          minimumVersionCode: Number(process.env.APP_ANDROID_MIN_VERSION_CODE || 15),
          apkUrl: process.env.APP_ANDROID_APK_URL || "",
          releaseNotes: process.env.APP_ANDROID_RELEASE_NOTES || "",
          forceUpdate: String(process.env.APP_ANDROID_FORCE_UPDATE || "false").toLowerCase() === "true",
          publishedAt: process.env.APP_ANDROID_PUBLISHED_AT || new Date().toISOString().slice(0, 10)
        }
      });
    }

    if (!process.env.APPS_SCRIPT_URL) {
      console.error("APPS_SCRIPT_URL env var is not set on this deployment");
      return res.status(500).json({
        error: "Server misconfigured: APPS_SCRIPT_URL is missing. Set it in Vercel → Project → Settings → Environment Variables."
      });
    }

    const body = JSON.stringify(req.body);
    console.log("action:", req.body && req.body.action, "| payload size(bytes):", body.length);

    let response;
    let rawText;
    try {
      ({ response, rawText } = await postAppsScript(process.env.APPS_SCRIPT_URL, body));
    } catch (fetchErr) {
      console.error("Apps Script fetch failed:", fetchErr);
      return res.status(502).json({
        error: "Google server busy hai. 15 second wait karke ek baar phir try karo."
      });
    }

    if (!response.ok) {
      console.error("Apps Script responded with", response.status, String(rawText || "").slice(0, 500));
      return res.status(502).json({
        error: "Google server busy hai. 15 second wait karke ek baar phir try karo."
      });
    }

    let data;
    try {
      data = JSON.parse(rawText);
    } catch (parseErr) {
      const action = req.body?.action || "unknown";
      const preview = String(rawText || "").slice(0, 500).replace(/\s+/g, " ");
      console.error(`[${action}] Apps Script did not return valid JSON:`, preview);
      return res.status(502).json({
        error: `[${action}] Apps Script returned a non-JSON response.`,
        ...(process.env.NODE_ENV !== "production" ? { upstreamPreview: preview } : {})
      });
    }

    return res.status(200).json(data);

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: err.message
    });
  }
}
