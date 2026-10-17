import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {TEST_NOW} from './test-clock.mjs';
import {forceTaskStatus,isForcedStatus} from './test-support.mjs';

// Pianificazione solo per sequenza: l'azione `plan` con `beforeId` decide la posizione e le date escono
// dalla compattazione; la manutenzione è un blocco del calendario della macchina attorno a cui la sequenza scorre.

const weekly={0:[],1:[['08:00','12:00'],['13:00','17:00']],2:[['08:00','12:00'],['13:00','17:00']],3:[['08:00','12:00'],['13:00','17:00']],4:[['08:00','12:00'],['13:00','17:00']],5:[['08:00','12:00'],['13:00','17:00']],6:[]};

function harness(prefix){
  const data=mkdtempSync(path.join(tmpdir(),prefix));let child,base,cookie='';
  const api={data};
  api.start=()=>new Promise((resolve,reject)=>{child=spawn(process.execPath,['server.mjs'],{env:{...process.env,ALOVEN_NOW:TEST_NOW,PORT:'0',DATA_DIR:data,BACKUP_DIR:path.join(data,'backups')},stdio:['ignore','pipe','pipe']});let output='',errors='';const timer=setTimeout(()=>reject(new Error(errors||output||'Server non avviato')),15000);child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);base=match[0];resolve(base);}});child.stderr.on('data',chunk=>errors+=chunk);child.on('exit',()=>{clearTimeout(timer);reject(new Error(output+errors));});});
  api.cleanup=async()=>{if(child&&child.exitCode===null){const done=once(child,'exit');child.kill();await done;}rmSync(data,{recursive:true,force:true});};
  api.request=async(endpoint,payload,expected=200)=>{const response=await fetch(`${base}/api/${endpoint}`,{method:payload===undefined?'GET':'POST',headers:{...(payload===undefined?{}:{'Content-Type':'application/json','X-Aloven-Request':'1'}),...(cookie?{Cookie:cookie}:{})},body:payload===undefined?undefined:JSON.stringify(payload)});const json=await response.json();assert.equal(response.status,expected,JSON.stringify(json));if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return json;};
  api.preview=async action=>api.request('preview',{revision:(await api.request('state')).revision,action});
  api.commit=async action=>{if(isForcedStatus(action)){forceTaskStatus(data,action.id,action.status);return {state:await api.request('state')};}const preview=await api.preview(action);await api.request('commit',{token:preview.token});return {preview,state:await api.request('state')};};
  api.reject=async(action,pattern)=>{const failure=await api.request('preview',{revision:(await api.request('state')).revision,action},400);assert.match(failure.error,pattern);};
  return api;
}
const byId=(state,id)=>state.tasks.find(task=>task.id===id);
const queue=(state,machineId)=>state.tasks.filter(task=>task.machineId===machineId&&task.position!==null).sort((a,b)=>a.position-b.position);
const order=(state,machineId)=>queue(state,machineId).map(task=>task.id);
const compact=task=>task.segments.map(segment=>`${segment.kind[0]} ${segment.start.slice(5)}→${segment.end.slice(segment.start.slice(0,10)===segment.end.slice(0,10)?11:5)}`);

/** Calendario lavorativo, nessuna regola di attrezzaggio, ancoraggio 12/10: durate leggibili e indipendenti dal catalogo demo. */
async function fixture(h,definitions){
  await h.start();await h.request('setup',{name:'Admin',username:'admin',password:'PasswordTest123!'});
  await h.commit({kind:'calendar',values:{weekly,exceptions:{},machineExceptions:{},maintenanceBlocks:[]}});
  let state=await h.request('state');
  for(const rule of state.setupRules)await h.commit({kind:'setupRule',id:rule.id,remove:true});
  const machine=state.machines.find(item=>item.id==='CNC-01')||state.machines[0],other=state.machines.find(item=>item.id!==machine.id);
  for(const item of [machine,other]){const current=(await h.request('state')).machines.find(value=>value.id===item.id);await h.commit({kind:'machine',id:item.id,values:{...current,anchor:'2026-10-12T08:00'}});}
  state=await h.request('state');
  const source=state.tasks.filter(task=>task.machineId===machine.id&&task.status==='unplanned');assert.ok(source.length>=definitions.length,'la fixture demo deve avere abbastanza attività');
  const tasks={};
  for(const [index,[key,setupMinutes,runMinutes]] of definitions.entries()){
    const current=(await h.request('state')).tasks.find(task=>task.id===source[index].id);
    await h.commit({kind:'task',id:current.id,values:{...current,setupMinutes,runMinutes,calculationMode:'manual',compatibleMachineIds:[machine.id,other.id],preferredMachineId:null}});
    tasks[key]=current.id;
  }
  return {machine:machine.id,other:other.id,tasks};
}

test('sequenza per posizione: inserimento, spostamento tra macchine, ritiro e vecchio pin ricompattano senza orari fissi',async()=>{
  const h=harness('aloven-sequence-');
  try{
    const {machine,other,tasks}=await fixture(h,[['a',0,60],['b',0,60],['c',0,60],['d',0,60]]);
    let state;
    for(const key of ['a','b','c'])({state}=await h.commit({kind:'plan',id:tasks[key],machineId:machine}));
    assert.deepEqual(['a','b','c'].map(key=>byId(state,tasks[key]).start),['2026-10-12T08:00','2026-10-12T09:00','2026-10-12T10:00']);

    // Inserire D prima di B sposta B e C, non A; nessun orario fisso.
    const insertion=await h.commit({kind:'plan',id:tasks.d,machineId:machine,beforeId:tasks.b});
    assert.deepEqual(order(insertion.state,machine),[tasks.a,tasks.d,tasks.b,tasks.c]);
    assert.deepEqual([tasks.a,tasks.d,tasks.b,tasks.c].map(id=>byId(insertion.state,id).start),['2026-10-12T08:00','2026-10-12T09:00','2026-10-12T10:00','2026-10-12T11:00']);
    assert.ok(queue(insertion.state,machine).every(task=>!task.fixedStart),'il rilascio per posizione non fissa orari');
    const moved=insertion.preview.changes.map(change=>change.id).sort();
    assert.deepEqual(moved,[tasks.b,tasks.c,tasks.d].sort(),'l’anteprima elenca le attività che cambiano data e non quelle ferme');

    // Spostare B su un'altra macchina compatta la macchina di partenza (C risale) e B parte dal primo spazio libero dell'altra.
    const transfer=await h.commit({kind:'plan',id:tasks.b,machineId:other,beforeId:''});
    assert.deepEqual(order(transfer.state,machine),[tasks.a,tasks.d,tasks.c]);
    assert.equal(byId(transfer.state,tasks.c).start,'2026-10-12T10:00');
    assert.deepEqual(order(transfer.state,other),[tasks.b]);assert.equal(byId(transfer.state,tasks.b).start,'2026-10-12T08:00');
    assert.ok(transfer.preview.changes.some(change=>change.id===tasks.c),'anche la macchina di partenza compare nell’anteprima');

    // Ritirare dal piano ricompatta.
    const unplanned=await h.commit({kind:'plan',id:tasks.d,unplan:true});
    assert.deepEqual(order(unplanned.state,machine),[tasks.a,tasks.c]);assert.equal(byId(unplanned.state,tasks.c).start,'2026-10-12T09:00');assert.equal(byId(unplanned.state,tasks.d).position,null);

    // Un vecchio inizio fissato (API ancora accettata) viene tolto riposizionando l'attività per sequenza.
    const pinned=await h.commit({kind:'plan',id:tasks.c,machineId:machine,fixedStart:'2026-10-12T13:00',shiftFollowing:true});
    assert.equal(byId(pinned.state,tasks.c).fixedStart,'2026-10-12T13:00');assert.equal(byId(pinned.state,tasks.c).start,'2026-10-12T13:00');
    const released=await h.commit({kind:'plan',id:tasks.c,machineId:machine,beforeId:''});
    assert.equal(byId(released.state,tasks.c).fixedStart,null);assert.equal(byId(released.state,tasks.c).start,'2026-10-12T09:00','senza pin la sequenza torna compatta');

    // Posizioni non valide sono rifiutate senza modifiche.
    await h.reject({kind:'plan',id:tasks.a,machineId:machine,beforeId:'inesistente'},/Posizione non più disponibile/);
    const third=(await h.request('state')).machines.find(item=>![machine,other].includes(item.id));assert.ok(third,'la fixture demo ha più di due macchine');
    await h.reject({kind:'plan',id:tasks.a,machineId:third.id,beforeId:''},/non è compatibile/);
    assert.deepEqual(order(await h.request('state'),machine),[tasks.a,tasks.c],'i rifiuti non modificano la bozza');
  }finally{await h.cleanup();}
});

test('manutenzione e sequenza: la sequenza scorre attorno al blocco, l’attrezzaggio non si spezza, la rimozione riporta indietro',async()=>{
  const h=harness('aloven-sequence-maintenance-');
  try{
    const {machine,tasks}=await fixture(h,[['a',60,360],['b',120,240],['c',30,120],['d',30,60]]);
    let state;
    for(const key of ['a','b','c'])({state}=await h.commit({kind:'plan',id:tasks[key],machineId:machine}));
    const before={a:structuredClone(byId(state,tasks.a)),b:structuredClone(byId(state,tasks.b)),c:structuredClone(byId(state,tasks.c))};
    assert.deepEqual(compact(before.b),['s 10-13T08:00→10:00','r 10-13T10:00→12:00','r 10-13T13:00→15:00'],'senza manutenzione B parte martedì mattina');

    // Manutenzione martedì 9:00-14:00: A, che finisce prima, non cambia; B e C scorrono dopo il blocco.
    const insertion=await h.commit({kind:'maintenance',machineId:machine,start:'2026-10-13T09:00',end:'2026-10-13T14:00',name:'Revisione'});
    assert.deepEqual(insertion.preview.changes.map(change=>change.id).sort(),[tasks.b,tasks.c].sort(),'solo le attività colpite compaiono nell’anteprima');
    state=insertion.state;
    assert.deepEqual(byId(state,tasks.a).segments,before.a.segments);
    assert.deepEqual(compact(byId(state,tasks.b)),['s 10-13T14:00→16:00','r 10-13T16:00→17:00','r 10-14T08:00→11:00'],'l’attrezzaggio da 2 ore non entra prima del blocco: aspetta la fine, senza spezzarsi');
    assert.deepEqual(compact(byId(state,tasks.c)),['s 10-14T11:00→11:30','r 10-14T11:30→12:00','r 10-14T13:00→14:30']);
    for(const task of queue(state,machine))for(const segment of task.segments)assert.ok(!(segment.start<'2026-10-13T14:00'&&segment.end>'2026-10-13T09:00'),`nessun segmento nel blocco: ${segment.start}→${segment.end}`);

    // Inserire D prima di B riempie lo spazio prima del blocco; B resta dopo il blocco.
    const inserted=await h.commit({kind:'plan',id:tasks.d,machineId:machine,beforeId:tasks.b});
    state=inserted.state;assert.deepEqual(order(state,machine),[tasks.a,tasks.d,tasks.b,tasks.c]);
    assert.deepEqual(compact(byId(state,tasks.d)),['s 10-12T16:00→16:30','r 10-12T16:30→17:00','r 10-13T08:00→08:30']);
    assert.equal(byId(state,tasks.b).start,'2026-10-13T14:00','B non anticipa: l’attrezzaggio non entra nei 30 minuti rimasti prima del blocco');
    assert.ok(queue(state,machine).every(task=>!task.fixedStart));

    // Spostare B prima di D lo porta nello spazio prima della manutenzione solo se l'attrezzaggio entra: qui non entra ancora, quindi parte dopo il blocco.
    const reordered=await h.commit({kind:'plan',id:tasks.b,machineId:machine,beforeId:tasks.d});
    assert.deepEqual(order(reordered.state,machine),[tasks.a,tasks.b,tasks.d,tasks.c]);
    assert.ok(byId(reordered.state,tasks.b).start>='2026-10-12T16:00');

    // Togliere la manutenzione riporta indietro le attività successive.
    const block=reordered.state.calendar.maintenanceBlocks[0];
    const removed=await h.commit({kind:'maintenance',id:block.id,remove:true});
    state=removed.state;assert.equal(state.calendar.maintenanceBlocks.length,0);
    assert.deepEqual(byId(state,tasks.a).segments,before.a.segments,'le attività prima del blocco non si muovono');
    const starts=queue(state,machine).map(task=>task.start);
    assert.deepEqual(starts,[...starts].sort(),'la sequenza resta ordinata');
    assert.ok(byId(state,tasks.c).end<byId(reordered.state,tasks.c).end,'C finisce prima: il blocco non c’è più');
  }finally{await h.cleanup();}
});

test('manutenzione e attività in corso: il blocco non può attraversare un’attività protetta',async()=>{
  const h=harness('aloven-sequence-locked-');
  try{
    const {machine,tasks}=await fixture(h,[['a',0,120],['b',0,60]]);
    let state;
    for(const key of ['a','b'])({state}=await h.commit({kind:'plan',id:tasks[key],machineId:machine}));
    const running=byId(state,tasks.a);assert.equal(running.start,'2026-10-12T08:00');
    await h.commit({kind:'status',id:tasks.a,status:'in_progress'});
    await h.reject({kind:'maintenance',machineId:machine,start:'2026-10-12T09:00',end:'2026-10-12T10:00',name:'Sulla lavorazione'},/Attività bloccata.*fuori calendario/);
    state=await h.request('state');assert.equal(state.calendar.maintenanceBlocks.length,0,'il rifiuto non lascia blocchi');
    assert.deepEqual(byId(state,tasks.a).segments,running.segments,'l’attività in corso non si sposta');
    // Dopo l'attività in corso la manutenzione è possibile e B scorre oltre il blocco; non si può inserire prima di A.
    const after=await h.commit({kind:'maintenance',machineId:machine,start:'2026-10-12T10:00',end:'2026-10-12T11:00',name:'Dopo la lavorazione'});
    assert.deepEqual(byId(after.state,tasks.a).segments,running.segments);
    assert.equal(byId(after.state,tasks.b).start,'2026-10-12T11:00');
    await h.reject({kind:'plan',id:tasks.b,machineId:machine,beforeId:tasks.a},/in corso o completate/);
  }finally{await h.cleanup();}
});
