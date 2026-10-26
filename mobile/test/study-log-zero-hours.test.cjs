const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '../..');
const nativeSource = fs.readFileSync(path.join(root, 'mobile/src/screens/AddStudyLogScreen.tsx'), 'utf8');
const webSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const nativeJS = ts.transpileModule(nativeSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
}).outputText;

// Execute the actual screen's render and submit callbacks with inert UI modules.
// No Expo runtime, device, real credentials, uploads, or network calls are used.
function nativeHarness(input = {}) {
  const initial = {
    date: '2026-10-18', hours: '0', planned: 'No', reason: 'Low Motivation',
    otherReason: '', subjects: [], target: '', tomorrow: '', support: '',
    proof: null, loading: false, error: '', ...input,
  };
  const keys = ['date', 'hours', 'planned', 'reason', 'otherReason', 'subjects', 'target', 'tomorrow', 'support', 'proof', 'loading', 'error'];
  const state = keys.map((key) => initial[key]);
  const writes = [], uploads = [], alerts = [];
  let cursor = 0;
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    Fragment: 'Fragment',
    useState: () => {
      const index = cursor++;
      return [state[index], (next) => { state[index] = typeof next === 'function' ? next(state[index]) : next; }];
    },
  };
  const native = Object.fromEntries(['KeyboardAvoidingView', 'Pressable', 'ScrollView', 'Text', 'View'].map((name) => [name, name]));
  native.Platform = { OS: 'android' };
  native.StyleSheet = { create: (styles) => styles };
  native.Alert = { alert: (...args) => alerts.push(args) };
  const modules = {
    react: { __esModule: true, default: react, useState: react.useState },
    'react-native': native,
    '@expo/vector-icons': { Ionicons: 'Ionicons' },
    'expo-document-picker': {},
    'expo-file-system/legacy': {},
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../components/ui': { Chip: 'Chip', FormInput: 'FormInput', PrimaryButton: 'PrimaryButton' },
    '../api/client': { api: { uploadProof: async (payload) => { uploads.push(payload); return { proofUrl: 'mock-proof' }; } } },
    '../context/AuthContext': { useAuth: () => ({ backendMode: 'test' }) },
    '../context/DataContext': { useData: () => ({ submitStudyLog: async (payload) => {
      if (input.failWrite) throw new Error(input.writeError || 'Mock write failed');
      writes.push(payload);
    } }) },
    '../storage/session': { getSavedSession: async () => ({ studentId: 'TEST', password: 'test-only' }) },
    '../theme': { colors: {}, radius: {}, spacing: {} },
  };
  const exports = {};
  vm.runInNewContext(nativeJS, { exports, Error, require: (name) => {
    assert.ok(Object.hasOwn(modules, name), `Unexpected native dependency: ${name}`);
    return modules[name];
  } });
  const render = () => { cursor = 0; return exports.AddStudyLogScreen({ navigation: { goBack() {} } }); };
  function find(node, predicate) {
    if (!node || typeof node !== 'object') return undefined;
    if (Array.isArray(node)) return node.map((child) => find(child, predicate)).find(Boolean);
    if (predicate(node)) return node;
    return find(node.props?.children, predicate);
  }
  return {
    state, writes, uploads, alerts, render, find,
    error: () => state[11],
    submit: () => find(render(), (node) => node.type === 'PrimaryButton').props.onPress(),
  };
}

// Parse the real browser script and run only its real event handlers. Startup,
// Firebase, polling, and external resources never run in this test harness.
const webAST = ts.createSourceFile('app.js', webSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function webHandler(receiver, event = 'click') {
  const matches = [];
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(webAST) === `${receiver}.addEventListener`
        && node.arguments[0]?.text === event) matches.push(node.arguments[1].getText(webAST));
    ts.forEachChild(node, visit);
  }
  visit(webAST);
  assert.equal(matches.length, 1, `Expected one ${receiver} ${event} handler`);
  return matches[0];
}
function webHarness(input = {}) {
  const values = { hours: '0', planned: 'No', reason: 'Low Motivation', ...input };
  const writes = [], errors = [], timers = [];
  let proofReads = 0, renders = 0, closed = false;
  const state = { student: { studentId: 'TEST' }, stats: { totalHours: 5, totalEntries: 1 }, log: [] };
  const hoursInput = { value: values.hours };
  const noInput = { checked: false, dispatchEvent(event) { assert.equal(event.type, 'change'); values.planned = 'No'; } };
  const sandbox = {
    tlDate: { value: '2026-10-18' }, tlHours: hoursInput, tlMentorSupport: { value: '' },
    tlReasonOther: { value: input.otherReason || '' }, tlError: {},
    tlSubmitBtn: { disabled: false, innerHTML: 'Submit' },
    tlPlannedGroup: {}, tlReasonGroup: {}, tlSubjectsGroup: {}, tlTargetGroup: {},
    tlProofFile: { files: input.proof ? [input.proof] : [] }, tlTomorrow: { value: '' },
    getRadioValue: (name) => ({ 'tl-planned': values.planned, 'tl-reason': values.reason, 'tl-target': input.target || '' }[name] || ''),
    getCheckboxValues: () => input.subjects || [],
    setModalError: (_, message) => errors.push(message), clearModalError() {},
    clearFieldError() {}, highlightFieldError() {},
    readProofFile: async () => { proofReads += 1; return input.proof || null; },
    api: { addStudyLog: async (id, payload) => {
      assert.equal(id, 'TEST');
      if (input.failWrite) return { success: false, message: 'Mock write failed' };
      writes.push(payload); return { success: true };
    },
    // Existing tracker readback now runs in the submit callback, rather than an
    // unexecuted timer. Model the server's serial legacy tuple deduplication.
    getStudyLog: async () => [...new Map(writes.map(row => [JSON.stringify([row.date, row.subjects || row.reason, row.hours]), { date: row.date, topic: row.subjects || row.reason, hours: row.hours }])).values()],
    getStats: async () => {
      const rows = [...new Map(writes.map(row => [JSON.stringify([row.date, row.subjects || row.reason, row.hours]), row])).values()];
      return { totalEntries: 1 + rows.length, totalHours: 5 + rows.reduce((sum, row) => sum + row.hours, 0) };
    } },
    state, closeTrackerModal: () => { closed = true; }, renderTracker: () => { renders += 1; },
    setTimeout: (fn) => { timers.push(fn); },
    document: { querySelector: (selector) => {
      assert.equal(selector, 'input[name="tl-planned"][value="No"]'); return noInput;
    } },
    Event: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
  };
  const context = vm.createContext(sandbox);
  return {
    writes, errors, timers, state, sandbox, values, noInput,
    proofReads: () => proofReads, renders: () => renders, closed: () => closed,
    submit: () => vm.runInContext(`(${webHandler('tlSubmitBtn')})()`, context),
    quick: (value) => {
      sandbox.quickEvent = { target: { closest: () => ({ getAttribute: () => value }) } };
      return vm.runInContext(`(${webHandler('tlHoursQuick')})(quickEvent)`, context);
    },
  };
}

for (const [name, harness] of [['Android', nativeHarness], ['Web', webHarness]]) {
  for (const [raw, expected] of [['0', 0], ['0.0', 0], [' 0 ', 0], ['0,0', 0], ['.5', .5], ['0.5', .5], ['2,5', 2.5], ['24', 24]]) {
    test(`${name}: explicit ${JSON.stringify(raw)} is submitted as numeric ${expected}`, async () => {
      const h = harness({ hours: raw }); await h.submit();
      assert.equal(h.writes.length, 1);
      const row = h.writes[0];
      assert.equal(row.hours, expected); assert.equal(typeof row.hours, 'number');
      assert.equal(row.studiedAsPlanned, 'No'); assert.equal(row.reason, 'Low Motivation');
      assert.equal(row.subjects, ''); assert.equal(row.targetCompleted, '');
      assert.equal(row.date, '2026-10-18');
      assert.ok(!Object.hasOwn(row, 'absent') && !Object.hasOwn(row, 'leave'));
    });
  }
  for (const raw of ['', ' ', '-1', '-0.1', '24.01', '25', 'NaN', 'Infinity', '2hrs', '1.2.3', '0x10', '1e1']) {
    test(`${name}: rejects blank, malformed, or out-of-range ${JSON.stringify(raw)}`, async () => {
      const h = harness({ hours: raw }); await h.submit(); assert.equal(h.writes.length, 0);
      assert.ok(name === 'Android' ? h.error() : h.errors.length);
    });
  }
  test(`${name}: zero hours still requires a reason`, async () => {
    const h = harness({ reason: '' }); await h.submit(); assert.equal(h.writes.length, 0);
  });
  test(`${name}: Other requires a nonblank explanation`, async () => {
    const h = harness({ reason: 'Other', otherReason: '  ' }); await h.submit(); assert.equal(h.writes.length, 0);
  });
  test(`${name}: Other explanation is preserved`, async () => {
    const h = harness({ reason: 'Other', otherReason: ' Rest day ' }); await h.submit();
    assert.equal(h.writes.length, 1); assert.equal(h.writes[0].reason, 'Rest day');
  });
  test(`${name}: zero hours directs students to the no-study flow`, async () => {
    const h = harness({ planned: 'Yes', subjects: ['Audit'], target: 'Yes', proof: { name: 'stale.jpg' } });
    await h.submit(); assert.equal(h.writes.length, 0);
  });
  test(`${name}: positive study still requires proof`, async () => {
    const h = harness({ hours: '2', planned: 'Yes', subjects: ['Audit'], target: 'Yes' });
    await h.submit(); assert.equal(h.writes.length, 0);
  });
  test(`${name}: positive study with proof still works`, async () => {
    const h = harness({ hours: '2', planned: 'Yes', subjects: ['Audit'], target: 'Yes', proof: { name: 'proof.jpg', uri: 'file://mock', mimeType: 'image/jpeg' } });
    await h.submit(); assert.equal(h.writes.length, 1); assert.equal(h.writes[0].hours, 2);
    assert.equal(h.writes[0].subjects, 'Audit');
  });
  test(`${name}: zero/no-study does not read or upload stale proof`, async () => {
    const h = harness({ proof: { name: 'stale.jpg', uri: 'file://mock' } }); await h.submit();
    assert.equal(h.writes.length, 1);
    assert.equal(name === 'Android' ? h.uploads.length : h.proofReads(), 0);
  });
}

test('Android: explicit zero-hour chip selects No and clears study-only state', () => {
  const h = nativeHarness({ hours: '4', planned: 'Yes', subjects: ['Audit'], target: 'Yes', tomorrow: 'Study', proof: { name: 'old.jpg' } });
  const chip = h.find(h.render(), (node) => node.type === 'Chip' && node.props.label === 'Aaj padhai nahi hui (0 hrs)');
  assert.ok(chip, 'Zero-hour shortcut is present'); chip.props.onPress();
  assert.equal(h.state[1], '0'); assert.equal(h.state[2], 'No'); assert.equal(h.state[9], null);
  assert.equal(h.state[5].length, 0); assert.equal(h.state[6], ''); assert.equal(h.state[7], '');
});
test('Web: explicit zero-hour chip selects No through the existing change handler', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /id="tl-hours-quick"/); assert.match(html, /data-hours="0"/);
  const h = webHarness({ hours: '4', planned: 'Yes' }); h.quick('0');
  assert.equal(h.sandbox.tlHours.value, '0'); assert.equal(h.noInput.checked, true);
  assert.equal(h.values.planned, 'No');
});
test('Web: zero success adds a submission without adding hours', async () => {
  const h = webHarness(); await h.submit();
  assert.equal(h.state.stats.totalEntries, 2); assert.equal(h.state.stats.totalHours, 5);
  assert.equal(h.state.log.length, 1); assert.equal(h.state.log[0].hours, 0);
  assert.equal(h.renders(), 1); assert.equal(h.closed(), true);
  assert.equal(h.sandbox.tlSubmitBtn.disabled, false);
});
test('Web: failed zero-hour write does not inflate stats or close the form', async () => {
  const h = webHarness({ failWrite: true }); await h.submit();
  assert.equal(h.state.stats.totalEntries, 1); assert.equal(h.state.log.length, 0);
  assert.equal(h.closed(), false); assert.equal(h.sandbox.tlSubmitBtn.disabled, false);
  assert.match(h.errors.at(-1), /Mock write failed/);
});
test('Android: failed zero-hour write shows the error, not a success alert', async () => {
  const h = nativeHarness({ failWrite: true }); await h.submit();
  assert.equal(h.alerts.length, 0); assert.match(h.error(), /Mock write failed/); assert.equal(h.state[10], false);
});
