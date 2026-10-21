const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
test('voice controls are wired only into receipt and memory-review UI', () => {
  const receipt = read('src/screens/StudyReceiptScreen.tsx');
  assert.match(receipt, /ReceiptVoiceButton/); assert.match(receipt, /setReviewResponse\(old =>/); assert.match(receipt, /setAnswers\(current =>/);
  assert.doesNotMatch(read('src/screens/WorkbooksScreen.tsx'), /ReceiptVoiceButton|AudioRecorder/);
});
test('recording is user-started, bounded, temporary and has no background permission', () => {
  const source = read('src/components/ReceiptVoiceButton.tsx');
  assert.match(source, /requestRecordingPermissionsAsync/); assert.match(source, /PRACTICE_AUDIO_SECONDS \* 1000/); assert.match(source, /data.size > PRACTICE_AUDIO_BYTES/);
  assert.match(source, /deleteAsync/); assert.match(source, /controller.current\?\.abort/);
  const app = JSON.parse(read('app.json')); const options = app.expo.plugins.find(p => Array.isArray(p) && p[0] === 'expo-audio')[1];
  assert.equal(options.enableBackgroundRecording, false); assert.equal(options.enableBackgroundPlayback, false); assert.ok(app.expo.android.versionCode > 46);
});
test('receipt transcription has explicit confirmation and never calls save/grade itself', () => {
  const source = read('src/components/ReceiptVoiceButton.tsx');
  assert.match(source, /Insert reviewed text & delete recording/); assert.match(source, /Cancel & delete temporary recording/);
  assert.doesNotMatch(source, /createReceipt|evaluateAnswer|\/grade|\/publish/);
});
test('practice session uses existing secure login, not bundled shared secrets', () => {
  const source = read('src/services/practiceTools.ts');
  assert.match(source, /getSavedSession/); assert.match(source, /X-Practice-Token/); assert.match(source, /AbortController/);
  assert.doesNotMatch(source, /mentorSyncSecret|GROQ_API_KEY|JWT_SECRET|syncToken\(/);
});
test('native workbook bridge restricts origin, account and token transport', () => {
  const source = read('src/screens/WorkbooksScreen.tsx');
  assert.match(source, /source.origin !== new URL\(config.gatewayOrigin\).origin/); assert.match(source, /identity.current !== expected/); assert.match(source, /postMessage\(JSON.stringify/);
  assert.doesNotMatch(source, /\?token|password:/);
});
test('abandoned temporary audio cleanup is installed at app startup', () => {
  assert.match(read('App.tsx'), /useEffect\(\(\) => \{ clearAbandonedReceiptAudio/);
  const source = read('src/components/ReceiptVoiceButton.tsx');
  assert.match(source, /AppState.addEventListener/); assert.match(source, /alive.current = false/);
});
