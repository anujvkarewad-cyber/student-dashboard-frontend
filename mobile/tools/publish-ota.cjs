const { execFileSync } = require('node:child_process');

async function main() {
  if (process.env.CI !== 'true' || process.env.UPM_OTA_PUBLISH_ENABLED !== '1') {
    throw new Error('OTA publishing is disabled. Only the explicitly activated CI release job may publish.');
  }
  const sha = String(process.env.UPM_RELEASE_SHA || '');
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('A full tested commit SHA is required.');
  const local = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const remote = execFileSync('git', ['ls-remote', 'origin', 'refs/heads/main'], { encoding: 'utf8' }).trim().split(/\s+/)[0];
  if (sha !== local || sha !== remote) throw new Error('Refusing to publish a stale or untested commit.');
  // Reject unauthorized publication before loading Expo or inspecting configuration.
  const { preflight } = require('./ota-preflight.cjs');
  const summary = await preflight('--publish');
  if (summary.channel !== 'production') throw new Error('Automatic release is restricted to the production channel.');
  // Run inside eas env:exec so fingerprint checks use the same EAS environment
  // used for export/publication. This command never builds or publishes an APK.
  execFileSync('eas', [
    'update', '--channel', 'production', '--platform', 'android',
    '--environment', 'production', '--message', `Tested commit ${sha}`,
    '--non-interactive',
  ], { stdio: 'inherit' });
}
if (require.main === module) main().catch((error) => { console.error(`OTA publish blocked: ${error.message}`); process.exitCode = 1; });
module.exports = { main };
