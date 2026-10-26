import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import worker from '../cloudflare/src/worker.js';

const source=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
const start=source.indexOf('const HOP_BY_HOP =');
const end=source.indexOf('\n/* ------------------------------------------------------------------ *',start);
assert.ok(start>0&&end>start);
const path='/api/smart-targets/student/dashboard';
const payload=JSON.stringify({studentId:'LOCAL_A',password:'synthetic-test-only'});
for(const status of [200,401,405]) {
 test(`Node forwards actual smart-target POST path/body and preserves HTTP ${status}`,async()=>{
  const calls=[];
  const packet=status===200?{studentId:'LOCAL_A',plans:[],history:[]}:{detail:status===405?'Method Not Allowed':'Login required'};
  const context={exports:{},MENTOR_API_URL:'https://backend.example.invalid',MENTOR_TIMEOUT_MS:1000,
   process:{env:{MENTOR_SERVICE_TOKEN:'must-not-be-injected'}},AbortController,setTimeout,clearTimeout,Buffer,console,
   readBody:async()=>Buffer.from(payload),fetch:async(url,init)=>{calls.push({url,init});return Response.json(packet,{status});}};
  vm.runInNewContext(source.slice(start,end)+'\nexports.handleMentor=handleMentor;',context);
  const response={writeHead(code,headers){this.code=code;this.headers=headers;},end(body){this.body=body;}};
  await context.exports.handleMentor({method:'POST',headers:{'content-type':'application/json'}},response,new URL('https://gateway.example.invalid/api/mentor'+path));
  assert.equal(calls.length,1);assert.equal(calls[0].url,'https://backend.example.invalid'+path);
  assert.equal(calls[0].init.method,'POST');assert.equal(calls[0].init.body.toString(),payload);
  assert.equal(calls[0].init.headers.authorization,undefined);assert.equal(response.code,status);
  assert.deepEqual(JSON.parse(response.body.toString()),packet);
 });
 test(`Worker preserves smart-target POST and HTTP ${status} without alternate provider`,async()=>{
  const original=global.fetch;const calls=[];
  global.fetch=async(url,init)=>{calls.push({url:String(url),init});return Response.json(status===200?{studentId:'LOCAL_A',plans:[]}:{detail:'Not available'},{status});};
  try {
   const response=await worker.fetch(new Request('https://gateway.example.invalid/api/mentor'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:payload}),{MENTOR_ORIGIN:'https://backend.example.invalid',MENTOR_SERVICE_TOKEN:'must-not-be-injected'});
   assert.equal(response.status,status);assert.equal(calls.length,1);
   assert.equal(calls[0].url,'https://backend.example.invalid'+path);assert.equal(calls[0].init.method,'POST');
   assert.equal(new Headers(calls[0].init.headers).get('authorization'),null);
   assert.equal(await new Response(calls[0].init.body).text(),payload);
  } finally {global.fetch=original;}
 });
}
