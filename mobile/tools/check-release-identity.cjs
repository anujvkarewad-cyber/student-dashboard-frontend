const fs = require('node:fs');
const path = require('node:path');
function assertReleaseIdentity(app, reference, certificate) {
  if (app.android?.package !== reference.androidPackage) throw new Error('Android application ID changed');
  if (!Number.isInteger(app.android?.versionCode) || app.android.versionCode <= reference.versionCode) throw new Error('versionCode must exceed latest released APK');
  if (!/^[a-f0-9]{64}$/i.test(certificate || '') || certificate.toLowerCase() !== reference.certificateSha256) throw new Error('Signing certificate differs from verified released APK');
}
async function main() {
  const root = path.resolve(__dirname, '..');
  const reference = JSON.parse(fs.readFileSync(path.join(root, 'released-apk-reference.json'), 'utf8'));
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo;
  assertReleaseIdentity(app, reference, process.argv[2]);
  const response = await fetch('https://raw.githubusercontent.com/anujvkarewad-cyber/UPM-Android-Releases/main/latest.json', { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('Cannot recheck current public release metadata');
  const latest = await response.json();
  if (latest.versionCode !== reference.versionCode || latest.sha256 !== reference.apkSha256) throw new Error('Released APK changed; reverify certificate/version reference before building');
  console.log('Package, increasing versionCode and original released signing certificate verified. No publication.');
}
if (require.main === module) main().catch(() => { console.error('Release identity check failed; no build permitted. Verify the reference and signing access.'); process.exitCode = 1; });
module.exports = { assertReleaseIdentity };
