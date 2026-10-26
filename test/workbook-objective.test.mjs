import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
const source=fs.readFileSync(new URL('../workbook-objective.js',import.meta.url),'utf8');
function setup(question,saved=''){
 const dom=new JSDOM('<div id="root"></div>',{runScripts:'outside-only'}),w=dom.window;w.eval(source);const updates=[];
 const api=w.UMP_WORKBOOK_OBJECTIVE.render(w.document.getElementById('root'),question,saved,(v,e)=>updates.push({v,error:e?.message}));
 return{dom,w,api,updates,inputs:()=>Array.from(w.document.querySelectorAll('input,select'))};
}
const mcq={format:'mcq',objective:{options:[{id:'A',text:'Choice A'},{id:'B',text:'Choice B'}]}};
const blanks={format:'blanks',objective:{slots:[{id:'s1',text:'First blank'},{id:'s2',text:'Second blank'}]}};
const matching={format:'matching',objective:{left:[{id:'a',text:'First item'},{id:'b',text:'Second item'}],right:[{id:'x',text:'Match X'},{id:'y',text:'Match Y'}]}};
function edit(t,index,value,event='input'){const el=t.inputs()[index];if(el.type==='radio')el.checked=true;else el.value=value;el.dispatchEvent(new t.w.Event(event,{bubbles:true}));}
test('MCQ requires a selection and serializes only its option ID, not a guessed score',()=>{
 const t=setup(mcq);assert.equal(t.api.isComplete(),false);edit(t,1,'B','change');assert.equal(t.api.isComplete(),true);assert.deepEqual(JSON.parse(t.api.serialize()),{choice:'B'});assert.equal(t.updates.length,1);assert.equal(t.w.document.querySelector('form'),null);t.dom.window.close();
});
test('blank fields keep editable individual values, reject unresolved OCR and do not auto-grade',()=>{
 const t=setup(blanks);edit(t,0,'independent');assert.equal(t.api.isComplete(),false);edit(t,1,'[unclear]');assert.equal(t.api.isComplete(),false);edit(t,1,'appearance');assert.equal(t.api.isComplete(),true);assert.deepEqual(JSON.parse(t.api.serialize()),{responses:{s1:'independent',s2:'appearance'}});t.dom.window.close();
});
test('matching controls require distinct choices; reset removes choices without calling save',()=>{
 const t=setup(matching);edit(t,0,'x','change');edit(t,1,'x','change');assert.equal(t.api.isComplete(),false);edit(t,1,'y','change');assert.equal(t.api.isComplete(),true);const n=t.updates.length;t.api.reset();assert.equal(t.api.isComplete(),false);assert.equal(t.updates.length,n);t.dom.window.close();
});
test('saved structured draft reopens and lock disables the fieldset',()=>{
 const t=setup(blanks,JSON.stringify({responses:{s1:'retained first',s2:'retained second'}}));assert.equal(t.inputs()[0].value,'retained first');assert.equal(t.api.isComplete(),true);t.api.setDisabled(true);assert.equal(t.w.document.querySelector('fieldset').disabled,true);t.dom.window.close();
});
for(const invalid of [{...mcq,format:'future-format'},{format:'mcq',objective:{...mcq.objective,correctOptionId:'B'}},{format:'blanks',objective:{slots:[{id:'s1',text:'Blank',acceptedAnswers:['secret']}]}}])test('unknown format or leaked key cannot fall back to a generic essay field '+invalid.format,()=>{
 assert.throws(()=>setup(invalid));
});
test('incompatible saved answer is not silently converted or overwritten',()=>{
 assert.throws(()=>setup(mcq,'My retained written answer'),/different format/);assert.throws(()=>setup(mcq,'{"choice":"Z"}'),/preserved/);assert.throws(()=>setup(blanks,'{"responses":{"foreign":"answer"}}'),/do not match/);
});
test('labels are text, not executable markup',()=>{
 const q=structuredClone(blanks);q.objective.slots[0].text='<img src=x onerror=alert(1)>';const t=setup(q);assert.equal(t.w.document.querySelector('img'),null);assert.match(t.w.document.body.textContent,/<img/);t.dom.window.close();
});
test('oversized structured serialization fails explicitly without truncation or a successful save callback',()=>{
 const q={format:'blanks',objective:{slots:Array.from({length:20},(_,i)=>({id:'s'+i,text:'Blank '+i}))}},t=setup(q);
 for(let i=0;i<20;i++)edit(t,i,'"'.repeat(500));assert.equal(t.api.isComplete(),false);assert.throws(()=>t.api.serialize(),/no text was truncated/);assert.match(t.updates.at(-1).error,/exceeds/);assert.equal(t.inputs()[19].value.length,500);t.dom.window.close();
});
test('existing workbook page wires dedicated controls and packages the asset without adding voice or automatic submission',()=>{
 const js=fs.readFileSync(new URL('../workbook.js',import.meta.url),'utf8'),html=fs.readFileSync(new URL('../workbook.html',import.meta.url),'utf8'),docker=fs.readFileSync(new URL('../Dockerfile',import.meta.url),'utf8');
 assert.match(js,/UMP_WORKBOOK_OBJECTIVE\.render/);assert.match(js,/objectiveController\.serialize/);assert.match(js,/confirmed.*answerReady/);assert.match(html,/id="objectiveAnswer"/);assert.match(html,/src="workbook-objective\.js"/);assert.match(docker,/workbook-objective\.js/);assert.doesNotMatch(source,/fetch\(|\/grade|ReceiptVoiceButton|\.submit\(/);
});
