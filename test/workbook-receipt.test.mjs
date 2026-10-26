import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
const coreText = fs.readFileSync(new URL('../workbook-core.js', import.meta.url), 'utf8');
const voiceText = fs.readFileSync(new URL('../receipt-voice.js', import.meta.url), 'utf8');
const transportText = fs.readFileSync(new URL('../practice-client.js', import.meta.url), 'utf8');
function core() { const context = vm.createContext({ URL, Date }); vm.runInContext(coreText, context); return context.UMP_WORKBOOK_CORE; }
function storage() { const map = new Map(); return { getItem: k => map.get(k) || null, setItem: (k, v) => map.set(k, v) }; }
const tick = () => new Promise(resolve => setImmediate(resolve));

test('drafts are account isolated and contain no audio', () => {
  const c = core(), s = storage(); c.saveDraft(s, 'UMP1', 'book:q1', { answer: 'my answer', pages: [[[1, 2]]], audio: 'forbidden' });
  assert.equal(c.loadDraft(s, 'UMP1', 'book:q1').answer, 'my answer');
  assert.equal(c.loadDraft(s, 'UMP2', 'book:q1').answer, '');
  assert.equal(s.getItem('ump_workbook_drafts_v1_UMP1').includes('audio'), false);
});
test('draft caps do not silently evict old answers', () => {
  const c = core(), s = storage(); for (let n = 0; n < 20; n++) c.saveDraft(s, 'UMP1', 'b:q' + n, { answer: 'answer' });
  assert.throws(() => c.saveDraft(s, 'UMP1', 'b:21', { answer: 'new' }), /20 drafts/);
  assert.equal(c.loadDraft(s, 'UMP1', 'b:q0').answer, 'answer');
  c.removeDraft(s, 'UMP1', 'b:q0'); c.saveDraft(s, 'UMP1', 'b:21', { answer: 'new' });
});
test('strokes are bounded, clamped and reject nonfinite input', () => {
  const c = core(), d = c.cleanDraft({ answer: 'a'.repeat(13000), pages: [[[[999, -5], [NaN, 0], [1, Infinity]]], [], [], []] });
  assert.equal(d.answer.length, 12000); assert.equal(d.pages.length, 3); assert.equal(d.pages[0][0][0][0], 800); assert.equal(d.pages[0][0][0][1], 0); assert.equal(d.pages[0][0].length, 1);
});
test('PDF sources do not accept script URLs or arbitrary remote origins', () => {
  const c = core(); assert.throws(() => c.pdfPreview('javascript:alert(1)'));
  assert.throws(() => c.pdfPreview('https://evil.test/a.pdf'));
  assert.equal(c.pdfPreview('https://drive.google.com/file/d/abc123/view'), 'https://drive.google.com/file/d/abc123/preview');
});
function voiceDom() {
  const dom = new JSDOM('<section><form><textarea data-recall-id="q1">Already typed.</textarea></form></section>', { url: 'https://app.example.test', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window; let stopped = 0, revoked = 0, calls = 0, submissions = 0;
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLMediaElement.prototype.pause = function () {};
  w.URL.createObjectURL = () => 'blob:test'; w.URL.revokeObjectURL = () => { revoked++; };
  Object.defineProperty(w.navigator, 'mediaDevices', { value: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => { stopped++; } }] }) } });
  w.MediaRecorder = class {
    static isTypeSupported() { return true; }
    constructor(_stream, options) { this.mimeType = options.mimeType; this.state = 'inactive'; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new w.Blob(['fake audio'], { type: this.mimeType }) }); this.onstop?.(); }
  };
  w.UMP_PRACTICE = { request: async () => { calls++; return { text: 'Meaning from voice.' }; }, appendReviewed: (a, b) => [a, b].join('\n') };
  w.document.querySelector('form').onsubmit = e => { e.preventDefault(); submissions++; };
  w.eval(voiceText); w.UMP_RECEIPT_VOICE.attach(w.document.querySelector('section'));
  const click = sel => w.document.querySelector(sel).click();
  return { dom, w, click, counts: () => ({ stopped, revoked, calls, submissions }) };
}
test('voice only attaches to study receipt and review fields, never workbook answer', () => {
  const { dom, w } = voiceDom();
  const field = w.document.createElement('textarea'); field.id = 'workbook-answer'; w.document.body.append(field); w.UMP_RECEIPT_VOICE.attach(w.document.body);
  assert.equal(w.document.querySelectorAll('[data-receipt-voice]').length, 1); dom.window.close();
});
test('record and stop never submit or overwrite existing answer; insertion is explicit', async () => {
  const { dom, w, click, counts } = voiceDom(); click('[data-receipt-voice]'); click('[data-action=record]'); await tick();
  click('[data-action=stop]'); await tick(); assert.equal(counts().calls, 0);
  click('[data-action=transcribe]'); await tick(); assert.equal(counts().calls, 1);
  assert.equal(w.document.querySelector('[data-recall-id]').value, 'Already typed.');
  assert.equal(counts().submissions, 0);
  click('[data-action=insert]'); assert.equal(w.document.querySelector('[data-recall-id]').value, 'Already typed.\nMeaning from voice.');
  assert.equal(w.document.querySelector('dialog'), null); assert.ok(counts().stopped > 0); assert.ok(counts().revoked > 0); assert.equal(counts().submissions, 0); dom.window.close();
});
test('cancel stops microphone and discards temporary audio', async () => {
  const { dom, w, click, counts } = voiceDom(); click('[data-receipt-voice]'); click('[data-action=record]'); await tick(); click('[data-action=cancel]');
  assert.ok(counts().stopped > 0); assert.equal(counts().calls, 0); assert.equal(w.document.querySelector('[data-recall-id]').value, 'Already typed.'); assert.equal(w.localStorage.length, 0); dom.window.close();
});
test('navigation away removes the recorder and releases the microphone', async () => {
  const { dom, w, click, counts } = voiceDom(); click('[data-receipt-voice]'); click('[data-action=record]'); await tick(); w.document.querySelector('section').remove(); await tick();
  assert.equal(w.document.querySelector('dialog'), null); assert.ok(counts().stopped > 0); dom.window.close();
});
test('permission failure leaves typing intact', async () => {
  const { dom, w, click } = voiceDom(); w.navigator.mediaDevices.getUserMedia = async () => { throw new Error('Permission denied'); };
  click('[data-receipt-voice]'); click('[data-action=record]'); await tick();
  assert.match(w.document.querySelector('[data-error]').textContent, /denied/); assert.equal(w.document.querySelector('[data-recall-id]').value, 'Already typed.'); w.UMP_RECEIPT_VOICE.close(); dom.window.close();
});
test('private practice calls use same-origin gateway and never put credentials in URL/storage', async () => {
  const dom = new JSDOM('', { url: 'https://app.example.test', runScripts: 'outside-only' }); const w = dom.window;
  w.localStorage.setItem('ump_student', JSON.stringify({ studentId: 'UMP1', password: 'local-test-password' })); const calls = [];
  w.fetch = async (url, options) => { calls.push({ url, options }); return { ok: true, status: 200, json: async () => url.endsWith('/session') ? { token: 'test-capability', studentId: 'UMP1' } : { workbooks: [] } }; };
  w.eval(transportText); await w.UMP_PRACTICE.request('/workbooks');
  assert.equal(calls.length, 2); assert.equal(calls[1].options.headers['X-Practice-Token'], 'test-capability');
  assert.equal(calls[1].url, '/api/mentor/api/practice/workbooks'); assert.equal(w.localStorage.length, 1); assert.equal(w.localStorage.getItem('ump_student').includes('test-capability'), false); dom.window.close();
});


test('ordinary browser messages cannot inject a native capability', async () => {
  const dom = new JSDOM('', { url: 'https://app.example.test', runScripts: 'outside-only' }); const w = dom.window;
  w.localStorage.setItem('ump_student', JSON.stringify({ studentId: 'UMP1', password: 'test-only' })); let calls = 0;
  w.fetch = async () => { calls++; return { ok: true, json: async () => ({ token: 'legitimate', studentId: 'UMP1' }) }; };
  w.eval(transportText);
  w.dispatchEvent(new w.MessageEvent('message', { data: JSON.stringify({ type: 'practice-session', token: 'injected', studentId: 'UMP1' }) }));
  assert.equal((await w.UMP_PRACTICE.session()).token, 'legitimate'); assert.equal(calls, 1); w.close();
});
test('native exchange is single-flight and rejects cross-origin frame replies', async () => {
  const dom = new JSDOM('', { url: 'https://app.example.test', runScripts: 'outside-only' }); const w = dom.window; let calls = 0;
  w.ReactNativeWebView = { postMessage: () => { calls++; } }; w.eval(transportText);
  const first = w.UMP_PRACTICE.session(), second = w.UMP_PRACTICE.session();
  const send = (token, origin) => w.dispatchEvent(new w.MessageEvent('message', { origin, data: JSON.stringify({ type: 'practice-session', token, studentId: 'UMP1' }) }));
  send('injected', 'https://drive.google.com'); send('legitimate', '');
  assert.equal((await first).token, 'legitimate'); assert.equal((await second).token, 'legitimate'); assert.equal(calls, 1); w.close();
});
