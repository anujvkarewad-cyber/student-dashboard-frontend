import assert from 'node:assert/strict';
import test from 'node:test';
import { handleAnswerUpload } from '../lib/answer-upload.js';

const BYTES = Buffer.from('synthetic-answer-sheet-bytes');

function harness({ method='PUT', headers={}, authOk=true, authThrows=false, scriptOk=true, scriptBody=null, bytes=BYTES } = {}) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    if (String(url).includes('/api/student-auth/login')) {
      if (authThrows) throw new Error('auth down');
      return { ok: true, json: async () => authOk ? { result: { success: true, studentId: 'UMP0001' } } : { result: { success: false, code: 'wrong_password' } } };
    }
    if (scriptBody) return { ok: scriptOk, text: async () => JSON.stringify(scriptBody) };
    return { ok: scriptOk, text: async () => scriptOk ? JSON.stringify({ result: { url: 'https://synthetic.invalid/drive/file' } }) : JSON.stringify({ error: 'Unauthorized' }) };
  };
  const readBody = async () => bytes;
  const req = { method, headers: { 'content-type': 'application/pdf', 'content-length': String(bytes.length), 'x-student-id': 'UMP0001', 'x-session-password': 'synthetic', 'x-file-name': 'synthetic.pdf', ...headers }, readBody, mentorApiUrl: 'https://mentor.invalid', env: {} };
  return { calls, req, restore: () => { globalThis.fetch = original; } };
}

test('rejects non-PUT methods before any upstream call', async () => {
  const h = harness({ method: 'POST' }); try { const r = await handleAnswerUpload(h.req); assert.equal(r.status, 405); assert.equal(h.calls.length, 0); } finally { h.restore(); }
});

test('rejects declared oversize before reading the body', async () => {
  const h = harness({ headers: { 'content-length': String(11 * 1024 * 1024) } }); try { const r = await handleAnswerUpload(h.req); assert.equal(r.status, 413); assert.equal(h.calls.length, 0); } finally { h.restore(); }
});

test('rejects unsupported media types', async () => {
  const h = harness({ headers: { 'content-type': 'application/zip' } }); try { const r = await handleAnswerUpload(h.req); assert.equal(r.status, 415); assert.equal(h.calls.length, 0); } finally { h.restore(); }
});

test('rejects malformed student IDs', async () => {
  const h = harness({ headers: { 'x-student-id': '../../etc' } }); try { const r = await handleAnswerUpload(h.req); assert.equal(r.status, 400); assert.equal(h.calls.length, 0); } finally { h.restore(); }
});

test('wrong password never reaches the relay (401)', async () => {
  const h = harness({ authOk: false }); try { const r = await handleAnswerUpload(h.req); assert.equal(r.status, 401); assert.equal(h.calls.length, 1); assert.equal(h.calls[0].url.includes('student-auth'), true); } finally { h.restore(); }
});

test('auth service outage yields 503 and relays nothing', async () => {
  const h = harness({ authThrows: true }); try { const r = await handleAnswerUpload(h.req); assert.equal(r.status, 503); assert.equal(h.calls.length, 1); } finally { h.restore(); }
});

test('authenticated relay forwards base64 and returns the Drive url', async () => {
  const h = harness({}); try { const r = await handleAnswerUpload(h.req); assert.equal(r.status, 200); assert.equal(r.body.result, 'https://synthetic.invalid/drive/file'); assert.equal(h.calls.length, 2); const relay = h.calls[1]; assert.equal(relay.url.includes('script.google.com'), true); const body = JSON.parse(relay.opts.body); assert.equal(body.action, 'student.test.uploadSubmission'); assert.equal(Buffer.from(body.payload.base64, 'base64').equals(BYTES), true); assert.equal(body.payload.mimeType, 'application/pdf'); assert.equal(typeof body.payload.filename, 'string'); assert.equal(body.payload.filename.includes('/'), false); assert.equal(relay.opts.redirect, 'follow'); } finally { h.restore(); }
});

test('file name is sanitised against path traversal', async () => {
  const h = harness({ headers: { 'x-file-name': '../../secret/../../passwd.pdf' } }); try { const r = await handleAnswerUpload(h.req); assert.equal(r.status, 200); const body = JSON.parse(h.calls[1].opts.body); assert.equal(body.payload.filename.includes('/'), false); assert.equal(body.payload.filename.endsWith('.pdf'), true); } finally { h.restore(); }
});

test('apps script failure yields 502 and confirms nothing', async () => {
  const h = harness({ scriptOk: false }); try { const r = await handleAnswerUpload(h.req); assert.equal(r.status, 502); assert.equal(h.calls.length, 2); } finally { h.restore(); }
});

test('apps script success:false is rejected, never treated as stored', async () => {
  const h = harness({ scriptBody: { result: { success: false } } }); try { const r = await handleAnswerUpload(h.req); assert.equal(r.status, 502); } finally { h.restore(); }
});

test('missing/empty url in apps script ack is rejected', async () => {
  const h = harness({ scriptBody: { result: { url: ' ' } } }); try { const r = await handleAnswerUpload(h.req); assert.equal(r.status, 502); } finally { h.restore(); }
});

test('empty file rejected', async () => {
  const h = harness({ bytes: Buffer.alloc(0) }); try { const r = await handleAnswerUpload(h.req); assert.equal(r.status, 413); assert.equal(h.calls.length, 1); } finally { h.restore(); }
});
