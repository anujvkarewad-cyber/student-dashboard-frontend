const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function harness(fetchImpl) {
  let session = { studentId: 'UMP0001', password: 'synthetic-test-password', student: { name: 'cached-profile' } };
  const calls = [], exports = {};
  const text = fs.readFileSync(path.join(__dirname, '../src/services/mcqCloudSync.ts'), 'utf8');
  const code = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS }}).outputText;
  vm.runInNewContext(code, { exports, AbortController, setTimeout, clearTimeout, Map, Promise,
    fetch: async (url, options) => { calls.push({url, body: JSON.parse(options.body)}); return fetchImpl(url, options); },
    require: name => name.includes('config') ? {config:{mentorApiUrl:'https://local.test'}} : {getSavedSession:async()=>session},
  });
  return {api:exports, calls, switchTo: id => {session={studentId:id,password:'synthetic-test-password'};}};
}
const reply = data => ({ok:true,json:async()=>data});
const daily = {date:'2026-10-21',group:'Group I',officialSetId:'a'.repeat(64),bankRevision:'published-r1',questionIds:['q'],answers:{q:0},startedAt:1,completedAt:2,score:1,total:1};
test('native backup sends credential allowlist, never cached student profile', async()=>{
 const h=harness(async()=>reply({ok:true,accepted:1}));
 await h.api.syncCompletedMcqAttempts([daily],[],'UMP0001');
 assert.deepEqual(Object.keys(h.calls[0].body).sort(), ['attempts','password','studentId']);
 assert.equal(h.calls[0].body.attempts[0].officialSetId,daily.officialSetId);
});
test('missing acknowledgement is an error, not successful sync', async()=>{
 const h=harness(async()=>reply({ok:true,accepted:0}));
 await assert.rejects(h.api.syncCompletedMcqAttempts([daily],[]),/acknowledgement/);
});
test('large native history uses bounded batches without dropping attempts',async()=>{
 const h=harness(async(_u,o)=>reply({ok:true,accepted:JSON.parse(o.body).attempts.length}));
 const r=await h.api.syncCompletedMcqAttempts(Array(231).fill(daily),[],'UMP0001');
 assert.equal(r.accepted,231);assert.deepEqual(h.calls.map(c=>c.body.attempts.length),[100,100,31]);
});
test('queued native upload cannot change owner', async()=>{
 const h=harness(async()=>reply({ok:true,accepted:1}));h.switchTo('UMP0002');
 await assert.rejects(h.api.syncCompletedMcqAttempts([daily],[],'UMP0001'),/Account changed/);
 assert.equal(h.calls.length,0);
});
test('native restore completion is rejected after account switch', async()=>{
 let finish;const h=harness(()=>new Promise(resolve=>{finish=resolve}));
 const pending=h.api.restoreMcqAttempts();
 while(!finish) await new Promise(resolve=>setImmediate(resolve));
 h.switchTo('UMP0002');finish(reply({daily:[daily],practice:[]}));
 await assert.rejects(pending,/Account changed/);
});
test('native transport errors retain local attempts and surface status',async()=>{
 const h=harness(async()=>({ok:false,status:409}));
 await assert.rejects(h.api.syncCompletedMcqAttempts([daily],[]),/409.*retained/);
 assert.equal(daily.answers.q,0);
});
test('native official assignment uses exact authenticated group request',async()=>{
 const h=harness(async()=>reply({questionIds:Array(10).fill('q')}));
 await h.api.fetchOfficialDailySet('Group I','UMP0001');
 assert.equal(h.calls[0].url,'https://local.test/api/student-attempts/daily-set');
 assert.deepEqual(Object.keys(h.calls[0].body).sort(),['group','password','studentId']);
});
test('new clients do not distribute or use shared progress-sync secrets',()=>{
 const service=fs.readFileSync(path.join(__dirname,'../src/services/progressSync.ts'),'utf8');
 assert.doesNotMatch(service,/mentorSyncSecret|hmacSha256|X-Sync-Token/);
 assert.match(service,/student-sync\/session/);assert.match(service,/X-Student-Sync-Token/);
 const config=fs.readFileSync(path.join(__dirname,'../src/config.ts'),'utf8');
 assert.doesNotMatch(config,/EXPO_PUBLIC_MENTOR_SYNC_SECRET/);
 const web=fs.readFileSync(path.join(__dirname,'../../mcq-progress-share.js'),'utf8');
 assert.doesNotMatch(web,/X-Sync-Token/);assert.match(web,/acknowledgement incomplete/);
});

test('transient sync failure retries same payload and accepts only confirmed backup',async()=>{
 let n=0;const h=harness(async()=>++n===1 ? {ok:false,status:503} : reply({ok:true,accepted:1}));
 await h.api.syncCompletedMcqAttempts([daily],[],'UMP0001');
 assert.equal(n,2);assert.deepEqual(h.calls[0].body,h.calls[1].body);
});
test('auth and conflict errors are never blindly retried',async()=>{
 const h=harness(async()=>({ok:false,status:401}));
 await assert.rejects(h.api.syncCompletedMcqAttempts([daily],[]));assert.equal(h.calls.length,1);
});
