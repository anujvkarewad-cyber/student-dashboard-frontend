import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
function harness(){const disk=new Map([['ump_student',JSON.stringify({studentId:'UMP0001',password:'synthetic'})]]),owners=new Map(),calls=[];let epoch=0;const context={window:{dispatchEvent(){}},Event,AbortController,setTimeout,clearTimeout,localStorage:{getItem:k=>disk.get(k)||null,setItem:(k,v)=>disk.set(k,v),removeItem:k=>disk.delete(k)},fetch:async(url,init)=>{const body=JSON.parse(init.body);if(url.endsWith('/remove')){calls.push('remove');if(owners.get(body.token)===body.studentId)owners.delete(body.token);}else{calls.push('register');owners.set(body.payload.token,body.payload.studentId);}return{ok:true,status:200,json:async()=>({result:{success:true}})};}};vm.runInNewContext(fs.readFileSync(new URL('../api.js',import.meta.url),'utf8'),context);return{...context,disk,owners,calls};}
const token='synthetic-browser-device-token-not-real';
test('actual web registration/logout and repeated login remove remote binding without exposing token',async()=>{const h=harness();for(const sid of ['UMP0001','UMP0002','UMP0001']){h.disk.set('ump_student',JSON.stringify({studentId:sid,password:'synthetic'}));const result=await h.window.UMP_API.saveDeviceToken(sid,token);assert.equal(result.success,true);assert.equal(h.owners.get(token),sid);await h.window.UMP_CLEAR_PRIVATE_SESSION();assert.equal(h.owners.size,0);assert.equal(h.disk.has('ump_student'),false);assert.equal(h.disk.has('ump_fcm_token_'+sid),false);}assert.equal(h.calls.length,6);});
test('actual web token registration requires current owner',async()=>{const h=harness();await assert.rejects(h.window.UMP_API.saveDeviceToken('UMP0002',token));assert.equal(h.calls.length,0);});
test('actual browser FCM code has no token-valued console diagnostic or false-success cache shortcut',()=>{const source=fs.readFileSync(new URL('../firebase-init.js',import.meta.url),'utf8');assert.doesNotMatch(source,/console\.log\([^\n]*(?:token\.slice|Current FCM token)/);assert.doesNotMatch(source,/force \|\| alreadySaved !== token/);assert.match(source,/res\?\.success !== true/);assert.match(source,/if \(!current\(\)\) return null/);});

test('actual Firebase browser module rebinds cached token and filters foreign/ownerless foreground messages',async()=>{
 const h=harness();let received,shown=0;const messaging={getToken:async()=>token,onMessage:fn=>{received=fn;}};
 Object.assign(h,{firebase:{apps:[{}],messaging:()=>messaging},navigator:{serviceWorker:{ready:Promise.resolve({active:true})}},Notification:{permission:'granted'},console:{log(){},warn(){},error(){}}});
 Object.assign(h.window,{Notification:h.Notification,PushManager:function(){},isSecureContext:true,__umpShowPushToast:()=>{shown++;}});
 vm.runInNewContext(fs.readFileSync(new URL('../firebase-init.js',import.meta.url),'utf8'),h);
 h.disk.set('ump_fcm_token_UMP0001',token);h.owners.set(token,'UMP0002');
 assert.equal(await h.window.UMP_PUSH.requestAndSaveToken('UMP0001'),token);
 assert.equal(h.owners.get(token),'UMP0001');
 received({data:{studentId:'UMP0001',title:'Synthetic'}});
 received({data:{studentId:'UMP0002',title:'Must not display'}});
 received({data:{title:'No owner'}});
 h.disk.delete('ump_student');received({data:{studentId:'UMP0001',title:'Logged out'}});
 assert.equal(shown,1);
});
