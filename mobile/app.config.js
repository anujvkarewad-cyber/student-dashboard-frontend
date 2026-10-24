const { configureOta } = require('./tools/ota-policy.cjs');

// Keep app.json as the native app's source of truth. OTA identity is explicitly
// supplied by the owner's real Expo project; never generated or guessed here.
module.exports = ({ config }) => {
  // A direct Expo native command must not bypass the EAS/CI environment guard.
  // Local JS inspection/export is not an APK build and may remain offline.
  const nativeCommand = process.argv.slice(1).some((arg) => ['prebuild', 'run:android'].includes(arg));
  const env = nativeCommand ? { ...process.env, UPM_APK_BUILD: '1' } : process.env;
  return configureOta(config, env);
};
