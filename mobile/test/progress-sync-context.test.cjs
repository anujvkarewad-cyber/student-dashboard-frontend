const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const source=fs.readFileSync(path.join(__dirname,'../src/context/ProgressSyncContext.tsx'),'utf8');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const drain=async()=>{for(let n=0;n<4;n++)await new Promise(r=>setImmediate(r));};
function harness(options={}){
 let student={studentId:'UMP0000'},cursor=0,tree;const hooks=[],effects=[],writes=[],syncCalls=[];
 const react={createContext:()=>({Provider:'Provider'}),createElement:(type,props,...children)=>({type,props:{...props,children}}),useContext:()=>null,
 useState:initial=>{let i=cursor++;if(!(i in hooks))hooks[i]=initial;return [hooks[i],v=>{hooks[i]=typeof v==='function'?v(hooks[i]):v;}];},
 useRef:initial=>{let i=cursor++;if(!(i in hooks))hooks[i]={current:initial};return hooks[i];},useCallback:f=>f,useMemo:f=>f(),
 useEffect:(f,deps)=>{let i=cursor++,old=hooks[i];if(!old||deps.some((v,n)=>v!==old.deps[n]))effects.push(()=>{old?.cleanup?.();hooks[i]={deps,cleanup:f()};});}};
 const exports={};let timer=0;
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText,{exports,Date,Map,Promise,setTimeout:()=>++timer,clearTimeout:()=>{},require:name=>{
 if(name==='react')return {__esModule:true,default:react,...react};
 if(name.includes('async-storage'))return {__esModule:true,default:{setItem:async(...args)=>writes.push(args)}};
 if(name.endsWith('/progressSync'))return {getShareChoice:async()=>options.sharing!==false,setMentorSharing:async()=>{if(options.consentGate)await options.consentGate.promise;if(options.consentError)throw Error('denied');},buildProgressPayload:(_sid,_sessions,lookup)=>{options.observeLookup?.(lookup);return {summaries:options.empty?[]:[{chapterId:'test'}],trend:[]};},syncProgress:async sid=>{syncCalls.push(sid);if(options.syncGate)await options.syncGate.promise;return {ok:true,accepted:1};}};
 if(name.endsWith('/AuthContext'))return {useAuth:()=>({student,backendMode:'live'})};
 if(name.endsWith('/DailyMcqContext'))return {useDailyMcq:()=>({history:options.dailyHistory||[{completedAt:1}]})};
 if(name.endsWith('/McqPracticeContext'))return {useMcqPractice:()=>({history:[]})};
 if(name.endsWith('/McqBankContext'))return {useMcqBank:()=>({questions:[]})};
 throw Error('Unexpected dependency '+name);
 }});
 const render=()=>{cursor=0;tree=exports.ProgressSyncProvider({children:null});while(effects.length)effects.shift()();return tree.props.value;};
 return {render,writes,syncCalls,switchAccount:()=>{student={studentId:'UMP9002'};render();}};
}
async function ready(h){h.render();await drain();return h.render();}
test('progress ack updates only owner-scoped timestamp, not global state storage',async()=>{
 const h=harness();const v=await ready(h);await v.syncNow();const next=h.render();assert.equal(next.status,'ok');assert.equal(h.writes[0][0],'ump_progress_synced_at:UMP0000');
});
test('account switch during in-flight response cannot show old account success',async()=>{
 const gate=deferred(),h=harness({syncGate:gate});const v=await ready(h);const pending=v.syncNow();await drain();h.switchAccount();await drain();gate.resolve();await pending;
 const next=h.render();assert.notEqual(next.status,'ok');assert.equal(next.lastSyncedAt,undefined);assert.equal(h.writes.length,0);
});
test('consent is not optimistic and confirmed enablement immediately syncs',async()=>{
 const gate=deferred(),h=harness({sharing:false,consentGate:gate});const v=await ready(h);const pending=v.setSharing(true);await drain();assert.equal(h.render().sharing,false);gate.resolve();await pending;assert.equal(h.render().sharing,true);assert.deepEqual(h.syncCalls,['UMP0000']);
});
test('failed consent does not display sharing enabled',async()=>{
 const h=harness({sharing:false,consentError:true});const v=await ready(h);await v.setSharing(true);assert.equal(h.render().sharing,false);assert.equal(h.render().status,'error');assert.equal(h.syncCalls.length,0);
});
test('no chapter summaries does not invent a synced acknowledgement',async()=>{
 const h=harness({empty:true});const v=await ready(h);await v.syncNow();assert.equal(h.render().status,'idle');assert.equal(h.syncCalls.length,0);assert.equal(h.writes.length,0);
});
test('progress upload never triggers unrelated mentor-test history upload',()=>{
 assert.doesNotMatch(source,/syncTestHistory/);
});

test('official Daily chapter metadata supports sync before the practice bank loads',async()=>{
 let seen;const official={id:'daily-q',chapterId:'official-chapter'};
 const h=harness({dailyHistory:[{completedAt:1,officialQuestions:[official]}],observeLookup:lookup=>{seen=lookup;}});
 const v=await ready(h);await v.syncNow();assert.equal(seen.get('daily-q').chapterId,'official-chapter');assert.equal(h.render().status,'ok');
});
