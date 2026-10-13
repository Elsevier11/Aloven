import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {TEST_NOW} from './test-clock.mjs';
import {migrateSetupOverride} from './setup-override.mjs';

function harness(prefix){
  const data=mkdtempSync(path.join(tmpdir(),prefix));let child,base,cookie='';
  const api={data};
  api.start=(now=TEST_NOW)=>new Promise((resolve,reject)=>{child=spawn(process.execPath,['server.mjs'],{env:{...process.env,ALOVEN_NOW:now,PORT:'0',DATA_DIR:data,BACKUP_DIR:path.join(data,'backups')},stdio:['ignore','pipe','pipe']});let output='',errors='';const timer=setTimeout(()=>reject(new Error(errors||output||'Server non avviato')),15000);child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);base=match[0];resolve(base);}});child.stderr.on('data',chunk=>errors+=chunk);child.on('exit',()=>{clearTimeout(timer);reject(new Error(output+errors));});});
  api.stop=async()=>{if(child&&child.exitCode===null){const done=once(child,'exit');child.kill();await done;}};
  api.cleanup=async()=>{await api.stop();rmSync(data,{recursive:true,force:true});};
  api.request=async(endpoint,payload,expected=200)=>{const response=await fetch(`${base}/api/${endpoint}`,{method:payload===undefined?'GET':'POST',headers:{...(payload===undefined?{}:{'Content-Type':'application/json','X-Aloven-Request':'1'}),...(cookie?{Cookie:cookie}:{})},body:payload===undefined?undefined:JSON.stringify(payload)});const json=await response.json();assert.equal(response.status,expected,JSON.stringify(json));if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return json;};
  api.commit=async(action)=>{const state=await api.request('state');const preview=await api.request('preview',{revision:state.revision,action});const result=await api.request('commit',{token:preview.token,includeState:'planning'});return {preview,result,state:await api.request('state')};};
  api.reject=async(action,pattern,status=400)=>{const state=await api.request('state');const failure=await api.request('preview',{revision:state.revision,action},status);assert.match(failure.error,pattern);return failure;};
  return api;
}
const release=async(h,reason)=>h.request('planning/release',{revision:(await h.request('state')).revision,reason});
const byId=(state,id)=>state.tasks.find(task=>task.id===id);
const minutes=(a,b)=>(Date.parse(b+'Z')-Date.parse(a+'Z'))/60000;
const runTotal=task=>task.segments.filter(segment=>segment.kind==='run').reduce((sum,segment)=>sum+minutes(segment.start,segment.end),0);

test('migrazione dell’attrezzaggio manuale: idempotente e additiva',()=>{
  const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE tasks(id TEXT PRIMARY KEY)');
  assert.deepEqual(migrateSetupOverride(db),{migrated:true});assert.deepEqual(migrateSetupOverride(db),{migrated:false});
  assert.ok(db.prepare('PRAGMA table_info(tasks)').all().some(column=>column.name==='setupOverrideMinutes'));
  assert.throws(()=>migrateSetupOverride({}),TypeError);
});

test('attrezzaggio manuale: più corto, azzerato, più lungo, ripristino e protezioni',async()=>{
  const h=harness('aloven-setup-override-');
  try{
    await h.start();await h.request('setup',{name:'Admin',username:'admin',password:'PasswordTest123!'});
    let state=await h.request('state');const ids=state.tasks.filter(task=>task.machineId==='CNC-01').slice(0,3).map(task=>task.id);
    for(const id of ids)({state}=await h.commit({kind:'plan',id}));
    const [first,second,third]=ids;const baseline=structuredClone(state.tasks.filter(task=>ids.includes(task.id)));
    const theoretical=byId(state,second).effectiveSetupMinutes;assert.ok(theoretical>0,'la fixture deve avere un attrezzaggio teorico positivo');
    const thirdStart=byId(state,third).start;

    // zero: la coda anticipa, il valore di catalogo resta intatto
    let step=await h.commit({kind:'setupOverride',id:second,minutes:0,reason:'Stesso materiale della precedente'});
    assert.ok(step.preview.changes.some(change=>change.id===second&&change.setupMinutes===0&&change.oldSetupMinutes===theoretical));
    let task=byId(step.state,second);assert.equal(task.setupOverrideMinutes,0);assert.equal(task.effectiveSetupMinutes,0);assert.equal(task.setupMinutes,baseline[1].setupMinutes);
    assert.ok(byId(step.state,third).start<thirdStart,'una riduzione deve anticipare le attività successive');
    assert.equal(runTotal(task),baseline[1].runMinutes,'la lavorazione non cambia');

    // più lungo del teorico
    step=await h.commit({kind:'setupOverride',id:second,minutes:theoretical+60});task=byId(step.state,second);
    assert.equal(task.effectiveSetupMinutes,theoretical+60);assert.ok(byId(step.state,third).start>thirdStart,'un allungamento deve posticipare le successive');
    assert.equal(byId(step.state,first).start,baseline[0].start);assert.equal(byId(step.state,first).end,baseline[0].end);

    // ripristino del teorico
    step=await h.commit({kind:'setupOverride',id:second,minutes:null});task=byId(step.state,second);
    assert.equal(task.setupOverrideMinutes,null);assert.equal(task.effectiveSetupMinutes,theoretical);
    for(const before of baseline){const after=byId(step.state,before.id);assert.equal(after.start,before.start);assert.equal(after.end,before.end);}

    // valori non validi o impossibili sono atomici
    const revision=(await h.request('state')).revision;
    await h.reject({kind:'setupOverride',id:second,minutes:-1},/Attrezzaggio/);
    await h.reject({kind:'setupOverride',id:second,minutes:12.5},/Attrezzaggio/);
    await h.reject({kind:'setupOverride',id:second,minutes:'30'},/Attrezzaggio/);
    await h.reject({kind:'setupOverride',id:second,minutes:100000},/Attrezzaggio|impossibile/i);
    await h.reject({kind:'setupOverride',id:second,minutes:1200},/impossibile|turno/i);
    assert.equal((await h.request('state')).revision,revision);

    // attività non ancora pianificata: salvato e usato al posizionamento; cambio macchina lo azzera
    const free=state.tasks.find(candidate=>candidate.status==='unplanned'&&candidate.machineId==='CNC-01');
    assert.ok(free,'la fixture deve avere un’attività non pianificata su CNC-01');
    if(free){
      step=await h.commit({kind:'setupOverride',id:free.id,minutes:7});assert.equal(byId(step.state,free.id).setupOverrideMinutes,7);
      step=await h.commit({kind:'plan',id:free.id});assert.equal(byId(step.state,free.id).effectiveSetupMinutes,7);
      step=await h.commit({kind:'plan',id:free.id,unplan:true});assert.equal(byId(step.state,free.id).setupOverrideMinutes,null,'togliere dalla sequenza azzera la modifica manuale');
    }

    // un attrezzaggio avviato o concluso non si modifica più
    await release(h,'Rilascio per avvio');
    await h.commit({kind:'status',id:first,status:'in_progress'});
    await h.reject({kind:'setupOverride',id:first,minutes:5},/non può più essere modificato/);
  }finally{await h.cleanup();}
});

test('attrezzaggio manuale: persiste al riavvio, è rilasciato al reparto e nell’audit',async()=>{
  const h=harness('aloven-setup-release-');
  try{
    await h.start();await h.request('setup',{name:'Admin',username:'admin',password:'PasswordTest123!'});
    let state=await h.request('state');const ids=state.tasks.filter(task=>task.machineId==='CNC-01').slice(0,2).map(task=>task.id);
    for(const id of ids)({state}=await h.commit({kind:'plan',id}));
    ({state}=await h.commit({kind:'setupOverride',id:ids[1],minutes:45,reason:'Cambio colore complesso'}));
    await h.request('planning/release',{revision:state.revision,reason:'Rilascio con attrezzaggio manuale'});
    state=await h.request('state');assert.equal(byId(state,ids[1]).planningState,'released');
    ({state}=await h.commit({kind:'setupOverride',id:ids[1],minutes:50}));assert.equal(byId(state,ids[1]).planningState,'modified','una variazione dopo il rilascio rende il piano da rilasciare');
    ({state}=await h.commit({kind:'setupOverride',id:ids[1],minutes:45}));assert.equal(byId(state,ids[1]).planningState,'released');
    const audit=await h.request('mes/audit?entityId='+ids[1]);assert.ok(JSON.stringify(audit).includes('Cambio colore complesso'),'il motivo deve essere nel registro');
    await h.stop();await h.start();await h.request('login',{username:'admin',password:'PasswordTest123!'});
    state=await h.request('state');assert.equal(byId(state,ids[1]).setupOverrideMinutes,45);assert.equal(byId(state,ids[1]).effectiveSetupMinutes,45);
    const shop=await h.request('state?view=shopfloor');
    assert.equal(byId(shop,ids[1]).effectiveSetupMinutes,45,'il reparto vede il tempo rilasciato');
  }finally{await h.cleanup();}
});

test('riallinea sequenza: compatta, porta avanti dal passato e rispetta fissi e bloccate',async()=>{
  const h=harness('aloven-realign-');
  try{
    await h.start();await h.request('setup',{name:'Admin',username:'admin',password:'PasswordTest123!'});
    let state=await h.request('state');const ids=state.tasks.filter(task=>task.machineId==='CNC-01').slice(0,5).map(task=>task.id);
    for(const id of ids.slice(0,4))({state}=await h.commit({kind:'plan',id}));
    const [a,b,c,d,e]=ids;
    // c con inizio fissato lontano nel futuro, poi d dopo c
    const pinnedStart=addMinutes(byId(state,d).end,7*24*60);
    ({state}=await h.commit({kind:'plan',id:c,fixedStart:pinnedStart}));
    // b con inizio fissato vicino (diventerà passato)
    const nearStart=byId(state,b).start;({state}=await h.commit({kind:'plan',id:b,fixedStart:nearStart}));
    state=await h.request('state');
    const order=state.tasks.filter(task=>task.machineId==='CNC-01'&&task.position!=null).sort((x,y)=>x.position-y.position).map(task=>task.id);
    const before=structuredClone(state.tasks);const orderBefore=order.join();
    // a è l'unica bloccata (in corso)
    await release(h,'Rilascio per avvio');
    await h.commit({kind:'status',id:a,status:'in_progress'});
    state=await h.request('state');const aBefore=structuredClone(byId(state,a));

    // il tempo avanza oltre l'inizio previsto di b
    await h.stop();const later=addMinutes(byId(state,b).start,6*60);await h.start(addMinutes(later,-120)+':00Z');// ottobre: Roma = UTC+2
    await h.request('login',{username:'admin',password:'PasswordTest123!'});
    state=await h.request('state');
    const nowMinute=later;assert.ok(byId(state,b).start<nowMinute,'prima del riallineamento b ha un inizio nel passato');

    // da prima dell'ora corrente: rifiutato
    await h.reject({kind:'realign',machineId:'CNC-01',from:addMinutes(later,-60)},/non precedente all’ora corrente/);
    await h.reject({kind:'realign',machineId:'CNC-01',from:'2027-02-30T08:00'},/./);
    await h.reject({kind:'realign',machineId:'NOPE'},/Macchina non trovata/,404);

    const step=await h.commit({kind:'realign',machineId:'CNC-01'});
    assert.ok(step.preview.changes.length>0&&step.result.undo.label==='Riallineamento');
    state=step.state;
    const afterOrder=state.tasks.filter(task=>task.machineId==='CNC-01'&&task.position!=null).sort((x,y)=>x.position-y.position).map(task=>task.id).join();
    assert.equal(afterOrder,orderBefore,'la sequenza non cambia');
    assert.deepEqual(planningOf(byId(state,a)),planningOf(aBefore),'l’attività in corso non si tocca');
    for(const id of [b,d]){const t=byId(state,id);assert.ok(t.start>=nowMinute,`${id} deve partire da adesso o dopo (${t.start})`);}
    assert.equal(byId(state,b).fixedStart,null,'un inizio fissato ormai superato viene rimosso');
    assert.equal(byId(state,c).fixedStart,pinnedStart,'un inizio fissato futuro resta');
    assert.equal(byId(state,c).start,pinnedStart);
    for(const id of order){const t=byId(state,id),old=before.find(x=>x.id===id);assert.equal(runTotal(t),runTotal(old),'durate di lavorazione invariate');}
    const queue=state.tasks.filter(task=>task.machineId==='CNC-01'&&task.position!=null).sort((x,y)=>x.position-y.position);
    for(let i=1;i<queue.length;i++)assert.ok(queue[i].start>=queue[i-1].end||queue[i].segments[0].start>=queue[i-1].segments.at(-1).end,'nessuna sovrapposizione');

    // già allineata: nessuna variazione ulteriore
    const again=await h.request('preview',{revision:state.revision,action:{kind:'realign',machineId:'CNC-01'}});assert.equal(again.changes.length,0);

    // annulla: ripristina esattamente la pianificazione precedente
    const undone=await h.request('planning/undo',{token:step.result.undo.token,revision:step.result.undo.revision});assert.ok(undone.planningState);
    state=await h.request('state');assert.equal(byId(state,b).fixedStart,nearStart);assert.equal(byId(state,b).start,before.find(x=>x.id===b).start);

    // da data e ora scelta, nel futuro
    const chosen=addMinutes(later,3*24*60);
    ({state}=await h.commit({kind:'realign',machineId:'CNC-01',from:chosen}));
    assert.ok(byId(state,b).start>=chosen&&byId(state,d).start>=chosen);assert.deepEqual(planningOf(byId(state,a)),planningOf(aBefore));

    // niente da riallineare: solo attività bloccata
    const empty=state.tasks.find(task=>task.machineId==='TOR-02'&&task.position==null);
    if(empty)await h.reject({kind:'realign',machineId:'TOR-02'},/Non ci sono attività da riallineare/);
  }finally{await h.cleanup();}
});

// Planner dates are Rome wall-clock minutes ("YYYY-MM-DDTHH:mm"); shifting them as UTC keeps the arithmetic simple.
function addMinutes(local,amount){return new Date(Date.parse(local.slice(0,16)+':00Z')+amount*60000).toISOString().slice(0,16);}
function planningOf(task){return {start:task.start,end:task.end,position:task.position,status:task.status,segments:task.segments,effectiveSetupMinutes:task.effectiveSetupMinutes};}
