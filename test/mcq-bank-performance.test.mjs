import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../live-bank-loader.js',import.meta.url),'utf8');
const drain=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));};
function harness({cached=true,changed=false,failBank=false}={}){
 const payload={revision:'published-r3',questions:[{id:'published-q',prompt:'Question',options:['a','b','c','d'],answer:0,chapterId:'accounts-1'}]};
 const calls=[],events={},deletes=[];
 const indexedDB={open(){const req={};setImmediate(()=>{req.result={transaction(){const tx={objectStore(){return {get(){const r={};setImmediate(()=>{r.result=cached?{payload}:null;r.onsuccess?.();});return r;},put(){setImmediate(()=>tx.oncomplete?.());},delete(){deletes.push(true);setImmediate(()=>tx.oncomplete?.());}};}};return tx;}};req.onsuccess?.();});return req;}};
 const window={UMP_LEARNING_DATA:{questions:[]},dispatchEvent(){},addEventListener(){}};
 const document={readyState:'loading',visibilityState:'visible',addEventListener:(name,fn)=>{events[name]=fn;}};
 vm.runInNewContext(source,{window,document,indexedDB,localStorage:{getItem:()=>null},location:{hash:'#mcq'},CustomEvent:class{},console:{log(){},warn(){},debug(){}},AbortController,setTimeout,clearTimeout,setInterval:()=>0,
 fetch:async url=>{calls.push(url);if(url.endsWith('bank-meta.json'))return {ok:true,json:async()=>({revision:changed?'published-r4':'published-r3',count:1})};if(failBank)throw Error('offline');return {ok:true,json:async()=>({...payload,revision:changed?'published-r4':'published-r3'})};}});
 return {window,calls,deletes,start:()=>events.DOMContentLoaded()};
}
test('web warm launch validates metadata without downloading the entire unchanged bank',async()=>{
 const h=harness();h.start();await drain();assert.deepEqual(h.calls,['/api/mentor/api/content/student/bank-meta.json']);assert.equal(h.window.UMP_LEARNING_DATA.questions.length,1);
});
test('web cold launch fetches published bank and never exposes static preview data',async()=>{
 const h=harness({cached:false});assert.equal(h.window.UMP_LEARNING_DATA.questions.length,0);h.start();await drain();assert.deepEqual(h.calls,['/api/mentor/api/content/student/bank.json']);assert.equal(h.window.UMP_LEARNING_DATA.questions[0].id,'published-q');
});
test('web changed release downloads the new bank after small revision check',async()=>{
 const h=harness({changed:true});h.start();await drain();assert.equal(h.calls.length,2);assert.equal(h.window.UMP_LEARNING_DATA.revision,'published-r4');
});
test('web retry failure retains last good IndexedDB bank instead of deleting it',async()=>{
 const h=harness({failBank:true});h.start();await drain();await h.window.UMP_REFRESH_LIVE_BANK();assert.equal(h.deletes.length,0);assert.equal(h.window.UMP_LEARNING_DATA.questions[0].id,'published-q');assert.equal(h.window.UMP_LIVE_BANK_STATUS.state,'stale');
});
