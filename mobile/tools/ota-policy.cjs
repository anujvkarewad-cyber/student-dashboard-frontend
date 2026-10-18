const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHANNELS = ['preview', 'production'];

function configureOta(config, env = process.env) {
  const flag = String(env.UPM_OTA_ENABLED || '0');
  if (!['0', '1'].includes(flag)) throw new Error('UPM_OTA_ENABLED must be 0 or 1.');
  if (flag !== '1') {
    // Existing non-OTA build profiles remain explicitly disabled. Nothing is
    // enabled just by installing the package or checking out this source.
    return { ...config, updates: { ...config.updates, enabled: false } };
  }
  const projectId = String(env.EAS_PROJECT_ID || '').trim();
  if (!UUID.test(projectId)) throw new Error('Set the real EAS_PROJECT_ID before enabling OTA. No placeholder project is allowed.');
  if (config.extra?.eas?.projectId && config.extra.eas.projectId !== projectId) throw new Error('EAS project identity conflicts with the existing app config.');
  const channel = String(env.UPM_OTA_CHANNEL || '').trim();
  if (!CHANNELS.includes(channel)) throw new Error('UPM_OTA_CHANNEL must be preview or production.');
  return {
    ...config,
    runtimeVersion: { policy: 'fingerprint' },
    updates: {
      ...config.updates,
      enabled: true,
      url: `https://u.expo.dev/${projectId}`,
      requestHeaders: { ...config.updates?.requestHeaders, 'expo-channel-name': channel },
      checkAutomatically: 'ON_LOAD',
      fallbackToCacheTimeout: 0,
      useEmbeddedUpdate: true,
      disableAntiBrickingMeasures: false,
    },
    extra: { ...config.extra, eas: { ...config.extra?.eas, projectId } },
  };
}

function gatewayOrigin(env = process.env) {
  const value = String(env.EXPO_PUBLIC_API_BASE_URL || '').trim().replace(/\/+$/, '').replace(/\/api\/proxy$/, '');
  let url;
  try { url = new URL(value); } catch { throw new Error('A real EXPO_PUBLIC_API_BASE_URL is required for an OTA release.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new Error('OTA gateway must be an HTTPS origin without credentials, query or fragment.');
  }
  return url.origin;
}

function assertBaselineBuild(config, ledger) {
  const code = config.android?.versionCode;
  if (!Number.isInteger(code) || code < ledger.minimumNewBaselineVersionCode) {
    throw new Error('The OTA baseline needs a new approved Android versionCode; the existing 46 build cannot gain native OTA support.');
  }
}

function assertApprovedRuntime(summary, ledger, env = process.env) {
  const approved = ledger?.channels?.[summary.channel];
  if (!approved || approved.deviceValidated !== true) throw new Error('No device-validated OTA baseline recorded for this channel. Publishing is blocked.');
  for (const key of ['projectId', 'runtimeVersion', 'gatewayOrigin', 'version', 'versionCode']) {
    if (!summary[key] || summary[key] !== approved[key]) throw new Error(`OTA ${key} does not match the approved native baseline. Do not publish; inspect the change or prepare a new baseline.`);
  }
  if (env.EXPO_PUBLIC_APP_VERSION && env.EXPO_PUBLIC_APP_VERSION !== summary.version) throw new Error('Stale EXPO_PUBLIC_APP_VERSION differs from the native baseline version.');
  if (approved.backendMode !== env.EXPO_PUBLIC_BACKEND_MODE) throw new Error('Backend mode differs from the validated baseline.');
  if (String(env.EXPO_PUBLIC_ALLOW_MODE_SWITCH || 'false') !== 'false') throw new Error('Student OTA releases must not enable the backend mode switch.');
  if (summary.channel === 'production' && env.EXPO_PUBLIC_BACKEND_MODE !== 'live') throw new Error('Production OTA must use the live backend mode.');
  if (!approved.androidSigningCertificateSha256 || !/^[a-f0-9]{64}$/i.test(approved.androidSigningCertificateSha256)) {
    throw new Error('The validated baseline signing certificate fingerprint must be recorded first.');
  }
  if (!approved.baseApkSha256 || !/^[a-f0-9]{64}$/i.test(approved.baseApkSha256)) throw new Error('Record the actual tested baseline APK checksum first.');
  if (!approved.testedBuildReference) throw new Error('Record the actual tested build reference first.');
}

module.exports = { configureOta, gatewayOrigin, assertBaselineBuild, assertApprovedRuntime };
