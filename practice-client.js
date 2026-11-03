/* Authenticated practice transport. Never stores capability tokens or audio. */
(function (root) {
  'use strict';
  let capability = null;   // live practice token, page memory only
  let pending = null;      // one sign-in flow at a time
  let nativeWaiter = null;
  const base = '/api/mentor/api/practice';
  const sessionPath = root.document?.currentScript?.dataset?.practiceScope === 'workbook' ? '/workbooks/session' : '/session';
  const TTL = 14 * 60 * 1000; // backend tokens live 15 minutes

  function onNative(event) {
    if (!root.ReactNativeWebView || !nativeWaiter) return;
    if ((event.source && event.source !== root) || (event.origin && event.origin !== root.location.origin)) return;
    let message; try { message = JSON.parse(event.data); } catch (_) { return; }
    if (message.type !== 'practice-session') return;
    if (message.error) { const reject = nativeWaiter.reject; nativeWaiter = null; reject(new Error(message.error)); return; }
    if (typeof message.token !== 'string' || !message.token || typeof message.studentId !== 'string' || !message.studentId) return;
    capability = { token: message.token, studentId: message.studentId, expires: Date.now() + TTL };
    const resolve = nativeWaiter.resolve; nativeWaiter = null; resolve(capability);
  }
  if (root.addEventListener) { root.addEventListener('message', onNative); root.document?.addEventListener('message', onNative); }

  function stored() {
    try {
      const value = JSON.parse(root.localStorage?.getItem('ump_student') || 'null');
      if (value && typeof value.studentId === 'string' && value.studentId.trim() && typeof value.password === 'string' && value.password) return value;
    } catch (_) { /* fail closed */ }
    return null;
  }
  function remember(credentials) { try { root.localStorage?.setItem('ump_student', JSON.stringify(credentials)); } catch (_) { /* best effort */ } }
  function forgetSaved() { try { root.localStorage?.removeItem('ump_student'); } catch (_) { /* best effort */ } }

  async function mint(credentials) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const r = await root.fetch(base + sessionPath, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ studentId: credentials.studentId, password: credentials.password }), signal: controller.signal });
      let data = {}; try { data = await r.json(); } catch (_) { /* handled below */ }
      if (!r.ok || typeof data.token !== 'string' || !data.token) throw new Error(typeof data.detail === 'string' ? data.detail : 'Practice sign-in is unavailable. Your work is safe.');
      capability = { token: data.token, studentId: String(data.studentId), expires: Date.now() + TTL };
      remember({ studentId: credentials.studentId, password: credentials.password });
      return capability;
    } finally { clearTimeout(timer); }
  }

  /**
   * Hardened in-page sign-in: shown when the app shell never answers the
   * WebView handshake (older builds) or a pure browser has no saved session.
   */
  function askInPage() {
    return new Promise((resolve, reject) => {
      const doc = root.document;
      if (!doc || !doc.body) return reject(new Error('Sign in to the student dashboard first.'));
      doc.getElementById('ump-practice-signin')?.remove();
      const box = doc.createElement('div');
      box.id = 'ump-practice-signin';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-label', 'Practice sign in');
      box.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:99999;background:#17243b;color:#f3f6fb;padding:18px;border-radius:16px;box-shadow:0 12px 34px rgba(0,0,0,.4);font:15px system-ui,sans-serif;max-width:460px;margin:0 auto';
      const title = doc.createElement('strong'); title.style.fontSize = '16px'; title.textContent = 'Secure practice sign-in';
      const note = doc.createElement('p'); note.style.cssText = 'margin:8px 0 12px;opacity:.85;line-height:1.5'; note.textContent = 'Enter your student ID and password to open this workbook. Your dashboard stays unchanged.';
      const sid = doc.createElement('input'); sid.placeholder = 'Student ID'; sid.autocomplete = 'off'; sid.autocapitalize = 'characters'; sid.setAttribute('aria-label', 'Student ID');
      sid.style.cssText = 'display:block;width:100%;box-sizing:border-box;margin:0 0 10px;padding:12px;border-radius:10px;border:0;font:16px system-ui';
      const pwd = doc.createElement('input'); pwd.type = 'password'; pwd.placeholder = 'Password'; pwd.setAttribute('aria-label', 'Password');
      pwd.style.cssText = sid.style.cssText;
      const btn = doc.createElement('button'); btn.textContent = 'Sign in';
      btn.style.cssText = 'width:100%;padding:12px;border:0;border-radius:10px;background:#4f8dd6;color:#fff;font:600 16px system-ui;cursor:pointer';
      const msg = doc.createElement('div'); msg.style.cssText = 'margin-top:10px;min-height:18px;color:#fda4a4;font-size:13px';
      btn.onclick = () => {
        const studentId = sid.value.trim().toUpperCase(), password = pwd.value;
        if (!studentId || !password) { msg.textContent = 'Student ID and password dono chahiye.'; return; }
        btn.disabled = true; msg.textContent = 'Signing in…';
        box.remove();
        resolve({ studentId, password });
      };
      [pwd, sid].forEach(el => el.addEventListener('keydown', e => { if (e.key === 'Enter') btn.click(); }));
      box.append(title, note, sid, pwd, btn, msg);
      doc.body.appendChild(box);
      sid.focus();
    });
  }

  function nativeHandshake() {
    return new Promise((resolve, reject) => {
      // Ask the shell for a session; if the first frame is missed, re-ask
      // every 5s — one dropped WebView message must never strand the page.
      const settle = fn => value => { clearTimeout(timer); clearInterval(repost); fn(value); };
      nativeWaiter = { resolve: v => settle(resolve)(v), reject: e => settle(reject)(e) };
      const timer = setTimeout(() => { nativeWaiter = null; settle(reject)(new Error('The app shell did not answer.')); }, 45000);
      const repost = setInterval(() => { try { root.ReactNativeWebView.postMessage(JSON.stringify({ type: 'practice-ready' })); } catch (_) { clearInterval(repost); } }, 5000);
      root.ReactNativeWebView.postMessage(JSON.stringify({ type: 'practice-ready' }));
    });
  }

  async function obtain() {
    if (capability && capability.expires > Date.now()) return capability;
    const saved = stored();
    const inWebView = Boolean(root.ReactNativeWebView);
    if (saved) {
      try { return await mint(saved); }
      catch (err) {
        // Saved credentials can go stale (password changed). Only the app
        // WebView may forget them silently; the student browser keeps them.
        if (!inWebView) throw err;
        forgetSaved();
      }
    }
    if (inWebView) {
      try { return await nativeHandshake(); }
      catch (_) { return mint(await askInPage()); } // shell silent on old builds: sign in once here
    }
    return mint(await askInPage());
  }

  async function session() {
    if (capability && capability.expires > Date.now()) return capability;
    if (!pending) pending = obtain().finally(() => { pending = null; });
    return pending;
  }
  async function request(path, body, contentType = 'application/json', signal) {
    const current = await session();
    const controller = new AbortController(); const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 60000);
    try {
      const r = await root.fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'X-Practice-Token': current.token, 'Content-Type': contentType }, body: body === undefined ? undefined : contentType === 'application/json' ? JSON.stringify(body) : body, signal: controller.signal });
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
      const r = await root.fetch(base + '/workbooks/' + encodeURIComponent(bookId) + '/pdf', { headers: { 'X-Practice-Token': current.token }, signal: controller.signal });
      if (!r.ok) { const result = await r.json(); throw new Error(result.detail || 'Workbook PDF could not load.'); }
      return new Uint8Array(await r.arrayBuffer());
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  function appendReviewed(oldText, transcript) { return [String(oldText || '').trim(), String(transcript || '').trim()].filter(Boolean).join('\n'); }
  root.UMP_PRACTICE = { session, request, pdf, appendReviewed, clear: () => { capability = null; } };
})(typeof window !== 'undefined' ? window : globalThis);
