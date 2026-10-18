const MAX_PROOF_BYTES = 10 * 1024 * 1024;
const ALLOWED_PROOF_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Student-Id, X-Session-Password, X-File-Name',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Cache-Control': 'no-store',
};

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS, ...headers },
});

const required = (env, name) => {
  const value = String(env[name] || '').trim();
  if (!value) throw new Error(`Gateway secret ${name} is not configured`);
  return value;
};

const upstreamRequest = async (url, init, timeoutMs = 55000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('upstream timeout'), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal, redirect: 'follow' });
  } finally {
    clearTimeout(timer);
  }
};

async function proxyAppsScript(request, env) {
  if (request.method !== 'POST') return json({ error: 'POST required' }, 405);
  const body = await request.arrayBuffer();
  if (body.byteLength > 1024 * 1024) return json({ error: 'JSON request is too large' }, 413);
  const response = await upstreamRequest(required(env, 'APPS_SCRIPT_URL'), {
    method: 'POST',
    headers: { 'Content-Type': request.headers.get('Content-Type') || 'application/json' },
    body,
  });
  return new Response(response.body, {
    status: response.status,
    headers: { 'Content-Type': response.headers.get('Content-Type') || 'application/json', ...CORS_HEADERS },
  });
}

async function proxyMentor(request, env, pathname, search) {
  const origin = new URL(required(env, 'MENTOR_ORIGIN'));
  const suffix = pathname.replace(/^\/api\/mentor/, '') || '/';
  const target = new URL(suffix + search, origin);
  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('cf-connecting-ip');
  headers.delete('x-forwarded-for');
  const serviceToken = String(env.MENTOR_SERVICE_TOKEN || '').trim();
  if (serviceToken) headers.set('Authorization', `Bearer ${serviceToken}`);
  const response = await upstreamRequest(target, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
  });
  return new Response(response.body, {
    status: response.status,
    headers: { 'Content-Type': response.headers.get('Content-Type') || 'application/json', ...CORS_HEADERS },
  });
}

const base64Url = (value) => {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function googleAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64Url(JSON.stringify({
    iss: required(env, 'GOOGLE_SERVICE_ACCOUNT_EMAIL'),
    scope: 'https://www.googleapis.com/auth/drive.file',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3300,
  }));
  const pem = required(env, 'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY').replace(/\\n/g, '\n');
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '')), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const unsigned = `${header}.${claim}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const assertion = `${unsigned}.${base64Url(signature)}`;
  const tokenResponse = await upstreamRequest('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  }, 20000);
  const token = await tokenResponse.json();
  if (!tokenResponse.ok || !token.access_token) throw new Error(`Google token exchange failed (${tokenResponse.status})`);
  return token.access_token;
}

async function authenticateStudent(env, studentId, password) {
  if (!studentId || !password) return false;
  const response = await upstreamRequest(required(env, 'APPS_SCRIPT_URL'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'validateLogin', payload: { studentId, password } }),
  }, 25000);
  if (!response.ok) throw new Error('Authentication service unavailable');
  const data = await response.json();
  return data?.result?.success === true;
}

const safeFileName = (studentId, value) => {
  const leaf = decodeURIComponent(value || 'proof').split(/[\\/]/).pop() || 'proof';
  return `${studentId}_${Date.now()}_${leaf}`.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180);
};

async function uploadProof(request, env) {
  if (request.method !== 'PUT') return json({ error: 'PUT required' }, 405);
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > MAX_PROOF_BYTES) return json({ error: 'Proof must be 10 MB or smaller' }, 413);
  const mimeType = (request.headers.get('Content-Type') || '').split(';')[0].toLowerCase();
  if (!ALLOWED_PROOF_TYPES.has(mimeType)) return json({ error: 'Only PDF, JPEG, PNG or WebP proof is accepted' }, 415);
  const studentId = String(request.headers.get('X-Student-Id') || '').trim().toUpperCase();
  const password = String(request.headers.get('X-Session-Password') || '');
  if (!/^[A-Z0-9_-]{3,40}$/.test(studentId)) return json({ error: 'Invalid student ID' }, 400);
  if (!(await authenticateStudent(env, studentId, password))) return json({ error: 'Session expired. Sign in again.' }, 401);

  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > MAX_PROOF_BYTES) return json({ error: 'Proof must be between 1 byte and 10 MB' }, 413);
  const token = await googleAccessToken(env);
  const boundary = `upm_${crypto.randomUUID().replace(/-/g, '')}`;
  const metadata = JSON.stringify({
    name: safeFileName(studentId, request.headers.get('X-File-Name')),
    parents: [required(env, 'DRIVE_PROOF_FOLDER_ID')],
  });
  const prefix = new TextEncoder().encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`);
  const suffix = new TextEncoder().encode(`\r\n--${boundary}--`);
  const multipart = new Uint8Array(prefix.length + bytes.byteLength + suffix.length);
  multipart.set(prefix, 0); multipart.set(new Uint8Array(bytes), prefix.length); multipart.set(suffix, prefix.length + bytes.byteLength);
  const driveResponse = await upstreamRequest('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: multipart,
  }, 55000);
  const created = await driveResponse.json();
  if (!driveResponse.ok || !created.id) throw new Error(`Drive upload failed (${driveResponse.status})`);
  await upstreamRequest(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(created.id)}/permissions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  }, 20000);
  return json({
    success: true,
    fileId: created.id,
    proofUrl: `https://drive.google.com/file/d/${created.id}/view?usp=sharing`,
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
    const url = new URL(request.url);
    try {
      if (url.pathname === '/health') return json({ ok: true, service: 'upm-emergency-gateway' });
      if (url.pathname === '/api/proxy') return await proxyAppsScript(request, env);
      if (url.pathname === '/api/proof-upload') return await uploadProof(request, env);
      if (url.pathname.startsWith('/api/mentor/')) return await proxyMentor(request, env, url.pathname, url.search);
      return json({ error: 'Not found' }, 404);
    } catch (error) {
      console.error('gateway request failed', error);
      const unavailable = error instanceof Error && (error.name === 'AbortError' || /unavailable|timeout|configured/i.test(error.message));
      return json({ error: unavailable ? 'Upstream service is temporarily unavailable.' : 'Gateway request failed.' }, unavailable ? 503 : 502);
    }
  },
};

export { MAX_PROOF_BYTES, safeFileName };
