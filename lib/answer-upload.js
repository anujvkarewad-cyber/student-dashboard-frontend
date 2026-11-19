/**
 * Mentor-test answer-sheet upload — same-origin relay.
 *
 * The browser cannot reliably cross-origin POST to the owner Apps Script from
 * every student network/extension combination (302 -> script.googleusercontent
 * chain is fine per se, but browser-level interceptors on Google endpoints kill
 * the upload before any response). Every other web API call rides the
 * same-origin /api/* surface, so the answer sheet does too: the student PUTs
 * the raw bytes here, the session is verified against the FastAPI backend
 * (same rule as study proofs), and the file is relayed to the very same
 * Apps Script action the native app uses. The Drive URL returned is the
 * canonical one mentors see in submission review — no storage/contract change.
 */
const MAX_ANSWER_BYTES = 10 * 1024 * 1024; // Same client cap the app enforces.
const ALLOWED_ANSWER_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/** The owner Apps Script that stores answer sheets on Drive (same as web/mobile). */
export const ANSWER_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbzyfWa8agayMB0XLjkbfhfj2MdIRElAiY2Wnd7-eQKd1zlMl099ky6Cif06TWydzr8D/exec";

/** The session is only as good as the backend says it is. */
export async function authenticateStudent(mentorApiUrl, studentId, password) {
  if (!studentId || !password || !mentorApiUrl) return false;
  const response = await fetch(`${mentorApiUrl}/api/student-auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ studentId, password }),
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) throw new Error("Authentication service unavailable");
  const data = await response.json();
  const result = (data && data.result) || data;
  return Boolean(
    result
    && result.success === true
    && data?.success !== false
    && data?.ok !== false
    && !data?.error
    && (result?.ok !== false)
    && !result?.error
    && typeof result.studentId === "string"
    && result.studentId.trim().toUpperCase() === studentId,
  );
}

export function safeAnswerFileName(studentId, value) {
  const leaf = decodeURIComponent(value || "answer").split(/[\\/]/).pop() || "answer";
  return `${studentId}_${Date.now()}_${leaf}`.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180);
}

/**
 * @returns {Promise<{status: number, body: object}>}
 */
export async function handleAnswerUpload({ method, headers, readBody, mentorApiUrl, env }) {
  if (method !== "PUT") return { status: 405, body: { error: "PUT required" } };

  const declared = Number(headers["content-length"] || 0);
  if (declared > MAX_ANSWER_BYTES) {
    return { status: 413, body: { error: "Answer sheet must be 10 MB or smaller" } };
  }

  const mimeType = String(headers["content-type"] || "").split(";")[0].toLowerCase();
  if (!ALLOWED_ANSWER_TYPES.has(mimeType)) {
    return { status: 415, body: { error: "Only PDF, JPEG, PNG or WebP answers are accepted" } };
  }

  const studentId = String(headers["x-student-id"] || "").trim().toUpperCase();
  const password = String(headers["x-session-password"] || "");
  if (!/^[A-Z0-9_-]{3,40}$/.test(studentId)) {
    return { status: 400, body: { error: "Invalid student ID" } };
  }

  let authorised;
  try {
    authorised = await authenticateStudent(mentorApiUrl, studentId, password);
  } catch (err) {
    console.error("[answer] auth verification failed.");
    return { status: 503, body: { error: "Could not verify your session. Please try again." } };
  }
  if (!authorised) return { status: 401, body: { error: "Session expired. Sign in again." } };

  const bytes = await readBody(MAX_ANSWER_BYTES + 1);
  if (!bytes.length || bytes.length > MAX_ANSWER_BYTES) {
    return { status: 413, body: { error: "Answer sheet must be between 1 byte and 10 MB" } };
  }

  const fileName = safeAnswerFileName(studentId, headers["x-file-name"]);
  const scriptUrl = String(env?.ANSWER_SCRIPT_URL || "").trim() || ANSWER_SCRIPT_URL;
  let data = null;
  try {
    const upstream = await fetch(scriptUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "student.test.uploadSubmission",
        payload: { base64: Buffer.from(bytes).toString("base64"), mimeType, filename: fileName },
      }),
      redirect: "follow",
      signal: AbortSignal.timeout(120000),
    });
    const raw = await upstream.text();
    try { data = JSON.parse(raw); } catch { data = null; }
    if (!upstream.ok) data = null;
  } catch (err) {
    console.error("[answer] relay to Apps Script failed:", err && err.name);
    return { status: 502, body: { error: "Upload could not be confirmed. Keep the original file and check before retrying." } };
  }

  // Same acceptance rule the client already enforces: a non-empty Drive URL
  // under result (string) or result.url — nothing else counts as stored.
  const result = data?.result;
  const url = typeof result === "string" ? result : result?.url;
  const refused = !data || data.error || data.ok === false || data.success === false
    || result?.error || result?.ok === false || result?.success === false;
  if (refused || typeof url !== "string" || !url.trim()) {
    console.error("[answer] relay rejected by Apps Script or malformed ack.");
    return { status: 502, body: { error: "Upload could not be confirmed. Keep the original file and check before retrying." } };
  }
  return { status: 200, body: { result: url } };
}
