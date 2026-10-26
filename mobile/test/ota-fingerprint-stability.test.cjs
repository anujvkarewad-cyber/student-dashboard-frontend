const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DEFAULT_IGNORE_PATHS } = require('@expo/fingerprint/build/Options');
const { createDirHashResultsAsync } = require('@expo/fingerprint/build/hash/Hash');
const { buildPathMatchObjects, buildDirMatchObjects } = require('@expo/fingerprint/build/utils/Path');
const { createLimiter } = require('@expo/fingerprint/build/utils/Concurrency');
const mobile = path.resolve(__dirname, '..');
const plugin = 'node_modules/expo-updates/expo-updates-gradle-plugin';
const ignores = fs.readFileSync(path.join(mobile, '.fingerprintignore'), 'utf8').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));

async function withPlugin(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upm-fingerprint-test-'));
  try {
    fs.cpSync(path.join(mobile, plugin), path.join(root, plugin), { recursive: true });
    // Work only on disposable fixture copies, never mutate installed dependencies.
    fs.rmSync(path.join(root, plugin, '.kotlin'), { force: true, recursive: true });
    const hash = async (custom = true) => {
      const match = buildPathMatchObjects([...DEFAULT_IGNORE_PATHS, ...(custom ? ignores : [])]);
      const value = await createDirHashResultsAsync(plugin, createLimiter(4), root, {
        hashAlgorithm: 'sha1', concurrentIoLimit: 4, enableReactImportsPatcher: false,
        ignorePathMatchObjects: match, ignoreDirMatchObjects: buildDirMatchObjects(match),
      });
      return value.hex;
    };
    const add = (name, value) => { const file = path.join(root, plugin, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
    await fn({ root, hash, add });
  } finally { fs.rmSync(root, { force: true, recursive: true }); }
}

test('the installed fingerprint implementation reproduces Kotlin-session cache drift without the narrow exclusion', async () => {
  await withPlugin(async ({ hash, add }) => {
    const clean = await hash(false);
    add('.kotlin/sessions/kotlin-compiler-test.salive', '');
    assert.notEqual(await hash(false), clean);
  });
});

test('the narrow Kotlin cache exclusion preserves the clean fingerprint across generated session/error files', async () => {
  assert.deepEqual(ignores, ['**/.kotlin/**/*']);
  await withPlugin(async ({ hash, add }) => {
    const original = await hash(false);
    assert.equal(await hash(), original, 'clean native inputs must retain their real hash');
    add('.kotlin/sessions/kotlin-compiler-test.salive', '');
    add('.kotlin/errors/build-session.log', 'synthetic generated cache, not source');
    assert.equal(await hash(), original);
  });
});

test('real Kotlin and Gradle changes remain fingerprinted; no native-source exclusion or forced runtime', async () => {
  await withPlugin(async ({ hash, add }) => {
    const clean = await hash();
    add('src/main/kotlin/expo/modules/updates/OwnerRegressionFixture.kt', '// Native source must change the hash.');
    const sourceChanged = await hash(); assert.notEqual(sourceChanged, clean);
    add('build.gradle.kts', '// Changed Gradle build logic must change the hash too.');
    assert.notEqual(await hash(), sourceChanged);
  });
  const config = fs.readFileSync(path.join(mobile, 'tools/ota-policy.cjs'), 'utf8');
  assert.match(config, /runtimeVersion: \{ policy: 'fingerprint' \}/);
});
