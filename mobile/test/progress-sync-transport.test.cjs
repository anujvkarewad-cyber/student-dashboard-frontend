const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function harness(handler) {
 let session={studentId:'UMP9001',password:'synthetic-only'};
 const calls=[],stored=[],exports={};
 const source=fs.readFileSync(path.join(__dirname,'../src/services/progressSync.ts'),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 vm.runInNewContext(code,{exports,AbortController,setTimeout,clearTimeout,Promise,Date,Math,Error,fetch:async(url,options)=>{
   calls.push({url,options,body:JSON.parse(options.body)});
   if(url.endsWith('/session'))return {ok:true,status:200,json:async()=>({studentId:'UMP9001',token:'synthetic-scoped-token'})};
   return handler(url,options);
 },require:name=>name.includes('async-storage')?{__esModule:true,default:{getItem:async()=>null,setItem:async(...args)=>stored.push(args),removeItem:async(...args)=>stored.push(args)}}:name.includes('config')?{config:{mentorApiUrl:'https://synthetic.invalid',appVersion:'1.15.4'}}:{getSavedSession:async()=>session}});
 return {api:exports,calls,stored,switchAccount:()=>{session={studentId:'UMP9002',password:'different-synthetic'}}};
}
const summaries=[{studentId:'UMP9001',chapterId:'audit-1',masteryBand:'Strong',attemptCount:10,accuracyRange:'70-84',lastActivityDate:'2026-10-22',weakConceptTags:[]}];
const reply=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
test('progress upload has bounded abort signal and scoped auth header',async()=>{
 const h=harness(async()=>reply({ok:true,accepted:{summaries:1,trend:0}}));await h.api.syncProgress('UMP9001',summaries,[]);
 const c=h.calls.find(x=>x.url.endsWith('/progress-sync'));assert.ok(c.options.signal instanceof AbortSignal);assert.equal(c.options.headers['X-Student-Sync-Token'],'synthetic-scoped-token');
});
test('progress acknowledgement after account switch cannot mark synced',async()=>{
 let resolve;const h=harness(()=>new Promise(r=>resolve=r));const p=h.api.syncProgress('UMP9001',summaries,[]);
 while(!resolve)await new Promise(r=>setImmediate(r));h.switchAccount();resolve(reply({ok:true,accepted:{summaries:1,trend:0}}));
 await assert.rejects(p,/account|identity/i);
});
test('consent response after account switch cannot alter stored sharing choice',async()=>{
 let resolve;const h=harness(()=>new Promise(r=>resolve=r));const p=h.api.setMentorSharing('UMP9001',true);
 while(!resolve)await new Promise(r=>setImmediate(r));h.switchAccount();resolve(reply({ok:true,studentId:'UMP9001',sharing:true}));
 await assert.rejects(p,/account|identity/i);assert.equal(h.stored.length,0);
});
test('transient progress failure retries exact payload at most three times',async()=>{
 let n=0;const h=harness(async()=>++n===1?reply({},503):reply({ok:true,accepted:{summaries:1,trend:0}}));
 await h.api.syncProgress('UMP9001',summaries,[]);assert.equal(n,2);
 const sent=h.calls.filter(x=>x.url.endsWith('/progress-sync'));assert.equal(sent[0].options.body,sent[1].options.body);
});
test('401 progress failures are not retried',async()=>{
 const h=harness(async()=>reply({},401));await assert.rejects(h.api.syncProgress('UMP9001',summaries,[]),/401/);
 assert.equal(h.calls.filter(x=>x.url.endsWith('/progress-sync')).length,1);
});
test('incorrect consent acknowledgement cannot save local sharing flag',async()=>{
 const h=harness(async()=>reply({ok:true,studentId:'UMP9002',sharing:true}));
 await assert.rejects(h.api.setMentorSharing('UMP9001',true),/acknowledgement/i);assert.equal(h.stored.length,0);
});
test('persistent transient failure stops after three uploads',async()=>{
 const h=harness(async()=>reply({},503));await assert.rejects(h.api.syncProgress('UMP9001',summaries,[]),/503/);
 assert.equal(h.calls.filter(x=>x.url.endsWith('/progress-sync')).length,3);
});
test('422 validation failure is surfaced without retry',async()=>{
 const h=harness(async()=>reply({detail:'Invalid summary'},422));await assert.rejects(h.api.syncProgress('UMP9001',summaries,[]),/422.*Invalid summary/);
 assert.equal(h.calls.filter(x=>x.url.endsWith('/progress-sync')).length,1);
});
