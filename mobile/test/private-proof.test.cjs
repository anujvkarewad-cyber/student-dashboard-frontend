const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),ts=require('typescript');
const source=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/services/privateProof.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
function harness(){let actor={studentId:'UMP0001',password:'synthetic'},generation=0,mode='ok',calls=[];
 class XHR{open(method,url){this.method=method;this.url=url;this.headers={};}setRequestHeader(k,v){this.headers[k]=v;}getResponseHeader(){return mode==='unsafe'?'text/html':'image/png';}abort(){}send(){calls.push(this);if(mode==='switch'){actor={studentId:'UMP0002',password:'synthetic-b'};generation++;}this.status=mode==='denied'?403:200;this.response=Uint8Array.from([1,2,3,4]).buffer;this.onload();}}
 const context={exports:{},URL,Uint8Array,ArrayBuffer,btoa,XMLHttpRequest:XHR,require:name=>{
 if(name==='../config')return{config:{gatewayOrigin:'https://gateway.invalid'}};
 if(name==='../storage/session')return{getSavedSession:async()=>actor,getSessionGeneration:()=>generation};throw Error('unexpected module');}};
 vm.runInNewContext(source,context);return{api:context.exports,calls,mode:m=>{mode=m;},actor:a=>{actor=a;generation++;}};
}
const url='/api/proof-file?fileId=synthetic_file';
test('native owner retrieval keeps bytes in memory and uses current saved credential headers',async()=>{const h=harness();const proof=await h.api.loadPrivateProof(url);assert.equal(proof.base64,'AQIDBA==');assert.equal(proof.mimeType,'image/png');assert.equal(h.calls[0].method,'GET');assert.equal(h.calls[0].url,'https://gateway.invalid'+url);assert.equal(h.calls[0].headers['X-Student-Id'],'UMP0001');assert.ok(!h.calls[0].url.includes('password'));});
for(const mode of ['switch','denied','unsafe'])test(`${mode}: native cannot display proof bytes`,async()=>{const h=harness();h.mode(mode);await assert.rejects(h.api.loadPrivateProof(url));});
for(const bad of ['https://evil.invalid'+url,'/api/proof-file?fileId=a&fileId=b','/api/proof-file?fileId=a&token=synthetic','javascript:alert(1)'])test('native refuses malformed/cross-origin proof without forwarding credentials',async()=>{const h=harness();await assert.rejects(h.api.loadPrivateProof(bad));assert.equal(h.calls.length,0);});
test('native missing actor cannot start private retrieval',async()=>{const h=harness();h.actor(null);await assert.rejects(h.api.loadPrivateProof(url));assert.equal(h.calls.length,0);});
test('private PDF/image viewer reuses bundled PDF renderer and never opens an external document URL',()=>{const text=fs.readFileSync(path.join(__dirname,'../src/components/PrivateProofViewer.tsx'),'utf8');assert.match(text,/PDF_VIEWER_HTML/);assert.match(text,/getSessionGeneration/);assert.match(text,/about:blank/);assert.doesNotMatch(text,/Linking|downloadAsync|writeAsStringAsync|Sharing/);});
