const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');

// This file drives the real release shell script through a bash PATH override, so it needs a POSIX
// shell. On a machine without bash (a stock Windows checkout) every assertion here is unsatisfiable:
// spawnSync reports no status, which would make the "must refuse" cases pass for the wrong reason and
// the "must promote" cases fail. Skip loudly instead. CI runs this file on ubuntu-latest
// (.github/workflows/ci.yml -> mobile job -> npm test), where the guard is inert and all 8 assertions run.
const BASH_OK = (() => {
  try { return spawnSync('bash', ['--version'], { timeout: 5000, windowsHide: true }).status === 0; }
  catch { return false; }
})();
function skipWithoutShell(t) {
  if (BASH_OK) return false;
  t.skip('needs bash to run the shell release script; enforced by the ubuntu CI job, not this machine');
  return true;
}

// The real release shell script runs here with fake git/gcloud/curl commands.
// No credentials are supplied and no request, build or deployment can occur.
function simulate(mode = 'success', overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upm-release-test-'));
  const log = path.join(dir, 'commands.jsonl');
  function executable(name, source) {
    fs.writeFileSync(path.join(dir, name), `#!/usr/bin/env node\n${source}`, { mode: 0o755 });
  }
  executable('git', `
const fs=require('node:fs'); const args=process.argv.slice(2); const counter=process.env.TEST_DIR+'/git-count';
if(args[0]==='rev-parse') console.log('a'.repeat(40));
else if(args[0]==='ls-remote') {let n=fs.existsSync(counter)?Number(fs.readFileSync(counter,'utf8')):0; fs.writeFileSync(counter,String(++n)); console.log((process.env.TEST_MODE==='stale'&&n>1?'b':'a').repeat(40)+'\\trefs/heads/main');}
else process.exit(90);
`);
  executable('gcloud', `
const fs=require('node:fs'); const args=process.argv.slice(2); fs.appendFileSync(process.env.TEST_LOG,JSON.stringify(args)+'\\n');
if(args.includes('describe')) {
 const file=process.env.TEST_DIR+'/describe-count'; let n=fs.existsSync(file)?Number(fs.readFileSync(file,'utf8')):0; fs.writeFileSync(file,String(++n));
 console.log(JSON.stringify(n===1?{status:{url:'https://production.example.test',traffic:[{revisionName:'old-a',percent:60},{revisionName:'old-b',percent:40}]}}:{status:{traffic:[{tag:'candidate-'+ 'a'.repeat(10),revisionName:'candidate-revision',url:'https://candidate.example.test'}]}}));
} else if(args.includes('deploy')) {
 if(process.env.TEST_MODE==='build-fails') process.exit(9);
} else if(!args.includes('update-traffic')) process.exit(91);
`);
  executable('curl', `
const fs=require('node:fs');const args=process.argv.slice(2);const url=args.find(v=>v.startsWith('https://'));
if(!url) process.exit(92);
if(process.env.TEST_MODE==='candidate-fails'&&url.includes('candidate.')) process.exit(22);
if(process.env.TEST_MODE==='production-fails'&&url.includes('production.')) process.exit(22);
if(url.endsWith('/api/health')) console.log(JSON.stringify({ok:true,backendConfigured:true}));
else if(url.endsWith('/app.js')) process.stdout.write(process.env.TEST_MODE==='wrong-bundle'?'wrong bundle':fs.readFileSync(process.env.TEST_ROOT+'/app.js','utf8'));
else if(!args.includes('-o')) console.log('<html>mock</html>');
`);
  try {
    const result = spawnSync('bash', ['scripts/auto-deploy-student-web.sh'], {
      cwd: root, encoding: 'utf8', timeout: 15000,
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CI: 'true', UPM_WEB_DEPLOY_ENABLED: '1',
        UPM_RELEASE_SHA: 'a'.repeat(40), GCP_PROJECT_ID: 'ump-dashboard', GCP_REGION: 'asia-south1', GCP_WEB_SERVICE: 'student-dashboard',
        TEST_ROOT: root, TEST_DIR: dir, TEST_MODE: mode, TEST_LOG: log, ...overrides },
    });
    const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
    return { ...result, calls, traffic: calls.filter((args) => args.includes('update-traffic')) };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('web automation is inert without the explicit release switch', (t) => {
  if (skipWithoutShell(t)) return;
  const r = simulate('success', { UPM_WEB_DEPLOY_ENABLED: '' }); assert.notEqual(r.status, 0); assert.equal(r.calls.length, 0);
});
test('web automation refuses to touch the mentor backend', (t) => {
  if (skipWithoutShell(t)) return;
  const r = simulate('success', { GCP_WEB_SERVICE: 'ujjwal-pathak-app' }); assert.notEqual(r.status, 0); assert.equal(r.calls.length, 0);
});
test('failed Cloud Build cannot change live traffic', (t) => {
  if (skipWithoutShell(t)) return;
  const r = simulate('build-fails'); assert.notEqual(r.status, 0); assert.equal(r.traffic.length, 0);
});
test('failed candidate health check cannot change live traffic', (t) => {
  if (skipWithoutShell(t)) return;
  const r = simulate('candidate-fails'); assert.notEqual(r.status, 0); assert.equal(r.traffic.length, 0);
});
test('wrong served JS blocks promotion even if health passes', (t) => {
  if (skipWithoutShell(t)) return;
  const r = simulate('wrong-bundle'); assert.notEqual(r.status, 0); assert.equal(r.traffic.length, 0);
});
test('a superseded commit is not promoted after a long build', (t) => {
  if (skipWithoutShell(t)) return;
  const r = simulate('stale'); assert.notEqual(r.status, 0); assert.equal(r.traffic.length, 0);
});
test('successful candidate is promoted exactly once', (t) => {
  if (skipWithoutShell(t)) return;
  const r = simulate(); assert.equal(r.status, 0, r.stderr); assert.equal(r.traffic.length, 1);
  assert.ok(r.traffic[0].includes('candidate-revision=100'));
  const deploy = r.calls.find((args) => args.includes('deploy'));
  assert.ok(deploy.includes('--no-traffic')); assert.ok(!deploy.some((v) => /env-vars|secrets|allow-unauthenticated/.test(v)));
});
test('post-promotion failure restores the previous split, not an assumed 100% revision', (t) => {
  if (skipWithoutShell(t)) return;
  const r = simulate('production-fails'); assert.notEqual(r.status, 0); assert.equal(r.traffic.length, 2);
  assert.ok(r.traffic[0].includes('candidate-revision=100')); assert.ok(r.traffic[1].includes('old-a=60,old-b=40'));
});
