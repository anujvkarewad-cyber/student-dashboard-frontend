const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/components/ReceiptVoiceButton.tsx'), 'utf8');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const drain = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); };

// Execute the actual component and its effects with controlled native adapters.
// These simulate lifecycle/SDK behavior; they do NOT claim real microphone acceptance.
function harness(options = {}) {
  const hooks = [], effects = []; let cursor = 0, tree, listener, sdkListener, granted = options.granted !== false;
  const saved = [];
  const calls = { play: 0, seek: 0, save: 0, prepare: 0, record: 0, stop: 0, permission: 0, close: 0, uploads: 0, inserts: [], deleted: [], modes: [] };
  const uri = 'file:///cache/Audio/recording-test.receipt.m4a';
  const files = new Map([['file:///docs/saved-keep.m4a', 123]]);
  const storage = new Map();
  const appState = { currentState: 'active', addEventListener: (_event, fn) => { listener = fn; return { remove() { listener = undefined; } }; } };
  const emitState = value => { appState.currentState = value; listener?.(value); };
  const recorder = {
    isRecording: false, prepared: false, uri: null,
    getStatus: () => ({ isRecording: recorder.isRecording, canRecord: recorder.prepared, durationMillis: recorder.isRecording ? 4500 : 0, url: recorder.uri }),
    prepareToRecordAsync: async () => { calls.prepare++; if (options.prepareGate) await options.prepareGate.promise; if (options.prepareError) throw Error(options.prepareError); recorder.prepared = true; recorder.uri = uri; },
    record: opts => { assert.equal(opts.forDuration, 120); calls.record++; if (!options.silentNoStart) recorder.isRecording = true; },
    stop: async () => { calls.stop++; recorder.isRecording = false; recorder.prepared = false; files.set(uri, options.emptyFile ? 0 : options.fileBytes ?? 1024); },
  };
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), Fragment: 'Fragment',
    useState: initial => { const id = cursor++; if (!(id in hooks)) hooks[id] = initial; return [hooks[id], value => { hooks[id] = typeof value === 'function' ? value(hooks[id]) : value; }]; },
    useRef: initial => { const id = cursor++; if (!(id in hooks)) hooks[id] = { current: initial }; return hooks[id]; },
    useEffect: (fn, deps) => { const id = cursor++, old = hooks[id]; if (!old || deps.some((v, n) => v !== old.deps[n])) { effects.push(() => { old?.cleanup?.(); const cleanup = fn(); hooks[id] = { deps, cleanup }; }); } },
  };
  const fileSystem = {
    cacheDirectory: 'file:///cache/',
    readDirectoryAsync: async () => [],
    getInfoAsync: async name => ({ exists: files.has(name), isDirectory: false, size: files.get(name) ?? 0 }),
    deleteAsync: async name => { calls.deleted.push(name); files.delete(name); },
  };
  const exports = {};
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
  vm.runInNewContext(js, { exports, Promise, Date, Math, Error, AbortController, URL, setTimeout, clearTimeout, require: name => {
    if (name === 'react') return { __esModule: true, default: react, ...react };
    if (name === 'react-native') return { Alert: { alert() {} }, AppState: appState, Platform: { OS: 'android' }, KeyboardAvoidingView: 'KeyboardAvoidingView', Modal: 'Modal', Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', TextInput: 'TextInput', View: 'View' };
    if (name === 'expo-audio') return {
      RecordingPresets: { HIGH_QUALITY: { ios: {}, android: {} } },
      AudioModule: {
        getRecordingPermissionsAsync: async () => ({ granted }),
        requestRecordingPermissionsAsync: async () => {
          calls.permission++; if (options.permissionBackground) emitState('background');
          if (options.permissionGate) await options.permissionGate.promise;
          granted = !options.deny; return { granted };
        },
      },
      setAudioModeAsync: async mode => { calls.modes.push(mode); },
      useAudioPlayer: () => ({ pause() { if (options.playerThrows) throw Error('No player source'); }, seekTo(position) { assert.equal(position, 0); calls.seek++; }, play() { calls.play++; } }),
      useAudioRecorder: (_opts, fn) => { sdkListener = fn; return recorder; },
      useAudioRecorderState: () => options.stalePoll ? { isRecording: false, durationMillis: 0 } : recorder.getStatus(),
    };
    if (name === 'expo-updates') return { isEmbeddedLaunch: true, updateId: null };
    if (name === 'expo-file-system') return { File: function () {} };
    if (name === 'expo-file-system/legacy') return fileSystem;
    if (name === 'expo/fetch') return { fetch() { calls.uploads++; throw Error('No network allowed in recording test'); } };
    if (name.includes('async-storage')) return { __esModule: true, default: { getItem: async key => storage.get(key) ?? null, setItem: async (k, v) => { storage.set(k, v); }, removeItem: async key => { storage.delete(key); } } };
    if (name.includes('receiptTranscription')) return { transcribeReceiptAudio: async () => { calls.uploads++; if (options.transcript) return options.transcript; throw Error('Connection interrupted. Your recording is unchanged. Retry transcription when connected.'); } };
    if (name.includes('AuthContext')) return { useAuth: () => ({ student: { studentId: 'UMP1' } }) };
    if (name.includes('receiptAudioVault')) return { listReceiptAudio: async () => saved, saveReceiptAudio: async (owner, input) => { assert.equal(owner, 'UMP1'); assert.equal(input, uri); calls.save++; const entry = { id: 'saved-test', uri: 'file:///docs/saved-test.m4a', bytes: 1024, createdAt: new Date().toISOString() }; saved.push(entry); return entry; }, deleteReceiptAudio: async () => {} };
    if (name.includes('practiceTools')) return { PRACTICE_AUDIO_SECONDS: 120, PRACTICE_AUDIO_BYTES: 2 * 1024 * 1024, practiceSession: () => { calls.uploads++; throw Error('No server needed for recording'); } };
    throw Error('Unexpected import: ' + name);
  } });
  function render() { cursor = 0; tree = exports.ReceiptRecorder({ owner: 'UMP1', onClose: () => { calls.close++; }, onInsert: text => calls.inserts.push(text) }); while (effects.length) effects.shift()(); return tree; }
  function nodes(node = tree) { if (!node || typeof node !== 'object') return []; if (Array.isArray(node)) return node.flatMap(n => nodes(n)); return [node, ...nodes(node.props?.children)]; }
  function button(label) { render(); return nodes().find(n => n.props?.accessibilityLabel === label); }
  function text() { render(); return JSON.stringify(tree); }
  async function start() { await button('Start receipt recording').props.onPress(); await drain(); render(); }
  async function stop() { await button('Stop receipt recording').props.onPress(); await drain(); render(); }
  async function pressText(label) { render(); const n = nodes().find(n => n.type === 'Pressable' && JSON.stringify(n.props.children).includes(label)); assert.ok(n, label); assert.ok(!n.props.disabled, label + ' enabled'); await n.props.onPress(); await drain(); render(); }
  async function cancel() { render(); const n = nodes().find(n => n.type === 'Pressable' && JSON.stringify(n.props.children).includes('Cancel & delete temporary recording')); n.props.onPress(); await drain(); }
  render(); return { editTranscript: value => { render(); nodes().find(n => n.type === 'TextInput').props.onChangeText(value); }, calls, recorder, files, storage, emitState, start, stop, cancel, button, text, pressText, emitNative: event => sdkListener(event) };
}

test('Android permission background transition does not close the modal or auto-start audio', async () => {
  const h = harness({ granted: false, permissionBackground: true }); await h.start();
  assert.equal(h.calls.close, 0); assert.equal(h.calls.prepare, 0); assert.equal(h.calls.record, 0);
  assert.match(h.text(), /Microphone allowed. Tap Start recording/);
  h.emitState('active'); await h.start();
  assert.equal(h.calls.record, 1); assert.equal(h.button('Stop receipt recording').props.disabled, false);
});
test('already-granted microphone starts and shows Stop even before the SDK polling hook catches up', async () => {
  const h = harness({ stalePoll: true }); await h.start();
  assert.equal(h.calls.record, 1); assert.equal(h.button('Stop receipt recording').props.disabled, false);
  assert.match(h.text(), /Recording ·/); assert.equal(h.calls.permission, 0); assert.equal(h.calls.uploads, 0);
});
test('idle/released playback player cannot prevent microphone recording', async () => {
  const h = harness({ playerThrows: true }); await h.start(); assert.equal(h.calls.record, 1);
});
test('denied permission produces a visible alert without preparing or recording', async () => {
  const h = harness({ granted: false, deny: true }); await h.start();
  assert.equal(h.calls.record, 0); assert.equal(h.calls.prepare, 0); assert.match(h.text(), /Microphone permission was denied/);
});
test('native prepare failure and silent SDK start failure are visible, never fake recording', async () => {
  for (const opts of [{ prepareError: 'Microphone is busy' }, { silentNoStart: true }]) {
    const h = harness(opts); await h.start();
    assert.equal(h.button('Stop receipt recording').props.disabled, true);
    assert.match(h.text(), /Microphone is busy|microphone did not start/);
  }
});
test('rapid double tap cannot prepare or start the recorder twice', async () => {
  const gate = deferred(); const h = harness({ prepareGate: gate });
  const first = h.start(); await drain(); await h.start(); assert.equal(h.calls.prepare, 1);
  gate.resolve(); await first; assert.equal(h.calls.record, 1);
});
test('cancel during asynchronous preparation releases the late recorder without starting capture', async () => {
  const gate = deferred(); const h = harness({ prepareGate: gate }); const pending = h.start(); await drain();
  await h.cancel(); gate.resolve(); await pending;
  assert.equal(h.calls.record, 0); assert.equal(h.recorder.prepared, false); assert.equal(h.calls.close, 1);
});
test('cancel while permission is open never starts a late recording', async () => {
  const gate = deferred(); const h = harness({ granted: false, permissionGate: gate, permissionBackground: true });
  const pending = h.start(); await drain(); await h.cancel(); gate.resolve(); await pending;
  assert.equal(h.calls.record, 0); assert.equal(h.calls.prepare, 0);
});
test('real background while recording stops and erases only temporary audio, not saved clips', async () => {
  const h = harness(); await h.start(); h.emitState('background'); await drain();
  assert.equal(h.recorder.isRecording, false); assert.equal(h.calls.close, 1);
  assert.equal(h.files.has('file:///docs/saved-keep.m4a'), true); assert.equal(h.calls.uploads, 0);
});
test('stop checks for actual bytes before offering replay/save', async () => {
  const h = harness(); await h.start(); await h.stop();
  assert.match(h.text(), /Replay recording/); assert.match(h.text(), /Save recording on this device/);
  assert.equal(h.calls.uploads, 0);
  const empty = harness({ emptyFile: true }); await empty.start(); await empty.stop();
  assert.match(empty.text(), /No audio was captured/); assert.doesNotMatch(empty.text(), /Replay recording/);
});
test('native recorder error event is surfaced and discards failed temporary audio', async () => {
  const h = harness(); await h.start(); h.emitNative({ hasError: true, error: 'Media server failed', isFinished: true }); await drain();
  assert.match(h.text(), /Media server failed/); assert.equal(h.recorder.isRecording, false);
  assert.doesNotMatch(h.text(), /Replay recording/);
});
test('native duration completion exposes the clip without a server call', async () => {
  const h = harness(); await h.start(); await h.recorder.stop(); h.emitNative({ isFinished: true, hasError: false }); await drain();
  assert.match(h.text(), /Replay recording/); assert.equal(h.calls.uploads, 0);
});

test('background during preparation cannot start late capture after permission was already granted', async () => {
  const gate = deferred(); const h = harness({ prepareGate: gate }); const pending = h.start(); await drain();
  h.emitState('background'); await drain(); gate.resolve(); await pending;
  assert.equal(h.calls.record, 0); assert.equal(h.recorder.prepared, false); assert.equal(h.calls.close, 1);
});
test('oversized captured file is rejected and deleted rather than offered for replay or saving', async () => {
  const h = harness({ fileBytes: 2 * 1024 * 1024 + 1 }); await h.start(); await h.stop();
  assert.match(h.text(), /Recording exceeds 2 MB/); assert.doesNotMatch(h.text(), /Replay recording/);
  assert.equal(h.files.has('file:///cache/Audio/recording-test.receipt.m4a'), false);
});

test('record → stop → replay → explicit device save is wired locally without transcription/upload', async () => {
  const h = harness(); await h.start(); await h.stop();
  await h.pressText('Replay recording'); assert.equal(h.calls.seek, 1); assert.equal(h.calls.play, 1);
  await h.pressText('Save recording on this device'); assert.equal(h.calls.save, 1);
  assert.match(h.text(), /Saved privately on this device/); assert.equal(h.calls.uploads, 0);
  assert.equal(h.calls.modes.at(-1).allowsRecording, false);
});

test('transcript modal resizes above keyboard and keeps padded content scrollable', () => {
  assert.match(source, /return <KeyboardAvoidingView[^>]+behavior=\{Platform\.OS === 'ios' \? 'padding' : 'height'\}/);
  assert.match(source, /<ScrollView style=\{\{ flex: 1 \}\} contentContainerStyle=\{\{ padding: 22, paddingTop: 55, paddingBottom: 40 \}\}/);
  assert.match(source, /automaticallyAdjustKeyboardInsets=\{Platform\.OS === 'ios'\}/);
  assert.match(source, /<\/ScrollView><\/KeyboardAvoidingView>/);
});

test('failed explicit transcription keeps audio and saved selection, offers manual retry only', async () => {
  const h = harness(); await h.start(); await h.stop(); await h.pressText('Save recording on this device');
  await h.pressText('Transcribe with Groq');
  assert.match(h.text(), /Transcription not completed/); assert.match(h.text(), /Your selected recording has not been deleted/);
  assert.match(h.text(), /Saved privately on this device/); assert.equal(h.calls.uploads, 1);
  assert.equal(h.files.has('file:///cache/Audio/recording-test.receipt.m4a'), true);
  await drain(); assert.equal(h.calls.uploads, 1);
  await h.pressText('Retry transcription with Groq'); assert.equal(h.calls.uploads, 2);
});
test('recorder separates recording, transcription, review, storage and privacy panels', async () => {
  const h = harness(); assert.match(h.text(), /1 \/ YOUR RECORDING/); assert.match(h.text(), /Privacy & storage/);
  assert.doesNotMatch(h.text(), /Transcription not completed/);
  await h.start(); await h.stop(); assert.match(h.text(), /2 \/ TRANSCRIBE/);
  assert.doesNotMatch(h.text(), /Tap Start recording. Nothing is being recorded yet/);
});

test('successful transcription is editable and only explicit Insert returns reviewed text once', async () => {
  const h = harness({ transcript: 'Original transcript' }); await h.start(); await h.stop(); await h.pressText('Save recording on this device');
  await h.pressText('Transcribe with Groq'); assert.equal(h.calls.inserts.length, 0); assert.match(h.text(), /3 \/ REVIEW & INSERT/);
  h.editTranscript('Reviewed and corrected transcript'); await h.pressText('Insert reviewed text');
  assert.deepEqual(h.calls.inserts, ['Reviewed and corrected transcript']); assert.equal(h.calls.close, 1);
  assert.equal(h.calls.save, 1); assert.equal(h.calls.uploads, 1);
});
