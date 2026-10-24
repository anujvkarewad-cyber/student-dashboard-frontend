const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');
const src = path.join(__dirname, '../src');
function loadService({session={studentId:'LOCAL_A',password:'local-password'},fetcher,base='https://local.example.invalid'}={}) {
 let current=session;const calls=[];
 const source=fs.readFileSync(path.join(src,'services/smartTargets.ts'),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports={};vm.runInNewContext(code,{exports,AbortController,setTimeout,clearTimeout,Error,fetch:async(url,init)=>{calls.push([url,init]);return fetcher?fetcher(url,init,()=>{current=null;}):{ok:true,json:async()=>({saved:true})};},require(name){if(name==='../config')return {config:{mentorApiUrl:base}};if(name==='../storage/session')return {getSavedSession:async()=>current};throw new Error(name);}});
 return {request:exports.smartTargetRequest,chapterIdentity:exports.chapterIdentity,calls};
}
test('smart mutations require Full Live and do not write offline ticks',async()=>{
 const x=loadService();await assert.rejects(()=>x.request('LOCAL_A','complete',{planId:'local-plan'}),/Full Live/);assert.equal(x.calls.length,0);
});
test('smart transport uses captured saved credentials and prevents identity injection',async()=>{
 const x=loadService();await x.request('LOCAL_A','complete',{studentId:'OTHER',password:'injected',taskId:'task'},true);
 const body=JSON.parse(x.calls[0][1].body);assert.equal(body.studentId,'LOCAL_A');assert.equal(body.password,'local-password');assert.equal(x.calls[0][1].method,'POST');assert.equal(x.calls[0][1].headers.Authorization,undefined);
});
test('smart transport refuses a stale owner before making any request',async()=>{const x=loadService();await assert.rejects(()=>x.request('LOCAL_B','dashboard'),/sign in/);assert.equal(x.calls.length,0);});
test('smart transport does not apply a response after logout',async()=>{const x=loadService({fetcher:async(u,i,logout)=>{logout();return{ok:true,json:async()=>({})};}});await assert.rejects(()=>x.request('LOCAL_A','dashboard'),/Account changed/);});
test('smart backend errors are surfaced, never converted to apparent success',async()=>{const x=loadService({fetcher:async()=>({ok:false,json:async()=>({detail:'Future day locked'})})});await assert.rejects(()=>x.request('LOCAL_A','complete',{},true),/Future day locked/);});
test('dashboard and saved session reads remain possible in read-only mode',async()=>{const x=loadService();await x.request('LOCAL_A','dashboard');await x.request('LOCAL_A','session',{sessionId:'local-0001'});assert.equal(x.calls.length,2);});
test('no configured target server fails explicitly without a fallback write',async()=>{const x=loadService({base:''});await assert.rejects(()=>x.request('LOCAL_A','dashboard'),/not configured/);assert.equal(x.calls.length,0);});
test('assessment transmits summary schema only, not receipt contents',()=>{
 const source=fs.readFileSync(path.join(src,'components/SmartSessionAssessment.tsx'),'utf8');
 const a=source.indexOf("smartTargetRequest(sid, 'assessment'");const b=source.indexOf('backendMode ===',a);const request=source.slice(a,b);
 assert.match(request,/attempted: a, correct: c/);assert.match(request,/shareSummary: true/);assert.doesNotMatch(request,/answers:|transcript:|audio:|receipt:/);
});
test('linked timer binding survives start and finish, and edits cannot silently relink it',()=>{
 const source=fs.readFileSync(path.join(src,'context/FocusTimerContext.tsx'),'utf8');assert.match(source,/status: 'running',\s+smartTarget: timer.smartTarget/);assert.match(source,/target: timer.target.trim\(\),\s+smartTarget: timer.smartTarget,\s+startedAt: timer.sessionStartedAt/);assert.match(source,/timer.status !== 'idle' \|\| timer.smartTarget/);assert.match(source,/hydrated: ready/);
});
test('only confirmed cloud sharing disables the duplicate local receipt reminder',()=>{
 const source=fs.readFileSync(path.join(src,'context/StudyReceiptContext.tsx'),'utf8');assert.match(source,/!item.cloudSummaryShared && !item.review/);assert.match(source,/current.map\(r => r.sessionId === sessionId/);assert.match(source,/cloudSummaryShared: true/);
});

test('cloud chapter identities reuse subject aliases without merging separate subjects',()=>{
 const {chapterIdentity:key}=loadService();assert.equal(key('Accounts','AS 2'),key('Advanced Accounting','as 2'));assert.equal(key('Costing','ABC'),key('Cost and Management Accounting','ABC'));assert.notEqual(key('Taxation','Chapter 1'),key('Law','Chapter 1'));
});
test('revision module excludes already cloud-managed chapter reminders without deleting local practice history',()=>{
 const source=fs.readFileSync(path.join(src,'screens/RevisionDashboardScreen.tsx'),'utf8');assert.match(source,/concepts.filter\(c => !cloudKeys.includes/);assert.match(source,/buildInsights\(concepts\)/);assert.doesNotMatch(source,/removeItem|saveState|clearState/);
});
