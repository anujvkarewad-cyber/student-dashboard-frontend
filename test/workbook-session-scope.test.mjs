import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
const transport=fs.readFileSync(new URL('../practice-client.js',import.meta.url),'utf8');
for(const [scope,expected] of [['workbook','/workbooks/session'],[undefined,'/session'],['https://untrusted.invalid','/session']]) {
 test('practice transport keeps workbook/receipt sessions separate: '+String(scope),async()=>{
  const dom=new JSDOM('<!doctype html>',{url:'https://student.fixture.invalid',runScripts:'outside-only'}),w=dom.window,calls=[];
  const script=w.document.createElement('script');if(scope)script.dataset.practiceScope=scope;
  Object.defineProperty(w.document,'currentScript',{configurable:true,value:script});
  w.localStorage.setItem('ump_student',JSON.stringify({studentId:'UMP9001',password:'synthetic-only'}));
  w.fetch=async(url,options)=>{calls.push({url,options});return {ok:true,status:200,json:async()=>url.endsWith('/session')?{token:'synthetic-capability',studentId:'UMP9001'}:{workbooks:[]}};};
  w.eval(transport);await w.UMP_PRACTICE.request('/workbooks');
  assert.equal(calls[0].url,'/api/mentor/api/practice'+expected);
  assert.equal(calls[0].options.method,'POST');assert.equal(calls[1].options.headers['X-Practice-Token'],'synthetic-capability');
  assert.equal(calls[1].url,'/api/mentor/api/practice/workbooks');
  dom.window.close();
 });
}
test('delivered workbook HTML explicitly selects the workbook-only session',()=>{
 const html=fs.readFileSync(new URL('../workbook.html',import.meta.url),'utf8');
 const dom=new JSDOM(html),script=dom.window.document.querySelector('script[src="practice-client.js"]');
 assert.equal(script.dataset.practiceScope,'workbook');assert.equal(dom.window.document.querySelectorAll('script[src="practice-client.js"]').length,1);dom.window.close();
});
