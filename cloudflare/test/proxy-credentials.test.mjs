import test from 'node:test';
import assert from 'node:assert/strict';
process.env.MENTOR_API_URL='https://backend.chain-fixture.invalid';
const {default:worker}=await import('../src/worker.js');
const {default:proxy}=await import('../../api/proxy.js');
const {default:sheets}=await import('../../api/sheets.js');
const env={APPS_SCRIPT_URL:'https://trusted-node.chain-fixture.invalid/api/proxy'};
const actor={'X-Student-Id':'UMP0001','X-Session-Password':'synthetic-local'};
const request=(headers={},payload={studentId:'UMP0001'},action='getStats')=>new Request('https://worker.fixture.invalid/api/proxy',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({action,payload})});
function response(){return{code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(data){this.data=data;return this;},end(){return this;}};}
async function chain(handler,run){const original=global.fetch;const seen=[];let nodeCalls=0,backendCalls=0;global.fetch=async(url,init)=>{
  if(String(url).startsWith('https://trusted-node.chain-fixture.invalid/')){
    nodeCalls++;const headers=new Headers(init.headers);seen.push(Object.fromEntries(headers));
    assert.equal(headers.get('authorization'),null);assert.equal(headers.get('cookie'),null);assert.equal(headers.get('x-file-name'),null);assert.equal(headers.get('x-mentor-token'),null);
    const res=response();await handler({method:init.method,headers:Object.fromEntries(headers),body:JSON.parse(new TextDecoder().decode(init.body)),query:{}},res);return Response.json(res.data,{status:res.code,headers:res.headers});
  }
  // Explicit synthetic backend: actual Worker + Node handlers, no live routing
  // claim. Real FastAPI credential/ownership coverage runs in both tree suites.
  backendCalls++;assert.ok(String(url).startsWith('https://backend.chain-fixture.invalid/'));
  const headers=new Headers(init.headers),body=JSON.parse(init.body);
  if(headers.get('x-student-id')!=='UMP0001'||headers.get('x-session-password')!=='synthetic-local')return Response.json({detail:'Authentication denied.'},{status:401});
  if(body.payload?.studentId&&body.payload.studentId!=='UMP0001')return Response.json({detail:'Student scope denied.'},{status:403});
  return Response.json({found:true,result:{owner:'UMP0001',totalHours:0.5}});
};try{await run({seen,node:()=>nodeCalls,backend:()=>backendCalls});}finally{global.fetch=original;}}
for(const [name,handler]of [['primary Node',proxy],['alternate Sheets Node',sheets]]){
 test(`Worker -> actual ${name}: authenticated read and header allowlist`,async()=>chain(handler,async state=>{const res=await worker.fetch(request({...actor,Authorization:'Bearer unrelated',Cookie:'session=unrelated','X-File-Name':'private.pdf','X-Mentor-Token':'not-forwarded'}),env);assert.equal(res.status,200);assert.equal((await res.json()).result.owner,'UMP0001');assert.equal(state.node(),1);assert.equal(state.backend(),1);assert.deepEqual(Object.keys(state.seen[0]).sort(),['content-type','x-session-password','x-student-id']);assert.equal(res.headers.get('cache-control'),'no-store');assert.equal(res.headers.get('access-control-allow-origin'),'*');}));
 for(const headers of [{},{'X-Student-Id':'UMP0001'},{...actor,'X-Session-Password':'wrong-local'},{...actor,'X-Student-Id':'UMP0002'}])test(`Worker -> ${name}: unauthorized ${JSON.stringify(Object.keys(headers))}`,async()=>chain(handler,async state=>{const res=await worker.fetch(request(headers),env);assert.ok([401,403].includes(res.status));assert.equal(state.node(),1);assert.equal(res.headers.get('cache-control'),'no-store');assert.equal((await res.json()).result?.totalHours,undefined);}));
 test(`Worker -> ${name}: authenticated actor cannot target a different student`,async()=>chain(handler,async()=>{const res=await worker.fetch(request(actor,{studentId:'UMP0002'}),env);assert.equal(res.status,403);assert.equal((await res.json()).result?.totalHours,undefined);}));
}
test('upstream status/body preserved, never cached and never Set-Cookie forwarded',async()=>{const original=global.fetch;global.fetch=async()=>new Response('{"error":"unavailable"}',{status:503,headers:{'Content-Type':'application/json','Set-Cookie':'never-forward=1'}});try{const res=await worker.fetch(request(actor),env);assert.equal(res.status,503);assert.equal(await res.text(),'{"error":"unavailable"}');assert.equal(res.headers.get('set-cookie'),null);assert.equal(res.headers.get('cache-control'),'no-store');}finally{global.fetch=original;}});
test('preflight actor contract and method rejection unchanged',async()=>{const pre=await worker.fetch(new Request('https://worker.fixture.invalid/api/proxy',{method:'OPTIONS'}),env);assert.equal(pre.status,204);assert.match(pre.headers.get('access-control-allow-headers'),/X-Student-Id/);const get=await worker.fetch(new Request('https://worker.fixture.invalid/api/proxy'),env);assert.equal(get.status,405);});


test('old Worker proof protocol cannot create any file',async()=>{
 const old=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('No upstream permitted');};
 try{const result=await worker.fetch(new Request('https://worker.fixture.invalid/api/proof-upload',{method:'PUT',headers:{...actor,'Content-Type':'image/png'},body:'synthetic'}),env);assert.equal(result.status,409);assert.equal(calls,0);}finally{globalThis.fetch=old;}
});
const storage={type:'user',emailAddress:'storage@example.invalid',role:'owner'};
for(const acl of [{permissions:[storage]},{permissions:[{type:'anyone',role:'reader'}]},{permissions:[storage],ok:false},{permissions:[storage],success:false},{permissions:[storage],error:'rejected'},{permissions:[storage],nextPageToken:'more'},{permissions:[]},{}])test('Worker requires verified private destination; public/contradictory ACLs never upload',async()=>{
 const original=globalThis.fetch,descriptor=Object.getOwnPropertyDescriptor(globalThis,'crypto');let created=0;
 Object.defineProperty(globalThis,'crypto',{configurable:true,value:{randomUUID:()=> 'synthetic-id',subtle:{importKey:async()=>({}),sign:async()=>new ArrayBuffer(8)}}});
 globalThis.fetch=async(url,init={})=>{
  const value=String(url);
  if(value.includes('/api/student-auth/login'))return Response.json({result:{success:true,studentId:'UMP0001'}});
  if(value.includes('oauth2.googleapis.com'))return Response.json({access_token:'synthetic-provider-not-real'});
  if(value.includes('/permissions')){assert.notEqual(init.method,'POST');return Response.json(acl);}
  if(value.includes('/upload/drive/')){created++;return Response.json({id:'synthetic-file'});}
  if(value.includes('synthetic-folder'))return Response.json({id:'synthetic-folder',mimeType:'application/vnd.google-apps.folder',driveId:'synthetic-drive',capabilities:{canAddChildren:true},trashed:false});
  return Response.json({id:'synthetic-file',mimeType:'image/png',size:'9',trashed:false,appProperties:{umpOwner:'UMP0001',umpPurpose:'study-proof',umpSchema:'private-v1'}});
 };
 try{const result=await worker.fetch(new Request('https://worker.fixture.invalid/api/proof-upload',{method:'PUT',headers:{...actor,'Content-Type':'image/png','X-Proof-Protocol':'private-v1'},body:'synthetic'}),{MENTOR_ORIGIN:'https://mentor.fixture.invalid',GOOGLE_SERVICE_ACCOUNT_EMAIL:'storage@example.invalid',GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY:'AA==',DRIVE_PROOF_FOLDER_ID:'synthetic-folder'});
  const expected=acl.permissions?.length===1&&acl.permissions[0]===storage&&acl.ok!==false&&acl.success!==false&&!acl.error&&!acl.nextPageToken;
  assert.equal(result.status,expected?200:502);assert.equal(created,expected?1:0);assert.equal((await result.json()).success===true,Boolean(expected));
 }finally{globalThis.fetch=original;if(descriptor)Object.defineProperty(globalThis,'crypto',descriptor);else delete globalThis.crypto;}
});
