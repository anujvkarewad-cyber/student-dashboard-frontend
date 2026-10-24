const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const later=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const drain=async()=>{for(let i=0;i<6;i++)await new Promise(r=>setImmediate(r));};
function mount(file,provider,modules,globals={}){
 let cursor=0,tree;const slots=[],effects=[];
 const changed=(a,b)=>!a||b.some((v,i)=>v!==a[i]);
 const memo=(f,deps)=>{const i=cursor++,old=slots[i];if(!old||changed(old.deps,deps))slots[i]={deps,value:f()};return slots[i].value;};
 const react={createContext:()=>({Provider:'Provider'}),createElement:(type,props,...children)=>({type,props:{...props,children}}),useContext:()=>null,
 useState:v=>{const i=cursor++;if(!(i in slots))slots[i]=v;return[slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},
 useRef:v=>{const i=cursor++;if(!(i in slots))slots[i]={current:v};return slots[i];},useMemo:memo,useCallback:(f,deps)=>memo(()=>f,deps),
 useEffect:(f,deps)=>{const i=cursor++,old=slots[i];if(!old||changed(old.deps,deps))effects.push(()=>{old?.cleanup?.();slots[i]={deps,cleanup:f()};});}};
 const exports={};const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText;
 vm.runInNewContext(code,{exports,Date,Map,Set,Promise,AbortController,setTimeout,clearTimeout,setInterval:()=>0,clearInterval:()=>{},...globals,require:name=>{
 if(name==='react')return {__esModule:true,default:react,...react};
 if(name in modules)return modules[name];throw Error('Unexpected module '+name);
 }});
 return ()=>{cursor=0;tree=exports[provider]({children:null});while(effects.length)effects.shift()();return tree.props.value;};
}
const question=id=>({id,subject:'Accounts',prompt:'Question',options:['a','b','c','d'],answer:0,chapterId:'accounts-1',officialChapter:{id:'accounts-1'},kind:'normal'});
function bankHarness(options={}){
 const gate=later(),calls=[],writes=[];const cached={revision:'published-r3',count:1,questions:[question('saved')]};
 const render=mount('context/McqBankContext.tsx','McqBankProvider',{
 '@react-native-async-storage/async-storage':{__esModule:true,default:{getItem:async()=>options.noCache?null:JSON.stringify(cached),setItem:async(...a)=>writes.push(a)}},
 'react-native':{AppState:{currentState:'active',addEventListener:()=>({remove(){}})}},'../config':{config:{mentorApiUrl:'https://gateway.invalid/api/mentor'}}
 },{fetch:async url=>{calls.push(url);if(url.endsWith('bank.json'))await gate.promise;return {ok:!options.fail,status:options.fail?503:200,json:async()=>url.endsWith('bank-meta.json')?{count:options.metaCount??0}:options.empty?{revision:'published-r4',questions:[],count:0}:{revision:'published-r4',questions:[question('new')],count:1}};}});
 return {render,gate,calls,writes};
}
test('saved published questions are available while network download remains pending',async()=>{
 const h=bankHarness();h.render();await drain();const v=h.render();assert.equal(v.hydrated,true);assert.equal(v.questions[0].id,'saved');assert.equal(v.refreshing,true);h.gate.resolve();await drain();
});
test('concurrent refreshes share one bank request, no metadata preflight or rerender loop',async()=>{
 const h=bankHarness();h.render();await drain();const v=h.render();const a=v.refresh(),b=v.refresh();assert.equal(a,b);assert.equal(h.calls.length,1);h.gate.resolve();await a;h.render();await drain();h.render();assert.equal(h.calls.length,1);assert.equal(h.calls[0],'https://gateway.invalid/api/mentor/api/content/student/bank.json');
});
test('failed download retains cached bank and reports retryable error',async()=>{
 const h=bankHarness({fail:true});h.render();await drain();h.gate.resolve();await drain();const v=h.render();assert.equal(v.questions[0].id,'saved');assert.match(v.error,/503/);assert.equal(h.writes.length,0);
});
test('authoritative unpublish clears cached bank only after zero-count confirmation',async()=>{
 const h=bankHarness({empty:true,metaCount:0});h.render();await drain();h.gate.resolve();await drain();const v=h.render();assert.equal(v.questions.length,0);assert.equal(v.revision,'published-r4');assert.equal(h.calls.length,2);
});
test('unexpected empty bank does not replace valid cached published questions',async()=>{
 const h=bankHarness({empty:true,metaCount:4700});h.render();await drain();h.gate.resolve();await drain();const v=h.render();assert.equal(v.questions[0].id,'saved');assert.match(v.error,/incomplete/);
});
function dailyHarness(saved=[]){
 const restore=later(),writes=[],issued=[];
 const date=new Date(Date.now()+330*60000).toISOString().slice(0,10);const qs=Array.from({length:10},(_,i)=>question('official-'+i));const official={officialSetId:'a'.repeat(64),date,group:'Group I',bankRevision:'published-r3',questionIds:qs.map(q=>q.id),questions:qs,issuedAt:Date.now()};
 const render=mount('context/DailyMcqContext.tsx','DailyMcqProvider',{
 '@react-native-async-storage/async-storage':{__esModule:true,default:{getItem:async()=>JSON.stringify(saved),setItem:async(...a)=>writes.push(a)}},
 '../utils/caGroups':{subjectGroup:()=> 'Group I'},'./AuthContext':{useAuth:()=>({student:{studentId:'UMP0000'},backendMode:'live'})},
 './McqBankContext':{useMcqBank:()=>({hydrated:false,revision:'published-loading',questions:[]})},
 '../services/mcqCloudSync':{restoreMcqAttempts:()=>restore.promise,syncCompletedMcqAttempts:async()=>({ok:true}),fetchOfficialDailySet:async(...args)=>{issued.push(args);return official;}}
 });return {render,restore,writes,issued,official};
}
test('Daily screen hydrates without full-bank download or cloud restore',async()=>{
 const h=dailyHarness();h.render();await drain();const v=h.render();assert.equal(v.hydrated,true);assert.equal(v.history.length,0);
});
test('Daily official ten questions can start and display with empty practice bank',async()=>{
 const h=dailyHarness();h.render();await drain();let v=h.render();await v.startDaily('Group I');v=h.render();assert.equal(h.issued.length,1);assert.equal(v.questionsForGroup('Group I').length,10);assert.equal(v.history[0].officialSetId,h.official.officialSetId);
});
test('bank loading never deletes a saved Daily attempt due to unknown revision',async()=>{
 const saved=[{date:'2026-10-22',group:'Group I',bankRevision:'published-r2',questionIds:['old'],answers:{old:0},startedAt:1}];const h=dailyHarness(saved);h.render();await drain();const v=h.render();assert.equal(v.history.length,1);assert.equal(v.history[0].questionIds[0],'old');assert.equal(h.writes.length,0);
});

test('late cloud restore cannot erase a Daily attempt created while restore was pending',async()=>{
 const h=dailyHarness();h.render();await drain();await h.render().startDaily('Group I');h.render();h.restore.resolve({daily:[],practice:[]});await drain();const v=h.render();assert.equal(v.history.length,1);assert.equal(v.history[0].officialSetId,h.official.officialSetId);
});

test('empty restore never claims that an unsubmitted Daily attempt has cloud acknowledgement',async()=>{
 const h=dailyHarness();h.render();await drain();await h.render().startDaily('Group I');h.render();h.restore.resolve({daily:[],practice:[]});await drain();assert.equal(h.render().syncStatus,'local');
});
test('restore of the same official set preserves its locally saved question snapshot',async()=>{
 const h=dailyHarness();h.render();await drain();const attempt=await h.render().startDaily('Group I');h.render();const {officialQuestions,...remote}=attempt;
 h.restore.resolve({daily:[{...remote,completedAt:Date.now(),total:10,score:0}],practice:[]});await drain();const v=h.render();assert.equal(v.history[0].officialQuestions.length,10);assert.equal(v.history[0].score,0);
});
