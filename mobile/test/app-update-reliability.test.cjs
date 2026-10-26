const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.resolve(__dirname, '../src/context/AppUpdateContext.tsx'), 'utf8');
const ast = ts.createSourceFile('AppUpdateContext.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function callback(name) {
  const found = [];
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name && node.initializer && ts.isCallExpression(node.initializer)
        && node.initializer.expression.getText(ast) === 'useCallback') found.push(node.initializer.arguments[0].getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(found.length, 1, `Exactly one ${name} callback`);
  return ts.transpileModule(`const auditedCallback = ${found[0]}; auditedCallback;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
}
function functionSource(name) {
  let found;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(found);
  return ts.transpileModule(`${found}; ${name};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}
function harness({ freeBytes = 500 * 1024 * 1024, installed = 45 } = {}) {
  let clock = 0;
  const intervals = new Map(), patches = [], calls = [], launches = [];
  const files = [];
  class FakeFile {
    constructor(base, name) { this.uri = `${base}/${name}`; this.exists = false; this.size = 0; files.push(this); }
    delete() { this.exists = false; this.deleted = true; }
    static downloadFileAsync(url, destination, options) {
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      calls.push({ url, destination, options, resolve, reject });
      return promise;
    }
  }
  const context = {
    File: FakeFile, Paths: { cache: 'cache', availableDiskSpace: freeBytes },
    LegacyFileSystem: { getContentUriAsync: async () => 'content://mock.apk' },
    IntentLauncher: { startActivityAsync: async () => { launches.push('installer'); return { resultCode: 0 }; } },
    Platform: { OS: 'android' }, Application: { nativeBuildVersion: String(installed) },
    APK_MIME: 'application/vnd.android.package-archive', FLAG_GRANT_READ_URI_PERMISSION: 1, FLAG_ACTIVITY_NEW_TASK: 268435456,
    MIN_APK_BYTES: 1_000_000, MIN_FREE_BYTES: 120 * 1024 * 1024,
    STALL_TIMEOUT_MS: 45_000, MAX_AUTO_RETRY: 3, RETRY_BACKOFF_MS: [2000, 6000, 12000],
    attemptSeqRef: { current: 0 }, activeDownloadRef: { current: null },
    mountedRef: { current: true }, updatingRef: { current: false },
    installingRef: { current: false }, apkFileRef: { current: null },
    releaseRef: { current: null }, retryCountRef: { current: 0 },
    patch: (partial) => patches.push(partial),
    Date: { now: () => clock }, AbortController, Error,
    console: { warn() {} },
    setInterval: (fn) => { const id = {}; intervals.set(id, fn); return id; },
    clearInterval: (id) => intervals.delete(id),
    setTimeout: (fn) => { fn(); return 1; },
  };
  const scope = vm.createContext(context);
  context.classifyError = vm.runInContext(functionSource('classifyError'), scope);
  return {
    context, calls, patches, launches, files, intervals,
    load: (name) => vm.runInContext(callback(name), scope),
    advance: (ms) => { clock += ms; for (const fn of [...intervals.values()]) fn(); },
    complete: (call, size = 2_000_000) => { call.destination.exists = true; call.destination.size = size; call.resolve(call.destination); },
  };
}
const release = { version: '1.15.2', versionCode: 46, apkUrl: 'https://example.test/download/android', forceUpdate: true };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

test('stalled repeated progress callbacks do not reset the no-new-bytes deadline', async () => {
  const h = harness(); const pending = h.load('downloadApk')(release);
  const outcome = pending.then(() => 'resolved', (e) => e.message);
  const call = h.calls[0];
  call.options.onProgress({ bytesWritten: 100, totalBytes: 2_000_000 });
  for (let i = 0; i < 5; i++) { call.options.onProgress({ bytesWritten: 100, totalBytes: 2_000_000 }); h.advance(10_000); }
  await flush();
  assert.equal(h.intervals.size, 0, 'watchdog must fire despite repeated identical callbacks');
  assert.equal(call.options.signal?.aborted, true, 'native transfer must be cancelled');
  assert.match(await outcome, /stall/i);
});
test('silent stalled download is cancelled rather than left running behind Retry', async () => {
  const h = harness(); const pending = h.load('downloadApk')(release);
  const outcome = pending.catch((e) => e.message); h.advance(50_000); await flush();
  assert.equal(h.calls[0].options.signal?.aborted, true); assert.match(await outcome, /stall/i);
  assert.equal(h.context.activeDownloadRef.current, null);
});
test('100% byte callback is not displayed as completed until file validation', async () => {
  const h = harness(); const pending = h.load('downloadApk')(release); const call = h.calls[0];
  call.options.onProgress({ bytesWritten: 2_000_000, totalBytes: 2_000_000 });
  assert.ok(h.patches.at(-1).progress < 1); assert.match(h.patches.at(-1).statusNote, /check/i);
  h.complete(call); await pending; assert.equal(h.context.apkFileRef.current, call.destination);
});
test('SDK final progress event cannot overwrite a larger advertised byte count', async () => {
  const h = harness(); const pending = h.load('downloadApk')(release); const outcome = pending.catch((e) => e.message);
  const call = h.calls[0];
  call.options.onProgress({ bytesWritten: 1_000_000, totalBytes: 3_000_000 });
  call.options.onProgress({ bytesWritten: 2_000_000, totalBytes: 2_000_000 });
  h.complete(call); assert.match(await outcome, /incomplete|mismatch/i);
  assert.equal(h.context.apkFileRef.current, null); assert.equal(call.destination.exists, false);
});
test('late completion of a timed-out download is cleaned up and cannot replace ready APK', async () => {
  const h = harness(); const download = h.load('downloadApk');
  const first = download(release).catch(() => undefined); h.advance(50_000); await first;
  const second = download(release); h.complete(h.calls[1]); await second;
  h.complete(h.calls[0]); await flush();
  assert.equal(h.context.apkFileRef.current, h.calls[1].destination);
  assert.equal(h.calls[0].destination.exists, false);
  assert.notEqual(h.calls[0].destination.uri, h.calls[1].destination.uri);
});
test('zero available storage fails before starting any download', async () => {
  const h = harness({ freeBytes: 0 }); await assert.rejects(h.load('downloadApk')(release), /enospc/i);
  assert.equal(h.calls.length, 0);
});
test('positive advancing progress keeps a slow but healthy transfer alive', async () => {
  const h = harness(); const pending = h.load('downloadApk')(release); const call = h.calls[0];
  for (let i = 1; i <= 5; i++) { h.advance(20_000); call.options.onProgress({ bytesWritten: i * 300_000, totalBytes: 2_000_000 }); }
  assert.equal(call.options.signal?.aborted, false); h.complete(call); await pending;
  assert.equal(h.intervals.size, 0);
});
test('missing Content-Length can still complete after basic size checks', async () => {
  const h = harness(); const pending = h.load('downloadApk')(release); const call = h.calls[0];
  call.options.onProgress({ bytesWritten: 1000, totalBytes: -1 });
  assert.equal(h.patches.at(-1).progress, -1); h.complete(call); await pending;
  assert.equal(h.context.apkFileRef.current, call.destination);
});
test('explicit cancellation settles and clears the download watchdog', async () => {
  const h = harness(); const pending = h.load('downloadApk')(release); const outcome = pending.catch((e) => e.message);
  assert.ok(h.context.activeDownloadRef.current); h.context.activeDownloadRef.current.abort();
  assert.match(await outcome, /cancel|abort/i); assert.equal(h.intervals.size, 0);
});
test('installer cancellation/return does not permanently disable Open installer again', async () => {
  const h = harness(); h.context.apkFileRef.current = { uri: 'mock.apk' };
  const install = h.load('install'); await install(); await install();
  assert.equal(h.launches.length, 2); assert.equal(h.context.installingRef.current, false);
  assert.equal(h.patches.at(-1).phase, 'ready');
});
test('rapid double-tap Install opens only one installer while the first is pending', async () => {
  const h = harness(); h.context.apkFileRef.current = { uri: 'mock.apk' };
  let finish;
  h.context.IntentLauncher.startActivityAsync = () => { h.launches.push('installer'); return new Promise((resolve) => { finish = resolve; }); };
  const install = h.load('install'); const first = install(); await flush(); await install();
  assert.equal(h.launches.length, 1); finish({ resultCode: 0 }); await first;
  assert.equal(h.context.installingRef.current, false);
});
test('installer launch failure stays actionable and clears its guard', async () => {
  const h = harness(); h.context.apkFileRef.current = { uri: 'mock.apk' };
  h.context.IntentLauncher.startActivityAsync = async () => { throw new Error('install intent failed'); };
  await h.load('install')(); assert.equal(h.context.installingRef.current, false); assert.equal(h.patches.at(-1).phase, 'error');
});
test('stalls are eligible for bounded automatic retry', () => {
  const h = harness(); assert.equal(h.context.classifyError(new Error('download stalled: no data')).transient, true);
});
test('rapid Retry calls share one update pipeline', async () => {
  const h = harness(); let complete;
  let downloads = 0;
  h.context.downloadApk = () => { downloads++; return new Promise((resolve) => { complete = resolve; }); };
  const run = h.load('runUpdate'); h.context.runUpdate = run;
  const first = run(release); await flush(); const second = run(release); await flush();
  assert.equal(downloads, 1); complete({}); await Promise.all([first, second]);
  assert.equal(h.context.updatingRef.current, false); assert.equal(h.patches.at(-1).phase, 'ready');
});
test('transient errors stop after four attempts and release the retry guard', async () => {
  const h = harness(); let downloads = 0;
  h.context.downloadApk = async () => { downloads++; throw new Error('download stalled: no bytes'); };
  const run = h.load('runUpdate'); h.context.runUpdate = run; await run(release);
  assert.equal(downloads, 4); assert.equal(h.patches.at(-1).phase, 'error'); assert.equal(h.context.updatingRef.current, false);
});
test('unmount during a failed download prevents further retries or state updates', async () => {
  const h = harness(); let downloads = 0;
  h.context.downloadApk = async () => { downloads++; h.context.mountedRef.current = false; throw new Error('network offline'); };
  const run = h.load('runUpdate'); h.context.runUpdate = run; await run(release);
  assert.equal(downloads, 1); assert.equal(h.context.updatingRef.current, false);
});

test('phase changes cannot recreate autoUpdate and retrigger the forced startup check', () => {
  let dependencies;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'autoUpdate') dependencies = node.initializer.arguments[1].getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(dependencies); assert.doesNotMatch(dependencies, /ui\b/);
});
test('update checks cannot start a second pipeline during a manual retry', async () => {
  const h = harness(); h.context.updatingRef.current = true;
  h.context.backendMode = 'live'; h.context.checkingRef = { current: false };
  h.context.phaseRef = { current: 'error' };
  await h.load('autoUpdate')(true);
  assert.equal(h.patches.length, 0);
});
test('successful retry ends in ready without further automatic attempts', async () => {
  const h = harness(); let downloads = 0;
  h.context.downloadApk = async () => { if (++downloads === 1) throw new Error('network dropped'); return {}; };
  await h.load('runUpdate')(release);
  assert.equal(downloads, 2); assert.equal(h.patches.at(-1).phase, 'ready'); assert.equal(h.patches.at(-1).progress, 1);
});
test('local updater preserves explicit optional policy; no forced-policy change is smuggled in', async () => {
  const h = harness(); h.context.downloadApk = async () => ({});
  await h.load('runUpdate')({ ...release, forceUpdate: false });
  assert.equal(h.patches[0].forceUpdate, false); assert.equal(h.patches[0].canDismiss, true);
});
test('a transfer stuck finalizing after its last byte times out before it can claim ready', async () => {
  const h = harness(); const pending = h.load('downloadApk')(release); const outcome = pending.catch((e) => e.message);
  h.calls[0].options.onProgress({ bytesWritten: 2_000_000, totalBytes: 2_000_000 });
  h.advance(50_000); assert.match(await outcome, /stall/i);
  assert.equal(h.context.apkFileRef.current, null); assert.ok(h.patches.every((p) => p.phase !== 'ready'));
});
test('late progress after cancellation cannot revive the progress UI', async () => {
  const h = harness(); const pending = h.load('downloadApk')(release).catch(() => undefined);
  h.advance(50_000); await pending; const count = h.patches.length;
  h.calls[0].options.onProgress({ bytesWritten: 2_000_000, totalBytes: 2_000_000 });
  assert.equal(h.patches.length, count);
});
test('native network failure removes partial files and the watchdog', async () => {
  const h = harness(); const pending = h.load('downloadApk')(release); const outcome = pending.catch((e) => e.message);
  const call = h.calls[0]; call.destination.exists = true; call.destination.size = 1000;
  call.reject(new Error('network offline')); assert.match(await outcome, /network/i);
  assert.equal(call.destination.exists, false); assert.equal(h.intervals.size, 0);
});
test('larger-than-advertised file also fails the exact size check', async () => {
  const h = harness(); const pending = h.load('downloadApk')(release); const outcome = pending.catch((e) => e.message);
  const call = h.calls[0]; call.options.onProgress({ bytesWritten: 1_000_000, totalBytes: 2_000_000 });
  h.complete(call, 3_000_000); assert.match(await outcome, /size mismatch/i);
});
