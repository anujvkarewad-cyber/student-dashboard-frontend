import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');const start=source.indexOf('          reader.onload = () => {',source.indexOf('const uploadCurrent = privateFence();'));const end=source.indexOf('          reader.onerror',start);assert.ok(start>0&&end>start);
async function run(packet,{ok=true,current=true,late=false}={}){
  let calls=0,renders=0;
  const fill={style:{}},textEl={textContent:''};
  class XMLHttpRequest{
    constructor(){this.upload={};this.timeout=0;}
    open(method,url){this.method=method;this.url=url;}
    send(body){
      calls++;this.body=body;
      if(late)current=false;
      setImmediate(()=>{this.status=ok?200:500;this.responseText=JSON.stringify(packet);if(typeof this.upload.onprogress==='function')this.upload.onprogress({lengthComputable:true,loaded:Math.floor((body||'').length/2),total:(body||'').length||1});this.onload&&this.onload();});
    }
  }
  const context={reader:{result:'data:application/pdf;base64,c3ludGhldGlj'},file:{type:'application/pdf',name:'synthetic.pdf'},state:{answerUrl:'',phase:1},btn:{style:{}},progDiv:{style:{},querySelector:(sel)=>sel==='.upload-progress-fill'?fill:textEl},errDiv:{textContent:''},uploadCurrent:()=>current,render:()=>{renders++;},XMLHttpRequest,setImmediate};
  vm.runInNewContext(source.slice(start,end),context);
  context.reader.onload();
  await new Promise(setImmediate);await new Promise(setImmediate);await new Promise(setImmediate);await new Promise(setImmediate);
  return{...context,calls,renders,fill,textEl};
}
for(const packet of [{},{ok:false,result:{url:'https://synthetic.invalid/file'}},{result:{url:42}},{result:{url:' '}},{result:{success:false,url:'https://synthetic.invalid/file'}}])test('actual browser answer callback rejects unconfirmed upload',async()=>{const h=await run(packet);assert.equal(h.state.phase,1);assert.equal(h.renders,0);assert.equal(h.calls,1);});
test('actual browser callback preserves confirmed legacy result URL',async()=>{const h=await run({result:{url:'https://synthetic.invalid/file'}});assert.equal(h.state.phase,2);assert.equal(h.renders,1);assert.equal(h.fill.style.width,'100%');});
test('actual browser callback never starts old-account work',async()=>{const h=await run({result:{url:'https://synthetic.invalid/file'}},{current:false});assert.equal(h.calls,0);assert.equal(h.state.phase,1);});
test('actual browser callback does not accept non200 URL',async()=>{const h=await run({result:{url:'https://synthetic.invalid/file'}},{ok:false});assert.equal(h.state.phase,1);assert.equal(h.renders,0);});
test('late old-account browser result cannot attach to current account',async()=>{const h=await run({result:{url:'https://synthetic.invalid/file'}},{late:true});assert.equal(h.state.phase,1);assert.equal(h.renders,0);});
test('upload reports a real percentage to the progress bar',async()=>{const h=await run({result:{url:'https://synthetic.invalid/file'}});assert.match(h.textEl.textContent,/Upload (complete|…)/);});
