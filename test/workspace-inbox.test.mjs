import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
function harness() {
  let saved = { studentId:'UMP0001', password:'synthetic-only' }; let switchOnRead = false;
  const calls = [];
  const context = { window:{}, Date, JSON, AbortSignal, localStorage:{ getItem:() => JSON.stringify(saved), setItem:() => { throw new Error('Private proof must not be persisted'); } }, fetch:async (url, opts) => {
    calls.push({url,opts});
    if (url.endsWith('/session')) return {ok:true,json:async()=>({studentId:'UMP0001',token:'synthetic-proof'})};
    if (switchOnRead) saved = {studentId:'UMP0002',password:'other'};
    return {ok:true,json:async()=>({studentId:'UMP0001',messages:[{text:'private'}]})};
  }};
  vm.createContext(context); vm.runInContext(fs.readFileSync(new URL('../api.js', import.meta.url),'utf8'),context);
  return {context,calls,setSession:value=>{saved=value;},switchOnRead:()=>{switchOnRead=true;}};
}
test('web private workspace uses credentials once, header proof, and no token persistence',async()=>{
  const h=harness(); const row=await h.context.readPrivateWorkspace('messages','UMP0001');
  assert.equal(row.messages[0].text,'private'); assert.equal(h.calls.length,2);
  assert.equal(h.calls[1].opts.headers['X-Workspace-Token'],'synthetic-proof');
  await h.context.readPrivateWorkspace('messages','UMP0001'); assert.equal(h.calls.length,3);
  assert.ok(h.calls.every(c=>!c.url.includes('synthetic')));
});
test('web reader ignores a mismatched account without issuing a request',async()=>{
  const h=harness(); assert.equal(await h.context.readPrivateWorkspace('messages','UMP0002'),null); assert.equal(h.calls.length,0);
});
test('web reader rejects a response arriving after account switch',async()=>{
  const h=harness(); h.switchOnRead(); assert.equal(await h.context.readPrivateWorkspace('messages','UMP0001'),null);
});
