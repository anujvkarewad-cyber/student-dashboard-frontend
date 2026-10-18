const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const YAML = require('yaml');
const { configureOta, gatewayOrigin, assertBaselineBuild, assertApprovedRuntime } = require('../tools/ota-policy.cjs');
const root = path.resolve(__dirname, '../..');
const base = require('../app.json').expo;
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
test('preview and production build profiles are separate; legacy profiles stay opt-in', () => {
  const eas = require('../eas.json');
  for (const [name, channel] of [['ota-preview', 'preview'], ['ota-production', 'production']]) {
    assert.equal(eas.build[name].channel, channel); assert.equal(eas.build[name].env.UPM_OTA_ENABLED, '1');
    assert.equal(eas.build[name].env.UPM_OTA_CHANNEL, channel);
  }
  assert.notEqual(eas.build.apk.env.UPM_OTA_ENABLED, '1');
  assert.equal(eas.build.apk.env.EXPO_PUBLIC_APP_VERSION, undefined);
});
test('unvalidated or missing baseline blocks publication', () => {
  assert.throws(() => assertApprovedRuntime(summary, require('../ota-baselines.json'), fixture), /No device-validated/);
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
  assert.throws(() => assertBaselineBuild(base, ledger()), /new approved Android versionCode/);
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
