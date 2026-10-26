const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),ts=require('typescript');
const file=path.join(__dirname,'../src/services/practiceTools.ts');
function load(saved={studentId:'UMP9001',password:'synthetic-only'}){
 const calls=[],exports={};const compiled=ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}});
 assert.equal(compiled.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
 vm.runInNewContext(compiled.outputText,{exports,AbortController,setTimeout,clearTimeout,require:n=>n==='../config'?{config:{mentorApiUrl:'https://backend.fixture.invalid'}}:n==='../storage/session'?{getSavedSession:async()=>saved}:(()=>{throw Error(n)})(),fetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({token:'synthetic-token',studentId:'UMP9001'})};}});
 return {api:exports,calls};
}
test('actual native transport uses a distinct workbook session without changing receipt default',async()=>{
 const {api,calls}=load();await api.practiceSession();await api.practiceSession('workbook');
 assert.equal(calls[0].url,'https://backend.fixture.invalid/api/practice/session');assert.equal(calls[1].url,'https://backend.fixture.invalid/api/practice/workbooks/session');
 for(const c of calls){assert.equal(c.options.method,'POST');assert.equal(JSON.parse(c.options.body).studentId,'UMP9001');assert.ok(c.options.signal);assert.equal(new URL(c.url).search,'');}
});
test('workbook session still refuses ID-only credentials',async()=>{
 const {api,calls}=load({studentId:'UMP9001'});await assert.rejects(api.practiceSession('workbook'),/sign in/);assert.equal(calls.length,0);
});
test('only the workbook screen explicitly requests the workbook transport',()=>{
 const screen=fs.readFileSync(path.join(__dirname,'../src/screens/WorkbooksScreen.tsx'),'utf8');assert.match(screen,/await practiceSession\('workbook'\)/);
 const voice=fs.readFileSync(path.join(__dirname,'../src/services/receiptTranscription.ts'),'utf8');assert.doesNotMatch(voice,/practiceSession\('workbook'\)/);
});
