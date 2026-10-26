import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// One-shot local HTTP server only: no provider calls, fixture writes or external API.
test('actual local gateway serves the workbook and its dedicated assets, not the dashboard fallback', async () => {
  const prior = { PORT:process.env.PORT, HOST:process.env.HOST, MENTOR_API_URL:process.env.MENTOR_API_URL };
  process.env.PORT='0'; process.env.HOST='0.0.0.0'; process.env.MENTOR_API_URL='http://127.0.0.1:1';
  let server;
  try {
    server=(await import('../server.js?workbook-static-contract')).default;
    if (!server.listening) await once(server,'listening');
    const base='http://127.0.0.1:'+server.address().port;
    for (const [resource, expectedType, marker] of [
      ['/workbook.html','text/html','id="objectiveAnswer"'],
      ['/workbook-objective.js','javascript','UMP_WORKBOOK_OBJECTIVE'],
      ['/workbook-core.js','javascript','UMP_WORKBOOK_CORE'],
      ['/workbook.js','javascript','answerReady'],
      ['/practice-client.js','javascript','UMP_PRACTICE'],
      ['/practice-vendor/pdf.worker.mjs','javascript','pdfjs']
    ]) {
      const response=await fetch(base+resource);
      assert.equal(response.status,200,resource);assert.ok(response.headers.get('content-type').includes(expectedType),resource);
      assert.ok((await response.text()).includes(marker),resource);
    }
    assert.equal((await fetch(base+'/mobile/src/storage/session.ts')).status,404);
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
    for (const [key,value] of Object.entries(prior)) { if(value===undefined)delete process.env[key];else process.env[key]=value; }
  }
});

test('retained PDF renderer files match the existing vendor hash manifest',()=>{
  const dir=new URL('../practice-vendor/',import.meta.url),manifest=JSON.parse(fs.readFileSync(new URL('manifest.json',dir),'utf8'));
  assert.ok(Object.keys(manifest.files).length>100);
  for (const [name,expected] of Object.entries(manifest.files)) {
    assert.ok(!path.isAbsolute(name)&&!name.split('/').includes('..'));
    const bytes=fs.readFileSync(new URL(name,dir));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),expected,name);
  }
});
