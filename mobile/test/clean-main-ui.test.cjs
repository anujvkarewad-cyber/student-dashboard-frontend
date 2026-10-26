const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '../src', name), 'utf8');
test('receipt UI contains no diagnostic release markers or OTA identity', () => {
  const source = read('components/ReceiptVoiceButton.tsx');
  assert.doesNotMatch(source, /Recorder layout K1|Receipt R2|Daily D2|Updates\.updateId|expo-updates/);
  assert.match(source, /Study receipt/);
});
test('official Daily MCQ copy has no test release marker', () => {
  const source = read('screens/DailyMcqScreen.tsx');
  assert.doesNotMatch(source, /Daily D2/);
  assert.match(source, /Your official 10-question set/);
});
test('profile hides owner test controls without changing student sharing', () => {
  const source = read('screens/ProfileScreen.tsx');
  assert.match(source, /ownerSyncTest = student\?\.studentId === 'UMP0000'/);
  assert.match(source, /\{!ownerSyncTest && <View style=\{\[styles\.shareCard/);
  assert.doesNotMatch(source, /Private owner sync test|Owner-only test storage|Server acknowledgement confirmed|syncProgressNow|Last confirmed:/);
  assert.match(source, /setProgressSharing\(on\)/);
  assert.match(source, /Share MCQ progress with mentor/);
});
