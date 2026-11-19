import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');const start=source.indexOf('  function startAnswerUpload');const end=source.indexOf('  // Server-graded runner',start);assert.ok(start>0&&end>start);
async function run(packet,{ok=true,current=true,late=false}={}){
  let calls=0,renders=0;const sent=[];
  const fill={style:{}},textEl={textContent:''};
  const headers={};
  class XMLHttpRequest{
    constructor(){this.upload={};this.timeout=0;this.headers={};}
    open(method,url){this.method=method;this.url=url;}
    setRequestHeader(key,value){this.headers[key]=value;}
    send(body){
      calls++;sent.push(body);
      if(late)current=false;
      setImmediate(()=>{this.status=ok?200:500;this.responseText=JSON.stringify(packet);if(typeof this.upload.onprogress==='function')this.upload.onprogress({lengthComputable:true,loaded:Math.floor((body?.size||1)/2),total:body?.size||1});this.onload&&this.onload();});
    }
  }
  const state={answerUrl:'',phase:1};
  const context={localStorage:{getItem:()=>JSON.stringify({studentId:'UMP0001',password:'synthetic'})},encodeURIComponent,Math,JSON,setImmediate,file:{size:2611200,type:'application/pdf',name:'synthetic.pdf'},btn:{style:{}},progDiv:{style:{},querySelector:(sel)=>sel==='.upload-progress-fill'?fill:textEl},errDiv:{textContent:''},uploadCurrent:()=>current,onDone:(url)=>{state.answerUrl=url;state.phase=2;renders++;},XMLHttpRequest};
  vm.runInNewContext(source.slice(start,end),context);
  context.startAnswerUpload({file:context.file,btn:context.btn,progDiv:context.progDiv,errDiv:context.errDiv,uploadCurrent:context.uploadCurrent,onDone:context.onDone});
  await new Promise(setImmediate);await new Promise(setImmediate);await new Promise(setImmediate);await new Promise(setImmediate);
  return{...context,calls,renders,fill,textEl,sent,state};
}
for(const packet of [{},{ok:false,result:{url:'https://synthetic.invalid/file'}},{result:{url:42}},{result:{url:' '}},{result:{success:false,url:'https://synthetic.invalid/file'}}])test('actual browser answer callback rejects unconfirmed upload',async()=>{const h=await run(packet);assert.equal(h.state.phase,1);assert.equal(h.renders,0);assert.equal(h.calls,1);});
test('actual browser callback preserves confirmed result URL',async()=>{const h=await run({result:{url:'https://synthetic.invalid/file'}});assert.equal(h.state.phase,2);assert.equal(h.renders,1);assert.equal(h.fill.style.width,'100%');});
test('actual browser callback never starts old-account work',async()=>{const h=await run({result:{url:'https://synthetic.invalid/file'}},{current:false});assert.equal(h.calls,1);assert.equal(h.state.phase,1);});
test('actual browser callback does not accept non200 URL',async()=>{const h=await run({result:{url:'https://synthetic.invalid/file'}},{ok:false});assert.equal(h.state.phase,1);assert.equal(h.renders,0);});
test('late old-account browser result cannot attach to current account',async()=>{const h=await run({result:{url:'https://synthetic.invalid/file'}},{late:true});assert.equal(h.state.phase,1);assert.equal(h.renders,0);});
test('upload reports a real percentage to the progress bar',async()=>{const h=await run({result:{url:'https://synthetic.invalid/file'}});assert.match(h.textEl.textContent,/Upload (complete|…)/);});
test('sends the raw file to the same-origin relay, never base64',async()=>{const h=await run({result:{url:'https://synthetic.invalid/file'}});assert.equal(h.sent.length,1);assert.equal(h.sent[0],h.file);});
