/* Authenticated practice transport. Never stores capability tokens or audio. */
(function (root) {
  'use strict';
  let capability = null;
  let nativeWaiter = null;
  let nativePromise = null;
  const base = '/api/mentor/api/practice';
  function onNative(event) {
    if (!root.ReactNativeWebView || !nativeWaiter) return;
    if ((event.source && event.source !== root) || (event.origin && event.origin !== root.location.origin)) return;
    let message; try { message = JSON.parse(event.data); } catch (_) { return; }
    if (message.type !== 'practice-session') return;
    if (message.error) { nativeWaiter?.reject(new Error(message.error)); nativeWaiter = null; return; }
    if (typeof message.token !== 'string' || !message.token || typeof message.studentId !== 'string' || !message.studentId) return;
    capability = { token: message.token, studentId: message.studentId, expires: Date.now() + 14 * 60 * 1000 };
    nativeWaiter?.resolve(capability); nativeWaiter = null;
  }
  if (root.addEventListener) { root.addEventListener('message', onNative); root.document?.addEventListener('message', onNative); }
  async function session() {
    if (root.ReactNativeWebView) {
      if (capability && capability.expires > Date.now()) return capability;
      if (nativePromise) return nativePromise;
      nativePromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => { nativeWaiter = null; reject(new Error('Reopen the workbook to sign in again.')); }, 22000);
        nativeWaiter = { resolve: value => { clearTimeout(timer); resolve(value); }, reject: e => { clearTimeout(timer); reject(e); } };
        root.ReactNativeWebView.postMessage(JSON.stringify({ type: 'practice-ready' }));
      }).finally(() => { nativePromise = null; });
      return nativePromise;
    }
    let credentials; try { credentials = JSON.parse(root.localStorage.getItem('ump_student') || 'null'); } catch (_) { /* fail closed */ }
    if (!credentials?.studentId || !credentials.password) throw new Error('Sign in to the student dashboard first.');
    if (capability?.studentId === credentials.studentId && capability.expires > Date.now()) return capability;
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const r = await fetch(base + '/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ studentId: credentials.studentId, password: credentials.password }), signal: controller.signal });
      const data = await r.json();
      if (!r.ok || !data.token) throw new Error(typeof data.detail === 'string' ? data.detail : 'Practice sign-in failed.');
      capability = { token: data.token, studentId: data.studentId, expires: Date.now() + 14 * 60 * 1000 }; return capability;
    } finally { clearTimeout(timer); }
  }
  async function request(path, body, contentType = 'application/json', signal) {
    const current = await session();
    const controller = new AbortController(); const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 60000);
    try {
      const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'X-Practice-Token': current.token, 'Content-Type': contentType }, body: body === undefined ? undefined : contentType === 'application/json' ? JSON.stringify(body) : body, signal: controller.signal });
      const data = await r.json();
      if (r.status === 401) capability = null;
      if (!r.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Processing unavailable. Keep your draft and retry.');
      return data;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  async function pdf(bookId, signal) {
    const current = await session(); const controller = new AbortController(); const abort = () => controller.abort();
    if (signal?.aborted) controller.abort(); signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 40000);
    try {
      const r = await fetch(base + '/workbooks/' + encodeURIComponent(bookId) + '/pdf', { headers: { 'X-Practice-Token': current.token }, signal: controller.signal });
      if (!r.ok) { const result = await r.json(); throw new Error(result.detail || 'Workbook PDF could not load.'); }
      return new Uint8Array(await r.arrayBuffer());
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  function appendReviewed(oldText, transcript) { return [String(oldText || '').trim(), String(transcript || '').trim()].filter(Boolean).join('\n'); }
  root.UMP_PRACTICE = { session, request, pdf, appendReviewed, clear: () => { capability = null; } };
})(typeof window !== 'undefined' ? window : globalThis);
