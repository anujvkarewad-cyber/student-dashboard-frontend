/**
 * Study-proof upload, ported from the Cloudflare worker (cloudflare/src/worker.js)
 * so the Android app can use a single Cloud Run origin for everything.
 *
 * The student uploads the raw file bytes with PUT; the session is verified
 * against the FastAPI backend, then the file is pushed to the shared Drive
 * folder with a service account and made link-readable.
 *
 * Required environment:
 *   GOOGLE_SERVICE_ACCOUNT_JSON   the whole key file (easiest), OR
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
 *   DRIVE_PROOF_FOLDER_ID         folder the proofs land in
 *
 * Without those the route reports "not configured" instead of failing oddly.
 */

export const MAX_PROOF_BYTES = 10 * 1024 * 1024;

export const ALLOWED_PROOF_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function proofConfig(env = process.env) {
  let email = String(env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "").trim();
  let privateKey = String(env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "").trim();

  const raw = String(env.GOOGLE_SERVICE_ACCOUNT_JSON || "").trim();
  if (raw && (!email || !privateKey)) {
    try {
      const parsed = JSON.parse(raw);
      email = email || String(parsed.client_email || "").trim();
      privateKey = privateKey || String(parsed.private_key || "").trim();
    } catch (err) {
      console.error("[proof] GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON:", err && err.message);
    }
  }

  return {
    email,
    privateKey: privateKey.replace(/\\n/g, "\n"),
    folderId: String(env.DRIVE_PROOF_FOLDER_ID || "").trim(),
    get configured() {
      return Boolean(this.email && this.privateKey && this.folderId);
    },
  };
}

const base64Url = (value) => {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
  return Buffer.from(bytes).toString("base64url");
};

let tokenCache = { value: "", expiresAt: 0 };

async function googleAccessToken(cfg) {
  // Drive tokens last an hour; minting one per upload would add a round trip
  // to every study log at the 10 pm submission rush.
  if (tokenCache.value && Date.now() < tokenCache.expiresAt) return tokenCache.value;

  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(JSON.stringify({
    iss: cfg.email,
    scope: "https://www.googleapis.com/auth/drive.file",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3300,
  }));

  const der = Buffer.from(
    cfg.privateKey.replace(/-----[^-]+-----/g, "").replace(/\s/g, ""),
    "base64",
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const unsigned = `${header}.${claim}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  const assertion = `${unsigned}.${base64Url(signature)}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    signal: AbortSignal.timeout(20000),
  });
  const token = await response.json();
  if (!response.ok || !token.access_token) {
    throw new Error(`Google token exchange failed (${response.status})`);
  }
  tokenCache = {
    value: token.access_token,
    expiresAt: Date.now() + Math.max(60, Number(token.expires_in || 3600) - 300) * 1000,
  };
  return tokenCache.value;
}

export function safeFileName(studentId, value) {
  const leaf = decodeURIComponent(value || "proof").split(/[\\/]/).pop() || "proof";
  return `${studentId}_${Date.now()}_${leaf}`.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180);
}

/** The session is only as good as the backend says it is. */
async function authenticateStudent(mentorApiUrl, studentId, password) {
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
  return result && result.success === true;
}

/**
 * @returns {Promise<{status: number, body: object}>}
 */
export async function handleProofUpload({ method, headers, readBody, mentorApiUrl, env }) {
  const cfg = proofConfig(env);
  if (!cfg.configured) {
    return {
      status: 501,
      body: { error: "Proof upload is not configured on this server." },
    };
  }
  if (method !== "PUT") return { status: 405, body: { error: "PUT required" } };

  const declared = Number(headers["content-length"] || 0);
  if (declared > MAX_PROOF_BYTES) {
    return { status: 413, body: { error: "Proof must be 10 MB or smaller" } };
  }

  const mimeType = String(headers["content-type"] || "").split(";")[0].toLowerCase();
  if (!ALLOWED_PROOF_TYPES.has(mimeType)) {
    return { status: 415, body: { error: "Only PDF, JPEG, PNG or WebP proof is accepted" } };
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
    console.error("[proof] auth failed:", err && err.message);
    return { status: 503, body: { error: "Could not verify your session. Please try again." } };
  }
  if (!authorised) return { status: 401, body: { error: "Session expired. Sign in again." } };

  const bytes = await readBody(MAX_PROOF_BYTES);
  if (!bytes.length) {
    return { status: 413, body: { error: "Proof must be between 1 byte and 10 MB" } };
  }

  const token = await googleAccessToken(cfg);
  const boundary = `upm_${crypto.randomUUID().replace(/-/g, "")}`;
  const metadata = JSON.stringify({
    name: safeFileName(studentId, headers["x-file-name"]),
    parents: [cfg.folderId],
  });
  const multipart = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
      `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const driveResponse = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: multipart,
      signal: AbortSignal.timeout(120000),
    },
  );
  const created = await driveResponse.json();
  if (!driveResponse.ok || !created.id) {
    throw new Error(`Drive upload failed (${driveResponse.status})`);
  }

  await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(created.id)}/permissions`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ role: "reader", type: "anyone" }),
      signal: AbortSignal.timeout(20000),
    },
  );

  return {
    status: 200,
    body: {
      success: true,
      fileId: created.id,
      proofUrl: `https://drive.google.com/file/d/${created.id}/view?usp=sharing`,
    },
  };
}
