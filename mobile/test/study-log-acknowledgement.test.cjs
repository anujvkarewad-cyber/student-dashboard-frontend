const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const unknown = 'Save outcome is unknown. Keep this draft and check Study tracker before retrying.';

// Reuse only fixture definitions, not the other test file's registered tests.
const fixtureSource = fs.readFileSync(path.join(__dirname, 'study-log-zero-hours.test.cjs'), 'utf8');
const split = fixtureSource.indexOf("for (const [name, harness]");
assert.ok(split > 0);
const fixtureContext = { require, __dirname };
vm.runInNewContext(fixtureSource.slice(0, split) + '\nglobalThis.fixtures={webHarness,nativeHarness};', fixtureContext);
const { webHarness, nativeHarness } = fixtureContext.fixtures;

for (const hours of ['0', '0.5']) test(`web duplicate explicit submission ${hours} does not add optimistic hours twice`, async () => {
  const h = webHarness({ hours });
  await h.submit(); await h.submit();
  assert.equal(h.writes.length, 2, 'Two explicit actions, not an automatic retry');
  assert.equal(h.state.stats.totalHours, 5 + Number(hours));
  assert.equal(h.state.stats.totalEntries, 2); assert.equal(h.state.log.length, 1);
  assert.equal(h.state.log[0].date, '2026-10-18');
});

test('web save rejection preserves draft and existing rows/hours', async () => {
  const h = webHarness({ hours: '0.5', failWrite: true }); await h.submit();
  assert.equal(h.closed(), false); assert.equal(h.sandbox.tlHours.value, '0.5');
  assert.equal(h.state.stats.totalHours, 5); assert.equal(h.state.log.length, 0);
  assert.equal(h.sandbox.tlSubmitBtn.disabled, false);
});

test('web unknown save preserves draft, has no success UI and never reads/resends automatically', async () => {
  const h = webHarness({ hours: '0.5' }); let calls = 0;
  h.sandbox.api.addStudyLog = async () => { calls++; throw new Error(unknown); };
  h.sandbox.api.getStats = async () => assert.fail('No new uncertain-save reconciliation via ID-only read');
  await h.submit();
  assert.equal(calls, 1); assert.equal(h.closed(), false); assert.equal(h.renders(), 0);
  assert.equal(h.sandbox.tlHours.value, '0.5'); assert.equal(h.errors.at(-1), unknown);
});

test('web acknowledged save with unavailable tracker retains draft and distinguishes refresh failure', async () => {
  const h = webHarness({ hours: '0.5' });
  h.sandbox.api.getStats = async () => { throw new Error('offline'); };
  await h.submit();
  assert.equal(h.writes.length, 1); assert.equal(h.closed(), false);
  assert.equal(h.state.stats.totalHours, 5); assert.equal(h.sandbox.tlHours.value, '0.5');
  assert.match(h.errors.at(-1), /acknowledged.*could not refresh/);
});

test('web malformed tracker read does not inflate totals or clear draft', async () => {
  const h = webHarness({ hours: '0.5' }); h.sandbox.api.getStudyLog = async () => null;
  await h.submit(); assert.equal(h.closed(), false); assert.equal(h.state.stats.totalHours, 5);
  assert.equal(h.sandbox.tlHours.value, '0.5');
});

test('native failed save keeps existing draft state and emits no success alert', async () => {
  const h = nativeHarness({ hours: '0.5', failWrite: true }); await h.submit();
  assert.equal(h.state[1], '0.5'); assert.equal(h.state[0], '2026-10-18');
  assert.equal(h.alerts.length, 0); assert.equal(h.state[10], false);
});

const webAPI = fs.readFileSync(path.join(root, 'api.js'), 'utf8');
function webClient(packet) {
  let count = 0; const context = { window: {}, localStorage: {getItem: () => JSON.stringify({studentId:'TEST',password:'synthetic-local'}), removeItem() {}}, fetch: async () => {
    count++; if (packet.network) throw new TypeError('connection lost');
    return { ok: packet.status >= 200 && packet.status < 300, json: async () => {
      if (packet.raw) throw new SyntaxError('bad json'); return packet.body;
    } };
  } };
  vm.runInNewContext(webAPI, context);
  return { api: context.window.UMP_API, calls: () => count };
}
const nativeSource = fs.readFileSync(path.join(root, 'mobile/src/api/client.ts'), 'utf8');
const nativeJS = ts.transpileModule(nativeSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function nativeClient(packet) {
  let count = 0;
  class XHR {
    open() {} setRequestHeader() {}
    send(body) {
      count++; this.status = packet.status;
      this.responseText = packet.raw || JSON.stringify(packet.body);
      if (packet.network) this.onerror(); else if (packet.timeout) this.ontimeout();
      else if (packet.abort) this.onabort(); else this.onload();
    }
  }
  const modules = {
    '@react-native-async-storage/async-storage': {}, 'expo-file-system/legacy': {},
    '../storage/session': { getSavedSession: async () => ({studentId:'TEST',password:'synthetic-local'}), getSessionGeneration: () => 0, clearSavedSession: async () => {} },
    '../services/workspaceInbox': { readWorkspaceInbox: async () => null },
    '../config': { config: { apiUrl: 'https://offline-fixture.invalid/api/proxy', requestTimeoutMs: 1, defaultApiMode: 'live' } },
  };
  const ctx = { exports: {}, XMLHttpRequest: XHR, require: name => { assert.ok(Object.hasOwn(modules,name)); return modules[name]; } };
  vm.runInNewContext(nativeJS, ctx);
  return { api: ctx.exports.api, calls: () => count };
}
for (const [platform, create] of [['web', webClient], ['native XHR', nativeClient]]) {
  for (const [name, packet] of [
    ['application rejection', { status: 200, body: { result: { success: false, message: 'Rejected; keep draft' } } }],
    ['HTTP error despite success flag', { status: 500, body: { result: { success: true } } }],
    ['malformed response', { status: 200, raw: 'not-json' }],
    ['empty response shape', { status: 200, body: {} }],
    ['wrong success type', { status: 200, body: { result: { success: 'true' } } }],
    ['lost connection', { network: true }],
  ]) test(`${platform} ${name}: one send, no saved result`, async () => {
    const h = create(packet);
    await assert.rejects(h.api.addStudyLog('TEST', { date: '2026-10-18', hours: 0.5 }), /keep|unknown|draft/i);
    assert.equal(h.calls(),1);
  });
  test(`${platform} explicit acknowledged success still works`, async () => {
    const h = create({ status:200, body:{ result:{ success:true, proofUrl:'https://example.test/proof' } } });
    const result = await h.api.addStudyLog('TEST',{ date:'2026-10-18',hours:0 });
    assert.equal(result.success,true); assert.equal(h.calls(),1);
  });
}
for (const packet of [{ timeout:true }, { abort:true }]) test(`native ${packet.timeout?'timeout':'abort'} is unknown, no retry`, async () => {
  const h = nativeClient(packet);
  await assert.rejects(h.api.addStudyLog('TEST',{ hours:0.5 }), /outcome is unknown/);
  assert.equal(h.calls(),1);
});

// Execute the actual DataContext callback independently of React rendering.
const dataSource=fs.readFileSync(path.join(root,'mobile/src/context/DataContext.tsx'),'utf8');
const ast=ts.createSourceFile('data.tsx',dataSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let submitCallback;
function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='submitStudyLog')submitCallback=n.initializer.arguments[0].getText(ast);ts.forEachChild(n,visit);}
visit(ast);assert.ok(submitCallback);
for (const refreshFails of [false,true]) test(`native acknowledged write: refresh ${refreshFails?'failure is distinct':'success retained'}`,async()=>{
  let writes=0,reads=0;
  const ctx={student:{studentId:'TEST'},api:{addStudyLog:async()=>{writes++;return{success:true};}},refreshTracker:async()=>{reads++;if(refreshFails)throw new Error('offline');}};
  const js=ts.transpileModule('globalThis.submit='+submitCallback,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(js,ctx);
  if(refreshFails)await assert.rejects(ctx.submit({hours:0.5}),/acknowledged.*could not refresh/);else await ctx.submit({hours:0.5});
  assert.equal(writes,1);assert.equal(reads,1);
});

// Execute the existing screen catch path with an uncertain transport outcome.
test('native unknown outcome preserves form fields/proof and never emits saved alert', async () => {
  const proof = { name:'retained.jpg',uri:'file://fixture',mimeType:'image/jpeg' };
  const h = nativeHarness({ hours:'0.5',planned:'Yes',subjects:['Audit'],target:'Yes',proof,failWrite:true,writeError:unknown });
  await h.submit();
  assert.equal(h.state[1],'0.5'); assert.equal(h.state[9],proof);
  assert.equal(h.error(),unknown); assert.equal(h.alerts.length,0); assert.equal(h.state[10],false);
});
