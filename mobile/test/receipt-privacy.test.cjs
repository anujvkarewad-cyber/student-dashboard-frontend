const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const read = name => fs.readFileSync(path.join(__dirname, '../src/', name), 'utf8');
function vault() {
  const files = new Map([['file:///cache/Audio/recording-test.receipt.m4a', 1024]]), dirs = new Set();
  const adapter = { documentDirectory: 'file:///docs/', cacheDirectory: 'file:///cache/',
    getInfoAsync: async uri => files.has(uri) ? { exists: true, isDirectory: false, size: files.get(uri) } : { exists: dirs.has(uri), isDirectory: true },
    readDirectoryAsync: async dir => [...files.keys()].filter(k => k.startsWith(dir)).map(k => k.slice(dir.length)),
    makeDirectoryAsync: async dir => { dirs.add(dir); },
    copyAsync: async ({ from, to }) => { files.set(to, files.get(from)); },
    deleteAsync: async uri => { files.delete(uri); },
  };
  const exports = {}; const js = ts.transpileModule(read('services/receiptAudioVault.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(js, { exports, require: () => adapter, Date, Math, Promise });
  return { api: exports, files, adapter, uri: 'file:///cache/Audio/recording-test.receipt.m4a' };
}
test('receipt AI is opt-in and never uses shared evaluation endpoint', () => {
  const context = read('context/StudyReceiptContext.tsx');
  assert.match(context, /requestAi = false/); assert.match(context, /student && requestAi/);
  assert.doesNotMatch(context, /evaluateAnswer\(/); assert.match(context, /currentOwner.current !== owner/);
  const service = read('services/privateReceipt.ts');
  assert.match(service, /\/receipt\/evaluate/); assert.doesNotMatch(service, /\/ai\/evaluate/);
  assert.match(service, /receiptStored !== false/); assert.match(service, /scoreStored !== false/);
});
test('native saved audio is account scoped and survives temporary-file deletion', async () => {
  const { api, files, uri } = vault(); const item = await api.saveReceiptAudio('UMP1', uri);
  files.delete(uri); assert.equal((await api.listReceiptAudio('UMP1')).length, 1);
  assert.equal((await api.listReceiptAudio('UMP2')).length, 0);
  await api.deleteReceiptAudio('UMP2', item.id); assert.ok(files.has(item.uri));
  await api.deleteReceiptAudio('UMP1', item.id); assert.equal((await api.listReceiptAudio('UMP1')).length, 0);
});
test('native vault rejects concurrent overflow without evicting saved clips', async () => {
  const { api, uri } = vault();
  const results = await Promise.allSettled(Array.from({ length: 11 }, () => api.saveReceiptAudio('UMP1', uri)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 10);
  assert.equal(results.filter(r => r.status === 'rejected').length, 1);
  assert.equal((await api.listReceiptAudio('UMP1')).length, 10);
});
test('native vault rejects traversal, external URLs and oversize recordings', async () => {
  const { api, files, uri } = vault();
  await assert.rejects(api.saveReceiptAudio('../other', uri));
  await assert.rejects(api.saveReceiptAudio('UMP1', 'https://example.test/audio.receipt.m4a'));
  await assert.rejects(api.deleteReceiptAudio('UMP1', '../secret.m4a'));
  files.set(uri, 2 * 1024 * 1024 + 1); await assert.rejects(api.saveReceiptAudio('UMP1', uri));
});
test('failed native copy removes only its incomplete destination', async () => {
  const { api, files, adapter, uri } = vault();
  adapter.copyAsync = async ({ to }) => { files.set(to, 1); throw new Error('disk full'); };
  await assert.rejects(api.saveReceiptAudio('UMP1', uri));
  assert.equal(files.size, 1); assert.ok(files.has(uri));
});

function receiptProvider(evaluate) {
  const writes = [], refs = [];
  const storage = { setItem: async (key, value) => writes.push({ key, value: JSON.parse(value) }), getItem: async () => null };
  const react = { createContext: () => ({ Provider: 'provider' }), createElement: (_type, props) => props,
    useState: initial => { let value = initial; return [value, next => { value = typeof next === 'function' ? next(value) : next; }]; },
    useRef: value => { const ref = { current: value }; refs.push(ref); return ref; },
    useEffect: () => undefined, useCallback: fn => fn, useMemo: fn => fn(), useContext: () => undefined };
  const exports = {};
  const source = ts.transpileModule(read('context/StudyReceiptContext.tsx'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
  vm.runInNewContext(source, { exports, Date, Math, Promise, require: name => {
    if (name === 'react') return { __esModule: true, default: react, ...react };
    if (name.includes('async-storage')) return { __esModule: true, default: storage };
    if (name.includes('privateReceipt')) return { evaluatePrivateReceipt: evaluate };
    if (name.includes('AuthContext')) return { useAuth: () => ({ student: { studentId: 'UMP1' } }) };
    throw new Error('Unexpected import: ' + name);
  } });
  const value = exports.StudyReceiptsProvider({ children: null }).value;
  const session = { id: 's1', subject: 'Audit', target: 'Independence', durationSeconds: 300, startedAt: 1, endedAt: 301 };
  const answers = [{ id: 'short', prompt: 'First short question', helper: '', response: 'Short initial response.' }, { id: 'long', prompt: 'Correct question for the longer answer', helper: '', response: 'Auditors should identify threats and take appropriate safeguards while applying independent judgement.' }];
  return { value, session, answers, writes, refs };
}
test('executed receipt creation saves locally without any AI call by default', async () => {
  let calls = 0;
  const f = receiptProvider(async () => { calls++; return { ok: true, score: 7 }; });
  await f.value.createReceipt(f.session, f.answers, 'Medium');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 0); assert.equal(f.writes.length, 1); assert.equal(f.writes[0].key, 'ump_study_receipts_UMP1');
});
test('opted-in feedback uses the matching prompt and cannot cross account switch', async () => {
  let finish, input;
  const f = receiptProvider(value => { input = value; return new Promise(resolve => { finish = resolve; }); });
  await f.value.createReceipt(f.session, f.answers, 'Medium', true);
  assert.equal(input.question, 'Correct question for the longer answer');
  f.refs[0].current = 'UMP2';
  finish({ ok: true, score: 7, verdict: 'Good', missingKeyPoints: [] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].key, 'ump_study_receipts_UMP1');
});
