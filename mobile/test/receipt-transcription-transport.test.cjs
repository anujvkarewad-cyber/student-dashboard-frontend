const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const source=fs.readFileSync(path.join(__dirname,'../src/services/receiptTranscription.ts'),'utf8');
function harness(options={}){
 const requests=[];let checks=0;const controllers=[];
 class XHR{
  constructor(){controllers.push(this);this.status=200;this.headers={};}
  open(method,url){this.method=method;this.url=url;}
  setRequestHeader(k,v){this.headers[k]=v;}
  abort(){this.aborted=true;this.onabort?.();}
  send(body){this.body=body;requests.push(this);const index=requests.length-1;
   if(options.hold===index)return;
   setImmediate(()=>{
    if(this.aborted)return;
    const action=options.outcomes?.[index];
    if(action==='network'){this.onerror();return;}if(action==='timeout'){this.ontimeout();return;}if(action==='cancel'){this.onabort();return;}
    this.status=action?.status||200;
    this.responseText=options.invalidJson&&index===1?'invalid':JSON.stringify(action?.data||(index===0?{studentId:options.wrongOwner?'UMP0072':'UMP0000',token:'synthetic-scoped-token'}:{text:options.text??'Reviewed receipt text.'}));this.onload();
   });
  }
 }
 const exports={};const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 vm.runInNewContext(code,{exports,Promise,ArrayBuffer,Error,Object,JSON,XMLHttpRequest:XHR,require:name=>{
  if(name==='react-native')return {Platform:{OS:'android'}};
  if(name==='expo-file-system')return {File:class{size=options.fileSize??1024;type='audio/mp4';async arrayBuffer(){return new ArrayBuffer(options.actualSize??1024);}}};
  if(name.endsWith('/session'))return {getSavedSession:async()=>{checks++;return {studentId:options.switchAt&&checks>=options.switchAt?'UMP0072':'UMP0000',password:'synthetic-password-not-real'};}};
  if(name.endsWith('/practiceTools'))return {PRACTICE_AUDIO_BYTES:2*1024*1024,practiceUrl:p=>'https://stage.invalid/api/practice'+p};
  throw Error('Unexpected import '+name);
 }});
 return {requests,controllers,send:signal=>exports.transcribeReceiptAudio(options.owner??'UMP0000','file:///private/saved.m4a',signal??new AbortController().signal)};
}
test('receipt native session and raw upload use XHR with independent deadlines and scoped token',async()=>{
 const h=harness();assert.equal(await h.send(),'Reviewed receipt text.');assert.equal(h.requests.length,2);
 assert.equal(h.requests[0].timeout,20000);assert.equal(h.requests[1].timeout,60000);assert.equal(h.requests[1].body.byteLength,1024);assert.equal(h.requests[1].headers['Content-Type'],'audio/mp4');assert.equal(h.requests[1].headers['X-Practice-Token'],'synthetic-scoped-token');assert.equal(h.requests[1].headers.password,undefined);
});
test('session network cancellation is recoverable and never starts an audio upload',async()=>{
 const h=harness({outcomes:['cancel']});await assert.rejects(h.send(),/recording is unchanged/i);assert.equal(h.requests.length,1);
});
test('upload network failure does not automatically resend audio to provider',async()=>{
 const h=harness({outcomes:[null,'network']});await assert.rejects(h.send(),/Retry transcription/);assert.equal(h.requests.length,2);
});
test('upload timeout reports retained recording, not raw fetch-cancelled message',async()=>{
 const h=harness({outcomes:[null,'timeout']});await assert.rejects(h.send(),/took too long.*recording is unchanged/);assert.equal(h.requests.length,2);
});
test('closing aborts pending native request without starting audio upload',async()=>{
 const h=harness({hold:0}),abort=new AbortController();const pending=h.send(abort.signal);await new Promise(r=>setImmediate(r));abort.abort();await assert.rejects(pending,/cancelled/);assert.equal(h.controllers[0].aborted,true);assert.equal(h.requests.length,1);
});
test('already-aborted attempt sends nothing',async()=>{
 const h=harness(),abort=new AbortController();abort.abort();await assert.rejects(h.send(abort.signal),/cancelled/);assert.equal(h.requests.length,0);
});
test('wrong session owner is rejected before sending private audio',async()=>{
 const h=harness({wrongOwner:true});await assert.rejects(h.send(),/identity/);assert.equal(h.requests.length,1);
});
test('account switching after login prevents audio upload',async()=>{
 const h=harness({switchAt:3});await assert.rejects(h.send(),/Account changed/);assert.equal(h.requests.length,1);
});
test('account switching during upload discards returned transcript',async()=>{
 const h=harness({switchAt:4});await assert.rejects(h.send(),/Account changed/);assert.equal(h.requests.length,2);
});
test('nonowner private cohort cannot send any audio or login request',async()=>{
 const h=harness({owner:'UMP0072'});await assert.rejects(h.send(),/private owner test/);assert.equal(h.requests.length,0);
});
test('oversized or empty audio never reaches server',async()=>{
 for(const fileSize of [0,2*1024*1024+1]){const h=harness({fileSize});await assert.rejects(h.send(),/2 MB/);assert.equal(h.requests.length,0);}
});
test('independent actual byte-length guard rejects inaccurate file metadata',async()=>{
 const h=harness({actualSize:2*1024*1024+1});await assert.rejects(h.send(),/size could not be verified/);assert.equal(h.requests.length,0);
});
test('auth denial has no retry and never uploads audio',async()=>{
 const h=harness({outcomes:[{status:401,data:{detail:'No access'}}]});await assert.rejects(h.send(),/access could not be verified/);assert.equal(h.requests.length,1);
});
test('invalid transcript response is not shown as successful text',async()=>{
 const h=harness({invalidJson:true});await assert.rejects(h.send(),/unreadable response/);
 const empty=harness({text:'   '});await assert.rejects(empty.send(),/No usable transcript/);
});
test('native receipt upload bypasses the cancelled fetch transports and never deletes files',()=>{
 assert.doesNotMatch(source,/expoFetch|deleteAsync|deleteReceiptAudio|fetch\(practiceUrl/);
 assert.match(source,/new XMLHttpRequest/);
});
