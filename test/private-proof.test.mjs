import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync, webcrypto } from 'node:crypto';
import { uploadPrivateProof, retrievePrivateProof } from '../lib/private-proof.js';
import { handleProofUpload, handlePrivateProofRead, handlePrivateProofCapabilities } from '../lib/proof-upload.js';
import worker from '../cloudflare/src/worker.js';
if (!globalThis.crypto) globalThis.crypto=webcrypto;
const OWNER='UMP0001', FILE='synthetic_file', FOLDER='private_folder', PRINCIPAL='storage@example.invalid';
const keys=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
const env={PROOF_PRIVATE_MODE:'1',DRIVE_PROOF_FOLDER_ID:FOLDER,GOOGLE_SERVICE_ACCOUNT_EMAIL:PRINCIPAL,GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY:keys.privateKey,MENTOR_ORIGIN:'https://mentor.example.invalid'};
const headers={'content-type':'image/png','x-student-id':OWNER,'x-session-password':'synthetic','x-proof-protocol':'private-v1'};
function mock(t,mode='ok') {
 const calls=[];const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
 globalThis.fetch=async(url,init={})=>{
  url=String(url);calls.push({url,init});
  if(url.includes('/api/student-auth/login'))return Response.json({result:{success:true,studentId:mode==='wrong-actor'?'UMP0002':OWNER}});
  if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'synthetic-only-token'});
  if(url.includes('/upload/drive/')){
   assert.equal(init.redirect,'error');
   const body=new TextDecoder().decode(init.body);assert.ok(body.includes('"umpOwner":"UMP0001"'));assert.ok(body.includes('"umpSchema":"private-v1"'));
   return Response.json(mode==='bad-create'?{id:FILE,ok:false}:{id:FILE});
  }
  if(url.includes('/permissions')) {
   assert.notEqual(init.method,'POST','No public/other grant may be written');
   let p={type:'user',role:'owner',emailAddress:PRINCIPAL};
   if(mode==='public-folder' && url.includes(FOLDER))p={type:'anyone',role:'reader'};
   if(mode==='public-file' && url.includes(FILE))p={type:'anyone',role:'reader'};
   if(mode==='group')p={type:'group',role:'reader',emailAddress:'group@example.invalid'};
   return Response.json({permissions:[p],...(mode==='pagination'?{nextPageToken:'more'}:{})});
  }
  if(url.includes('alt=media'))return new Response(mode==='overflow'?'12345':'png!');
  if(url.includes(`/files/${FOLDER}?`))return Response.json({id:FOLDER,mimeType:'application/vnd.google-apps.folder',driveId:mode==='consumer-folder'?undefined:'synthetic_shared_drive',capabilities:{canAddChildren:mode!=='readonly-folder'},trashed:false});
  if(url.includes(`/files/${FILE}?`))return Response.json({id:FILE,mimeType:mode==='unsafe-type'?'text/html':'image/png',size:mode==='oversize'?String(11*1024*1024):'4',trashed:false,appProperties:mode==='legacy'?{}:{umpOwner:mode==='other-owner'?'UMP0002':OWNER,umpPurpose:'study-proof',umpSchema:'private-v1'}});
  throw Error('Unexpected synthetic request');
 };
 return calls;
}
const upload=()=>uploadPrivateProof({studentId:OWNER,fileName:'synthetic.png',mimeType:'image/png',bytes:new Uint8Array([1,2,3,4]),folderId:FOLDER,principal:PRINCIPAL,token:'synthetic'});
const read=()=>retrievePrivateProof({fileId:FILE,studentId:OWNER,principal:PRINCIPAL,token:'synthetic'});
test('private upload binds owner at creation, returns compatible field and never writes an ACL',async t=>{
 const calls=mock(t);const result=await upload();assert.equal(result.proofUrl,`/api/proof-file?fileId=${FILE}`);assert.equal(result.success,true);
 assert.equal(calls.filter(x=>x.init.method==='POST').length,1);
 assert.ok(calls.findIndex(x=>x.url.includes('/permissions'))<calls.findIndex(x=>x.url.includes('/upload/')));
});
for(const mode of ['public-folder','group','pagination'])test(`${mode}: refuse BEFORE sending any file bytes`,async t=>{const calls=mock(t,mode);await assert.rejects(upload);assert.equal(calls.some(x=>x.url.includes('/upload/')),false);});
for(const mode of ['public-file','bad-create'])test(`${mode}: never acknowledge unconfirmed private upload`,async t=>{mock(t,mode);await assert.rejects(upload);});
test('owner retrieval returns bounded bytes with private/no-store and nosniff',async t=>{mock(t);const result=await read();assert.equal(result.status,200);assert.equal(new TextDecoder().decode(result.bytes),'png!');assert.equal(result.headers['Cache-Control'],'private, no-store');assert.equal(result.headers['X-Content-Type-Options'],'nosniff');});
for(const mode of ['other-owner','legacy'])test(`${mode}: no ownership inferred from URL/file ID`,async t=>{const calls=mock(t,mode);assert.equal((await read()).status,404);assert.equal(calls.some(x=>x.url.includes('alt=media')),false);});
for(const mode of ['public-file','unsafe-type','oversize','overflow'])test(`${mode}: retrieval fails closed`,async t=>{mock(t,mode);await assert.rejects(read);});
test('arbitrary URL is never fetched as a file identifier',async t=>{const calls=mock(t);assert.equal((await retrievePrivateProof({fileId:'https://evil.invalid/file',studentId:OWNER})).status,404);assert.equal(calls.length,0);});
test('Node actual handlers authenticate owner for new upload and retrieval',async t=>{const calls=mock(t);const up=await handleProofUpload({method:'PUT',headers,readBody:async()=>Buffer.from('png!'),mentorApiUrl:env.MENTOR_ORIGIN,env});assert.equal(up.status,200);const down=await handlePrivateProofRead({method:'GET',headers,fileId:FILE,mentorApiUrl:env.MENTOR_ORIGIN,env});assert.equal(down.status,200);assert.equal(calls.some(x=>x.url.includes('script.google')),false);});
test('Node private mode never falls back to an unknown Script or an old client',async t=>{const calls=mock(t);const args={method:'PUT',headers,readBody:async()=>Buffer.from('png!'),mentorApiUrl:env.MENTOR_ORIGIN};assert.equal((await handleProofUpload({...args,env:{PROOF_PRIVATE_MODE:'1',APPS_SCRIPT_URL:'https://script.invalid',PROOF_UPLOAD_KEY:'synthetic'}})).status,503);assert.equal((await handleProofUpload({...args,headers:{...headers,'x-proof-protocol':''},env})).status,409);assert.equal(calls.length,0);});
test('Node requires returned identity, not success for another actor',async t=>{const calls=mock(t,'wrong-actor');assert.equal((await handleProofUpload({method:'PUT',headers,readBody:async()=>{throw Error('must not read');},mentorApiUrl:env.MENTOR_ORIGIN,env})).status,401);assert.equal(calls.length,1);});
test('Worker actual private routes use current FastAPI auth, never anonymous Script auth',async t=>{const calls=mock(t);const up=await worker.fetch(new Request('https://gateway.invalid/api/proof-upload',{method:'PUT',headers,body:'png!'}),env);assert.equal(up.status,200);assert.equal((await up.json()).proofUrl,`/api/proof-file?fileId=${FILE}`);const down=await worker.fetch(new Request(`https://gateway.invalid/api/proof-file?fileId=${FILE}`,{headers}),env);assert.equal(down.status,200);assert.equal(await down.text(),'png!');assert.equal(calls.some(x=>x.url.includes('script.google')),false);});
test('Worker unauthenticated or cross-actor retrieval does not reach Drive',async t=>{const calls=mock(t,'wrong-actor');const response=await worker.fetch(new Request(`https://gateway.invalid/api/proof-file?fileId=${FILE}`,{headers}),env);assert.equal(response.status,401);assert.equal(calls.some(x=>x.url.includes('googleapis')),false);});

for(const mode of ['consumer-folder','readonly-folder'])test(`${mode}: no student bytes uploaded and no private capability advertised`,async t=>{const calls=mock(t,mode);await assert.rejects(upload);await assert.rejects(()=>handlePrivateProofCapabilities({method:'GET',headers,mentorApiUrl:env.MENTOR_ORIGIN,env}));assert.equal(calls.some(x=>x.url.includes('/upload/')),false);});
test('Node capability is authenticated and read-only, before any file bytes',async t=>{const calls=mock(t);const result=await handlePrivateProofCapabilities({method:'GET',headers,mentorApiUrl:env.MENTOR_ORIGIN,env});assert.equal(result.status,200);assert.equal(result.body.protocol,'private-v1');assert.equal(result.body.private,true);assert.equal(calls.some(x=>x.url.includes('/upload/')),false);assert.equal(calls.some(x=>x.url.includes('/permissions')&&x.init.method==='POST'),false);});
test('Worker capability checks the same private destination without writing',async t=>{const calls=mock(t);const response=await worker.fetch(new Request('https://gateway.invalid/api/proof-capabilities',{headers}),env);assert.equal(response.status,200);assert.equal((await response.json()).private,true);assert.equal(calls.some(x=>x.url.includes('/upload/')),false);});
