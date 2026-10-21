const path = require('node:path');
const { getConfig } = require('expo/config');
const { resolveRuntimeVersionAsync } = require('expo-updates/utils/build/resolveRuntimeVersionAsync');
const { gatewayOrigin, assertApprovedRuntime, assertBaselineBuild } = require('./ota-policy.cjs');

async function inspectRuntime() {
  const root = path.resolve(__dirname, '..');
  const { exp } = getConfig(root, { isPublicConfig: true });
  if (!exp.updates?.enabled) throw new Error('OTA is disabled. Supply the real EAS project and explicit OTA channel to inspect it.');
  if (process.env.EXPO_UPDATES_FINGERPRINT_OVERRIDE || process.env.EXPO_UPDATES_WORKFLOW_OVERRIDE) throw new Error('Runtime overrides are not allowed in the guarded release pipeline.');
  const runtime = await resolveRuntimeVersionAsync(root, 'android', { silent: true }, {});
  if (runtime.workflow !== 'managed') throw new Error('Tracked native projects need a separate runtime review before using this managed OTA pipeline.');
  if (!runtime.runtimeVersion || !/^[a-f0-9]{40,64}$/i.test(runtime.runtimeVersion)) throw new Error('Expected a resolved native fingerprint runtime.');
  const summary = {
    projectId: exp.extra.eas.projectId,
    channel: exp.updates.requestHeaders['expo-channel-name'],
    runtimeVersion: runtime.runtimeVersion,
    version: exp.version,
    versionCode: exp.android.versionCode,
    gatewayOrigin: gatewayOrigin(),
  };
  return { summary, config: exp };
}

async function preflight(mode = '--inspect') {
  if (!['--inspect', '--publish', '--baseline-build'].includes(mode)) throw new Error('Expected --inspect, --publish, or --baseline-build.');
  const { summary, config } = await inspectRuntime();
  const ledger = require('../ota-baselines.json');
  if (mode === '--publish') assertApprovedRuntime(summary, ledger);
  if (mode === '--baseline-build') assertBaselineBuild(config, ledger);
  return summary;
}

if (require.main === module) {
  preflight(process.argv[2]).then((summary) => console.log(JSON.stringify(summary, null, 2))).catch((error) => {
    console.error(`OTA preflight blocked: ${error.message}`);
    process.exitCode = 1;
  });
}
module.exports = { inspectRuntime, preflight };
