const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function harness() {
  let session = { studentId: 'UMP0001', password: 'synthetic-only' };
  const calls = []; let beforeResponse = null; let deny = false;
  const exports = {};
  const source = fs.readFileSync(require('node:path').join(__dirname, '../src/services/workspaceInbox.ts'), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(js, { exports, Date, JSON, AbortSignal, require: name => name.includes('config') ? { config: { mentorApiUrl: 'https://example.invalid/api/mentor', requestTimeoutMs: 1000 } } : { getSavedSession: async () => session, getSessionGeneration: () => 0, subscribeSessionInvalidation: () => () => {} }, fetch: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/session')) return { ok: true, json: async () => ({ studentId: session.studentId, token: 'synthetic-proof' }) };
    const sid = session.studentId;
    if (beforeResponse) beforeResponse();
    return { ok: !deny, status: deny ? 401 : 200, json: async () => ({ studentId: sid, messages: [{ text: 'private' }] }) };
  } });
  return { api: exports, calls, setSession: value => { session = value; }, switchDuringRead: fn => { beforeResponse = fn; }, deny: () => { deny = true; } };
}
test('no saved session or mismatched account never requests a private thread', async () => {
  const h = harness();
  assert.equal(await h.api.readWorkspaceInbox('messages', 'UMP0002'), null);
  h.setSession(null);
  assert.equal(await h.api.readWorkspaceInbox('announcements'), null);
  assert.equal(h.calls.length, 0);
});
test('private inbox proves credentials, uses header token, and caches only in memory', async () => {
  const h = harness(); const first = await h.api.readWorkspaceInbox('messages', 'UMP0001');
  assert.equal(first.messages[0].text, 'private');
  assert.equal(h.calls.length, 2);
  assert.equal(JSON.parse(h.calls[0].options.body).password, 'synthetic-only');
  assert.equal(h.calls[1].options.headers['X-Workspace-Token'], 'synthetic-proof');
  assert.ok(!h.calls.some(c => /synthetic|password|token=/.test(c.url)));
  await h.api.readWorkspaceInbox('messages', 'UMP0001');
  assert.equal(h.calls.length, 3);
});
test('switching account while a response is pending discards private data', async () => {
  const h = harness();
  h.switchDuringRead(() => h.setSession({ studentId: 'UMP0002', password: 'another-synthetic' }));
  assert.equal(await h.api.readWorkspaceInbox('messages', 'UMP0001'), null);
});
test('a rejected proof does not retry or write and is not reused on the next read', async () => {
  const h = harness(); h.deny();
  assert.equal(await h.api.readWorkspaceInbox('messages', 'UMP0001'), null);
  assert.equal(h.calls.length, 2);
  await h.api.readWorkspaceInbox('messages', 'UMP0001');
  assert.equal(h.calls.filter(c => c.url.endsWith('/session')).length, 2);
  assert.ok(h.calls.every(c => !c.options.method || c.options.method === 'POST' && c.url.endsWith('/session')));
});
test('password changes do not reuse the previous private-reader proof', async () => {
  const h = harness(); await h.api.readWorkspaceInbox('messages', 'UMP0001');
  h.setSession({ studentId:'UMP0001', password:'updated-synthetic' });
  await h.api.readWorkspaceInbox('messages', 'UMP0001');
  assert.equal(h.calls.filter(c => c.url.endsWith('/session')).length, 2);
});
