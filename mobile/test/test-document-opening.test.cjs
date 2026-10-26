const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const root=path.resolve(__dirname,'../..');
function loadTS(file,extra={}) {
 const source=fs.readFileSync(path.join(root,file),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports={};vm.runInNewContext(code,{exports,URL,Uint8Array,AbortController,setTimeout,clearTimeout,btoa:s=>Buffer.from(s,'binary').toString('base64'),require:()=>({getSavedSession:()=>{throw new Error('No credential access permitted in document tests')}}),...extra});return exports;
}
const native=loadTS('mobile/src/services/testDocumentLinks.ts');
const webSource=fs.readFileSync(path.join(root,'app.js'),'utf8');
const start=webSource.indexOf('function drivePreviewUrl('),end=webSource.indexOf('// ----- state -----',start);
const browser={URL};vm.runInNewContext(webSource.slice(start,end),browser);
const cases=[
 ['https://drive.google.com/uc?export=download&id=Test_File-123','https://drive.google.com/file/d/Test_File-123/preview'],
 ['https://drive.google.com/open?id=Test_File-123','https://drive.google.com/file/d/Test_File-123/preview'],
 ['https://drive.google.com/file/d/Test_File-123/view?usp=sharing','https://drive.google.com/file/d/Test_File-123/preview'],
 ['https://drive.google.com/file/d/Test_File-123/preview','https://drive.google.com/file/d/Test_File-123/preview'],
 ['https://drive.google.com/uc?resourcekey=0-key&id=Test_File-123&export=download','https://drive.google.com/file/d/Test_File-123/preview?resourcekey=0-key'],
 ['https://drive.google.com/file/d/Test_File-123/view?resourcekey=key%2Bvalue','https://drive.google.com/file/d/Test_File-123/preview?resourcekey=key%2Bvalue'],
 ['https://files.example.test/paper.pdf?token=example','https://files.example.test/paper.pdf?token=example'],
];
for(const [input,expected] of cases) test('native/web preview parity: '+input,()=>{
 assert.equal(native.testDocumentPreviewUrl(input),expected);assert.equal(browser.testDocumentPreviewUrl(input),expected);
});
for(const input of ['javascript:alert(1)','data:text/html,bad','file:///private/file.pdf','not a url'])test('reject invalid scheme/link '+input,()=>{
 assert.throws(()=>native.testDocumentPreviewUrl(input));assert.throws(()=>browser.testDocumentPreviewUrl(input));
});
test('a different host containing /file/d/ is not rewritten to Google Drive',()=>{
 const input='https://files.example.test/file/d/abc/view';assert.equal(native.drivePreviewUrl(input),null);assert.equal(native.testDocumentPreviewUrl(input),input);
});
test('non-Drive PDFs remain memory-only base64',async()=>{
 const data=Buffer.from('%PDF-1.4\nsynthetic test content');
 const service=loadTS('mobile/src/services/mentorTests.ts',{fetch:async()=>({ok:true,arrayBuffer:async()=>data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength)})});
 assert.equal(await service.fetchPdfBase64('https://example.test/paper.pdf'),data.toString('base64'));
});
test('200 HTML/login response is rejected instead of rendering invalid PDF',async()=>{
 const data=Buffer.from('<html>Sign in required</html>');
 const service=loadTS('mobile/src/services/mentorTests.ts',{fetch:async()=>({ok:true,arrayBuffer:async()=>data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength)})});
 await assert.rejects(()=>service.fetchPdfBase64('https://example.test/paper.pdf'),/did not return a PDF/);
});
test('403 is not bypassed or treated as a valid attachment',async()=>{
 const service=loadTS('mobile/src/services/mentorTests.ts',{fetch:async()=>({ok:false,status:403})});
 await assert.rejects(()=>service.fetchPdfBase64('https://example.test/private.pdf'),/403/);
});
test('both web test document buttons use preview normalization; text answer fallback escaped',()=>{
 assert.equal((webSource.match(/preview = testDocumentPreviewUrl\(url\)/g)||[]).length,2);
 assert(webSource.includes('escapeHtml(meta.answerSheetText)'));
});
test('native error/retry stays inside document modal; upload unlock policy unchanged',()=>{
 const source=fs.readFileSync(path.join(root,'mobile/src/screens/MentorTestScreen.tsx'),'utf8');
 assert(source.indexOf('accessibilityRole="alert"')>source.indexOf('<Modal visible={Boolean(viewer)'));
 assert(source.includes('key={`${viewer.url}:${viewerAttempt}`}'));
 assert(source.includes('setViewerAttempt(n => n + 1)'));
 assert(source.includes('const unlocked = Boolean(answerUrl) || Boolean(evaluated)'));
 assert(!source.includes('window.open(') || source.includes('// because the sandboxed preview iframe blocks window.open()'));
});

function metaHarness(tests,options={}) {
 const calls=[];
 const service=loadTS('mobile/src/services/mentorTests.ts',{
  require:()=>({getSavedSession:async()=>({studentId:'SYNTHETIC',password:'synthetic-test-only'})}),
  fetch:async(url,opts)=>{
   calls.push({url,body:JSON.parse(opts.body)});
   if(url.endsWith('/paper'))return options.paperFail?{ok:false,status:403}:{ok:true,json:async()=>({test:{kind:options.kind||'paper-test',paperUrl:'https://example.test/p.pdf'}})};
   if(options.listFail) throw new Error('Synthetic status failure');
   return {ok:true,json:async()=>({tests})};
  }
 });
 return {service,calls};
}
test('reopen restores a matching server-confirmed paper evaluation, including zero marks',async()=>{
 const {service,calls}=metaHarness([{testId:'t1',attempted:true,lastScore:0,lastTotal:50}]);
 const meta=await service.getPaperMeta('t1');assert.equal(meta.previousEvaluation.score,0);assert.equal(meta.previousEvaluation.total,50);
 assert.equal(calls.length,2);assert.equal(calls[1].body.studentId,calls[0].body.studentId);assert.equal(calls[1].body.password,calls[0].body.password);
});
for(const row of [{testId:'other',attempted:true,lastScore:45},{testId:'t1',attempted:false,lastScore:45},{testId:'t1',attempted:true,lastScore:null}])test('does not unlock from nonmatching or unconfirmed history '+JSON.stringify(row),async()=>{
 const {service}=metaHarness([row]);assert.equal((await service.getPaperMeta('t1')).previousEvaluation,null);
});
test('failed history read is explicit, not fake submission or a blocked paper',async()=>{
 const {service}=metaHarness([],{listFail:true});const meta=await service.getPaperMeta('t1');assert.equal(meta.previousEvaluation,null);assert.equal(meta.previousEvaluationUnavailable,true);assert(meta.paperUrl);
});
test('failed paper access never proceeds to restore history or bypasses a 403',async()=>{
 const {service,calls}=metaHarness([],{paperFail:true});await assert.rejects(()=>service.getPaperMeta('t1'),/403/);assert.equal(calls.length,1);
});
test('MCQ paper loading does not add a history request',async()=>{
 const {service,calls}=metaHarness([],{kind:'mcq-test'});await service.getPaperMeta('t1');assert.equal(calls.length,1);
});
