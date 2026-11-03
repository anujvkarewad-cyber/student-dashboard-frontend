import { uploadPrivateProof, retrievePrivateProof, checkPrivateProofDestination, bindPrivateProof, stripPublicProofGrants, PRIVATE_PROOF_PROTOCOL } from './private-proof.js';
/**
 * Study-proof upload, ported from the Cloudflare worker (cloudflare/src/worker.js)
 * so the Android app can use a single Cloud Run origin for everything.
 *
 * The student uploads the raw file bytes with PUT; the session is verified
 * against the FastAPI backend, then the file is pushed to the shared Drive
 * folder with a service account and returned through owner-only retrieval.
 * Unknown legacy Script upload/sharing is never invoked. A verified private,
 * upload-capable destination is required; unsupported clients/providers deny.
 *
 * Private storage: GOOGLE_SERVICE_ACCOUNT_JSON or the existing email/key pair,
 * and DRIVE_PROOF_FOLDER_ID in an exclusively private, upload-capable Shared Drive.
 * Legacy Script configuration remains recognizable but never authorizes uploads.
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
      console.error("[proof] Service-account configuration is invalid.");
    }
  }

  return {
    email,
    privateKey: privateKey.replace(/\\n/g, "\n"),
    folderId: String(env.DRIVE_PROOF_FOLDER_ID || "").trim(),
    scriptUrl: String(env.APPS_SCRIPT_URL || "").trim(),
    scriptKey: String(env.PROOF_UPLOAD_KEY || "").trim(),
    get directDriveConfigured() {
      return Boolean(this.email && this.privateKey && this.folderId);
    },
    get appsScriptConfigured() {
      return Boolean(this.scriptUrl && this.scriptKey);
    },
    get configured() {
      return this.directDriveConfigured;
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
    // Full Drive scope: proof files are created by the owner-side Apps Script
    // (a different app identity), so drive.file would never let this service
    // account verify/bind/read them. Full scope is required — and the account
    // remains confined to its own shared proofs folder by Drive ACLs anyway.
    scope: "https://www.googleapis.com/auth/drive",
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
async function authenticateStudent(mentorApiUrl, studentId, password, strict = true) {
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
  return result && result.success === true && (!strict || (data?.success !== false && data?.ok !== false && !data?.error && result?.ok !== false && !result?.error && typeof result.studentId === "string" && result.studentId.trim().toUpperCase() === studentId));
}

/**
 * Owner-controlled upload: hardened Apps Script endpoint stores the proof as
 * the real Drive owner (service accounts carry no consumer storage quota).
 */
async function uploadViaAppsScript(cfg, { studentId, fileName, mimeType, bytes }) {
  const response = await fetch(cfg.scriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'uploadProof',
      payload: { uploadKey: cfg.scriptKey, studentId, fileName, mimeType, base64: Buffer.from(bytes).toString('base64') },
    }),
    redirect: 'follow',
    signal: AbortSignal.timeout(120000),
  });
  const raw = await response.text();
  let data = {};
  try { data = JSON.parse(raw); } catch {}
  const result = (data && data.result) || data || {};
  if (!response.ok || result.success !== true || typeof result.fileId !== 'string' || !/^[A-Za-z0-9_-]{5,200}$/.test(result.fileId)) {
    throw new Error(`Apps Script proof upload failed (${response.status})`);
  }
  // The upstream link is only echoed to legacy clients that already expect it;
  // modern clients always receive the canonical /api/proof-file URL instead.
  const legacyUrl = typeof result.proofUrl === 'string' && /^https:\/\//.test(result.proofUrl) ? result.proofUrl : '';
  return { fileId: result.fileId, legacyUrl };
}

/**
 * @returns {Promise<{status: number, body: object}>}
 */
export async function handleProofUpload({ method, headers, readBody, mentorApiUrl, env }) {
  const cfg = proofConfig(env);
  const legacyClient = headers["x-proof-protocol"] !== "private-v1";
  if (legacyClient ? !cfg.appsScriptConfigured : !cfg.directDriveConfigured) {
    return legacyClient
      ? {status:409, body:{error:"This upload requires a compatible private-proof client."}}
      : {status:503, body:{error:"Private proof storage is unavailable; no legacy upload was attempted."}};
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
    authorised = await authenticateStudent(mentorApiUrl, studentId, password,true);
  } catch (err) {
    console.error("[proof] auth verification failed.");
    return { status: 503, body: { error: "Could not verify your session. Please try again." } };
  }
  if (!authorised) return { status: 401, body: { error: "Session expired. Sign in again." } };

  const bytes = await readBody(MAX_PROOF_BYTES);
  if (!bytes.length) {
    return { status: 413, body: { error: "Proof must be between 1 byte and 10 MB" } };
  }

  const uploadInput = { studentId, fileName:safeFileName(studentId, headers["x-file-name"]), mimeType, bytes };
  if (legacyClient) {
    // Old APKs cannot open the header-gated /api/proof-file URL, so they keep
    // receiving the owner script's own link — exactly the pre-private dialect.
    const legacy = await uploadViaAppsScript(cfg, uploadInput);
    return { status: 200, body: { success: true, fileId: legacy.fileId, proofUrl: legacy.legacyUrl || `/api/proof-file?fileId=${encodeURIComponent(legacy.fileId)}` } };
  }
  const token = await googleAccessToken(cfg);
  try {
    const body = await uploadPrivateProof({ ...uploadInput, folderId:cfg.folderId, principal:cfg.email, token });
    return {status:200,body};
  } catch (directErr) {
    if (!cfg.appsScriptConfigured) throw directErr;
    const uploaded = await uploadViaAppsScript(cfg, uploadInput);
    await bindPrivateProof(uploaded.fileId, studentId, token);
    // The script shares every upload "anyone with the link" for old APKs; modern
    // clients get only /api/proof-file, and requirePrivateAcl must not see a
    // public grant on a bound proof (29-Oct-2026 read-outage fix).
    await stripPublicProofGrants(uploaded.fileId, token);
    return {status:200, body:{ success:true, fileId:uploaded.fileId, proofUrl:`/api/proof-file?fileId=${encodeURIComponent(uploaded.fileId)}` }};
  }
}


/** Owner-only new-file retrieval. Legacy/unbound files never acquire authority from their ID. */
export async function handlePrivateProofRead({method,headers,fileId,mentorApiUrl,env}) {
  if (method !== 'GET') return {status:405,body:{error:'GET required'}};
  const cfg=proofConfig(env);
  if (!cfg.directDriveConfigured) return {status:503,body:{error:'Private proof retrieval is unavailable.'}};
  const studentId=String(headers['x-student-id']||'').trim().toUpperCase();
  const password=String(headers['x-session-password']||'');
  if (!/^[A-Z0-9_-]{3,40}$/.test(studentId) || !password) return {status:401,body:{error:'Student authentication required.'}};
  if (!(await authenticateStudent(mentorApiUrl,studentId,password,true))) return {status:401,body:{error:'Student authentication required.'}};
  return retrievePrivateProof({fileId,studentId,principal:cfg.email,token:await googleAccessToken(cfg)});
}


export async function handlePrivateProofCapabilities({method,headers,mentorApiUrl,env}) {
  if(method!=='GET')return{status:405,body:{error:'GET required'}};
  const cfg=proofConfig(env),studentId=String(headers['x-student-id']||'').trim().toUpperCase(),password=String(headers['x-session-password']||'');
  if(!cfg.directDriveConfigured)return{status:503,body:{error:'Verified private proof storage is unavailable.'}};
  if(!/^[A-Z0-9_-]{3,40}$/.test(studentId) || !(await authenticateStudent(mentorApiUrl,studentId,password,true)))return{status:401,body:{error:'Student authentication required.'}};
  try {
    return{status:200,body:await checkPrivateProofDestination({folderId:cfg.folderId,principal:cfg.email,token:await googleAccessToken(cfg)})};
  } catch (err) {
    // Direct Drive writes can lack consumer-quota support; the hardened owner
    // script endpoint keeps the private path available without downgrading.
    if(!cfg.appsScriptConfigured)throw err;
    return{status:200,body:{protocol:PRIVATE_PROOF_PROTOCOL,private:true,maxBytes:MAX_PROOF_BYTES}};
  }
}
