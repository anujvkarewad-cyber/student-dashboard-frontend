const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const YAML = require('yaml');
const { configureOta, gatewayOrigin, assertBaselineBuild, assertApprovedRuntime } = require('../tools/ota-policy.cjs');
const root = path.resolve(__dirname, '../..');
const actualBase = require('../app.json').expo;
// Unlinked synthetic fixture for configuration-policy tests; never mutate real identity.
const base = structuredClone(actualBase);
delete base.extra?.eas?.projectId;
// Synthetic fixtures only. These are never written into app config, the baseline
// ledger or a publishing command, and never sent to an Expo endpoint.
const fixture = {
  UPM_OTA_ENABLED: '1', EAS_PROJECT_ID: '123e4567-e89b-12d3-a456-426614174000', UPM_OTA_CHANNEL: 'production',
  EXPO_PUBLIC_API_BASE_URL: 'https://gateway.example.test', EXPO_PUBLIC_BACKEND_MODE: 'live', EXPO_PUBLIC_ALLOW_MODE_SWITCH: 'false',
};
const summary = { projectId: fixture.EAS_PROJECT_ID, channel: 'production', runtimeVersion: 'a'.repeat(40), gatewayOrigin: fixture.EXPO_PUBLIC_API_BASE_URL, version: 'test-baseline', versionCode: 47 };
const approved = { ...summary, deviceValidated: true, backendMode: 'live', androidSigningCertificateSha256: 'b'.repeat(64), baseApkSha256: 'c'.repeat(64), testedBuildReference: 'synthetic-unit-test-only' };
const ledger = () => ({ schemaVersion: 1, minimumNewBaselineVersionCode: 47, channels: { production: { ...approved } } });

function readYaml(file) {
  const doc = YAML.parseDocument(fs.readFileSync(path.join(root, '.github/workflows', file), 'utf8'));
  assert.equal(doc.errors.length, 0); return doc.toJS();
}

test('OTA is off by default and existing native identity stays unchanged', () => {
  const before = JSON.stringify(base); const config = configureOta(base, {});
  assert.equal(config.updates.enabled, false); assert.equal(config.updates.url, undefined);
  assert.equal(config.version, base.version); assert.deepEqual(config.android, base.android);
  assert.equal(JSON.stringify(base), before);
});
test('enabled OTA without an actual project identity fails closed', () => {
  assert.throws(() => configureOta(base, { UPM_OTA_ENABLED: '1', UPM_OTA_CHANNEL: 'production' }), /real EAS_PROJECT_ID/);
});
for (const id of ['', 'guess', '00000000-0000-0000-0000-000000000000', 'https://expo.dev/project']) {
  test(`invalid project identity rejected: ${JSON.stringify(id)}`, () => assert.throws(() => configureOta(base, { ...fixture, EAS_PROJECT_ID: id }), /EAS_PROJECT_ID/));
}
test('conflicting existing EAS project identity is not overwritten', () => {
  assert.throws(() => configureOta({ ...base, extra: { eas: { projectId: 'different-existing-project' } } }, fixture), /conflicts/);
});
for (const channel of ['', 'main', 'typo', '../../production']) {
  test(`unknown or omitted channel rejected: ${JSON.stringify(channel)}`, () => assert.throws(() => configureOta(base, { ...fixture, UPM_OTA_CHANNEL: channel }), /UPM_OTA_CHANNEL/));
}
test('activation flag typos cannot silently disable or enable OTA', () => assert.throws(() => configureOta(base, { UPM_OTA_ENABLED: 'true' }), /0 or 1/));
for (const channel of ['preview', 'production']) {
  test(`${channel}: background launch check preserves cached/embedded app and safety measures`, () => {
    const config = configureOta(base, { ...fixture, UPM_OTA_CHANNEL: channel });
    assert.equal(config.updates.enabled, true); assert.equal(config.updates.requestHeaders['expo-channel-name'], channel);
    assert.equal(config.updates.url, `https://u.expo.dev/${fixture.EAS_PROJECT_ID}`);
    assert.equal(config.updates.checkAutomatically, 'ON_LOAD'); assert.equal(config.updates.fallbackToCacheTimeout, 0);
    assert.equal(config.updates.useEmbeddedUpdate, true); assert.equal(config.updates.disableAntiBrickingMeasures, false);
    assert.deepEqual(config.runtimeVersion, { policy: 'fingerprint' });
  });
}
test('every EAS build profile requires OTA with an explicit channel', () => {
  const eas = require('../eas.json');
  for (const [name, channel] of [['ota-preview', 'preview'], ['ota-production', 'production']]) {
    assert.equal(eas.build[name].channel, channel); assert.equal(eas.build[name].env.UPM_OTA_ENABLED, '1');
    assert.equal(eas.build[name].env.UPM_OTA_CHANNEL, channel);
  }
  for (const profile of Object.values(eas.build)) {
    assert.equal(profile.env.UPM_OTA_ENABLED, '1'); assert.equal(profile.env.UPM_APK_BUILD, '1');
    assert.ok(['preview', 'production'].includes(profile.channel)); assert.equal(profile.env.UPM_OTA_CHANNEL, profile.channel);
  }
  assert.equal(eas.build.apk.env.EXPO_PUBLIC_APP_VERSION, undefined);
});
test('unvalidated or missing baseline blocks publication', () => {
  assert.throws(() => assertApprovedRuntime(summary, { schemaVersion: 1, minimumNewBaselineVersionCode: 47, channels: { production: null } }, fixture), /No device-validated/);
  const data = ledger(); data.channels.production.deviceValidated = false;
  assert.throws(() => assertApprovedRuntime(summary, data, fixture), /No device-validated/);
});
for (const key of ['projectId', 'runtimeVersion', 'gatewayOrigin', 'version', 'versionCode']) {
  test(`changed ${key} cannot be published to the old approved runtime`, () => {
    assert.throws(() => assertApprovedRuntime({ ...summary, [key]: key === 'versionCode' ? 48 : 'changed' }, ledger(), fixture), /does not match/);
  });
}
test('approved fixture accepts compatible JS updates without bumping native app version', () => assert.doesNotThrow(() => assertApprovedRuntime(summary, ledger(), fixture)));
test('production cannot be published with mock mode or an enabled mode switch', () => {
  assert.throws(() => assertApprovedRuntime(summary, ledger(), { ...fixture, EXPO_PUBLIC_BACKEND_MODE: 'mock' }), /mode/);
  assert.throws(() => assertApprovedRuntime(summary, ledger(), { ...fixture, EXPO_PUBLIC_ALLOW_MODE_SWITCH: 'true' }), /mode switch/);
});
for (const key of ['androidSigningCertificateSha256', 'baseApkSha256', 'testedBuildReference']) {
  test(`missing ${key} blocks baseline approval`, () => {
    const data = ledger(); delete data.channels.production[key];
    assert.throws(() => assertApprovedRuntime(summary, data, fixture));
  });
}
test('the old code-46 binary cannot be republished as an OTA-enabled baseline', () => {
  assert.throws(() => assertBaselineBuild({ ...base, android: { ...base.android, versionCode: 46 } }, ledger()), /new approved Android versionCode/);
  assert.doesNotThrow(() => assertBaselineBuild({ ...base, android: { ...base.android, versionCode: 47 } }, ledger()));
});
for (const url of ['', 'http://gateway.example.test', 'https://user:pass@gateway.example.test', 'https://gateway.example.test/?secret=x', 'https://gateway.example.test/arbitrary-path']) {
  test(`unsafe/missing gateway origin rejected: ${JSON.stringify(url)}`, () => assert.throws(() => gatewayOrigin({ EXPO_PUBLIC_API_BASE_URL: url })));
}
test('existing /api/proxy suffix is normalized consistently with the mobile config', () => assert.equal(gatewayOrigin({ EXPO_PUBLIC_API_BASE_URL: 'https://gateway.example.test/api/proxy/' }), 'https://gateway.example.test'));

test('automatic release requires successful main-push CI, same repo and owner activation', () => {
  const flow = readYaml('student-auto-release.yml');
  assert.deepEqual(flow.on.workflow_run.workflows, ['CI']); assert.deepEqual(flow.on.workflow_run.types, ['completed']);
  const gate = flow.jobs.release.if;
  for (const phrase of ["UPM_AUTO_RELEASE_ENABLED == 'true'", "conclusion == 'success'", "event == 'push'", "head_branch == 'main'", 'head_repository.full_name == github.repository']) assert.ok(gate.includes(phrase));
  const checkout = flow.jobs.release.steps.find((step) => step.uses?.startsWith('actions/checkout'));
  assert.equal(checkout.with.ref, '${{ github.event.workflow_run.head_sha }}');
});
test('routine pushes no longer trigger APK builds or retired Vercel deployment', () => {
  for (const name of ['production-apk.yml', 'vercel-auto-deploy.yml']) {
    const flow = readYaml(name); assert.equal(flow.on.push, undefined); assert.ok(Object.hasOwn(flow.on, 'workflow_dispatch'));
  }
  assert.match(readYaml('vercel-auto-deploy.yml').jobs.deploy.if, /UPM_LEGACY_VERCEL_DEPLOY_ENABLED/);
});
test('CI runs mobile regression tests as well as the typecheck', () => {
  const runs = readYaml('ci.yml').jobs.mobile.steps.map((s) => s.run);
  assert.ok(runs.includes('npm test')); assert.ok(runs.includes('npm run typecheck'));
});
test('automatic OTA publisher does not build APKs or write the APK release manifest', () => {
  const publisher = fs.readFileSync(path.join(root, 'mobile/tools/publish-ota.cjs'), 'utf8');
  assert.doesNotMatch(publisher, /assembleRelease|eas build|writeFile|latest\.json/);
  assert.match(publisher, /preflight\('--publish'\)/); assert.match(publisher, /ls-remote/);
});
test('OTA publish refuses to run outside explicitly enabled CI', () => {
  const result = spawnSync(process.execPath, ['tools/publish-ota.cjs'], { cwd: path.join(root, 'mobile'), env: { ...process.env, CI: '', UPM_OTA_PUBLISH_ENABLED: '' }, encoding: 'utf8' });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /publishing is disabled/);
});
test('web release target is guarded, environment is preserved and promotion follows smoke checks', () => {
  const script = fs.readFileSync(path.join(root, 'scripts/auto-deploy-student-web.sh'), 'utf8');
  assert.match(script, /UPM_WEB_DEPLOY_ENABLED/); assert.match(script, /student-dashboard/);
  assert.match(script, /--no-traffic/); assert.match(script, /old_routes/);
  assert.doesNotMatch(script, /--set-env-vars|--update-env-vars|--set-secrets|--allow-unauthenticated/);
  assert.ok(script.indexOf('smoke "$candidate_url"') < script.indexOf('promoting=1'));
});
test('temporary CI credentials and signing files are excluded from source uploads', () => {
  for (const file of ['.gitignore', '.gcloudignore', '.dockerignore']) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(text.includes('gha-creds-*.json')); assert.ok(text.includes('*.jks')); assert.ok(text.includes('*.keystore'));
  }
});

test('stale build-time display version is rejected instead of mislabeling OTA clients', () => {
  assert.throws(() => assertApprovedRuntime(summary, ledger(), { ...fixture, EXPO_PUBLIC_APP_VERSION: '1.14.6' }), /Stale EXPO_PUBLIC_APP_VERSION/);
});


test('native build context cannot silently fall back to disabled OTA', () => {
  for (const context of [{ UPM_APK_BUILD: '1' }, { EAS_BUILD: 'true' }]) {
    assert.throws(() => configureOta(base, context), /Every new APK requires true OTA/);
    assert.throws(() => configureOta(base, { ...context, UPM_OTA_ENABLED: '0' }), /Every new APK requires true OTA/);
    assert.throws(() => configureOta(base, { ...context, UPM_OTA_ENABLED: '1', UPM_OTA_CHANNEL: 'production' }), /real EAS_PROJECT_ID/);
    assert.equal(configureOta(base, { ...fixture, ...context }).updates.enabled, true);
  }
});
test('signed workflow requires OTA preflight before prebuild and keeps publish opt-in', () => {
  const flow = readYaml('production-apk.yml'), job = flow.jobs['build-signed'];
  assert.equal(flow.on.workflow_dispatch.inputs.ota_baseline.default, true);
  assert.equal(flow.on.workflow_dispatch.inputs.publish_live.default, false);
  assert.equal(job.env.UPM_APK_BUILD, '1'); assert.equal(job.env.UPM_OTA_ENABLED, '1');
  const guard = job.steps.find(step => step.name === 'Refuse a non-OTA APK request');
  assert.match(guard.if, /ota_baseline != true/); assert.match(guard.run, /exit 1/);
  const preflight = job.steps.findIndex(step => step.run?.includes('node tools/ota-preflight.cjs --baseline-build'));
  const prebuild = job.steps.findIndex(step => step.name === 'Prebuild Android');
  assert.ok(preflight >= 0 && preflight < prebuild); assert.equal(job.steps[preflight].if, undefined);
  assert.match(job.steps[preflight].run, /candidate-ota-preflight\.json/);
  assert.match(job.steps[preflight].run, /UPM_PREFLIGHT_RUNTIME=.*GITHUB_ENV/);
  for (const step of job.steps.filter(step => /Create GitHub Release|Publish APK to/.test(step.name))) assert.match(step.if, /publish_live == true/);
});
test('old unsigned/non-OTA preview pipeline no longer builds or runs on push', () => {
  const flow = readYaml('mobile-preview-apk.yml');
  assert.equal(flow.on.push, undefined); assert.ok(Object.hasOwn(flow.on, 'workflow_dispatch'));
  const text = fs.readFileSync(path.join(root, '.github/workflows/mobile-preview-apk.yml'), 'utf8');
  assert.doesNotMatch(text, /assembleRelease|expo prebuild|upload-artifact/);
  assert.match(text, /exit 1/);
});


test('direct Expo native commands cannot bypass the mandatory OTA flag', () => {
  for (const command of ['prebuild', 'run:android']) {
    const result = spawnSync(process.execPath, ['-e', "require('./app.config.js')({config:require('./app.json').expo})", command], {
      cwd: path.join(root, 'mobile'), env: { ...process.env, UPM_APK_BUILD: '', EAS_BUILD: '', UPM_OTA_ENABLED: '0' }, encoding: 'utf8',
    });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /Every new APK requires true OTA/);
  }
});


test('owner-supplied existing Expo project is pinned without changing Android identity', () => {
  assert.equal(actualBase.owner, 'anujkarewad');
  assert.equal(actualBase.extra.eas.projectId, 'fc2cb9eb-e3f0-40b2-9a74-7c996902602c');
  assert.equal(actualBase.android.package, 'com.ujjwalpathak.mentorship');
  const result=configureOta(actualBase, {...fixture, EAS_PROJECT_ID:actualBase.extra.eas.projectId});
  assert.equal(result.updates.url, 'https://u.expo.dev/fc2cb9eb-e3f0-40b2-9a74-7c996902602c');
});
test('a different project cannot overwrite the now-pinned owner project', () => {
  assert.throws(() => configureOta(actualBase, fixture), /conflicts/);
});
test('owner-test workflow cannot publish even if publication input is accidentally true', () => {
  const flow=readYaml('production-apk.yml');
  assert.equal(flow.permissions.contents,'read');
  const steps=flow.jobs['build-signed'].steps;
  const guard=steps.find(s=>s.name==='Refuse publication in owner-test workflow');
  assert.match(guard.if,/publish_live == true/); assert.match(guard.run,/exit 1/);
  assert.equal(steps.some(s=>/Create GitHub Release|Publish APK to|Validate live update/.test(s.name)),false);
  assert.equal(steps.find(s=>s.name==='Upload artifact')['continue-on-error'],undefined);
});


test('private native build bounds memory without skipping lint or tests', () => {
 const job=readYaml('production-apk.yml').jobs['build-signed'];
 const tune=job.steps.findIndex(s=>s.name==='Bound Gradle memory after prebuild without changing signing');
 const build=job.steps.findIndex(s=>s.name==='Build signed release APK');
 assert.ok(tune>=0 && tune<build);
 assert.match(job.steps[build].run,/--max-workers=2/);
 assert.doesNotMatch(job.steps[build].run,/-x |exclude-task|lintVital.*false/);
 const script=fs.readFileSync(path.join(root,'mobile/tools/configure-ci-gradle.py'),'utf8');
 assert.match(script,/MaxMetaspaceSize=1536m/);assert.match(script,/ExitOnOutOfMemoryError/);
 assert.match(script,/kotlin.compiler.execution.strategy/);
});
