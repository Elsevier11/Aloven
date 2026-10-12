import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {migrateFixedStart} from './fixed-start.mjs';

test('la migrazione fixedStart conserva i dati ed è idempotente',()=>{
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE tasks(id TEXT PRIMARY KEY,title TEXT); INSERT INTO tasks VALUES ('T1','Esistente');`);
  assert.deepEqual(migrateFixedStart(db),{migrated:true});
  const preserved=db.prepare('SELECT id,title,fixedStart FROM tasks').get();
  assert.equal(preserved.id,'T1');assert.equal(preserved.title,'Esistente');assert.equal(preserved.fixedStart,null);
  db.prepare('UPDATE tasks SET fixedStart=? WHERE id=?').run('2026-11-02T10:00','T1');
  assert.deepEqual(migrateFixedStart(db),{migrated:false});
  assert.equal(db.prepare('SELECT fixedStart FROM tasks WHERE id=?').get('T1').fixedStart,'2026-11-02T10:00');
  db.close();
});

test('il piano a data fissa persiste, entra nello snapshot rilasciato e viene pulito dalle azioni sequenziali',async()=>{
  const data=mkdtempSync(path.join(tmpdir(),'aloven-fixed-start-'));
  let child,base,cookie='';
  async function start(){
    child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'0',DATA_DIR:data,BACKUP_DIR:path.join(data,'backups')},stdio:['ignore','pipe','pipe']});
    return new Promise((resolve,reject)=>{let output='',errors='';const timer=setTimeout(()=>reject(new Error(`Server non avviato: ${errors}`)),15000);child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});child.stderr.on('data',chunk=>errors+=chunk);child.on('exit',()=>{clearTimeout(timer);reject(new Error(`Server terminato: ${output}\n${errors}`));});});
  }
  async function stop(){const exited=once(child,'exit');child.kill();await exited;}
  async function request(endpoint,dataBody,expected=200){
    const response=await fetch(`${base}/api/${endpoint}`,{method:dataBody===undefined?'GET':'POST',headers:{...(dataBody===undefined?{}:{'Content-Type':'application/json','X-Aloven-Request':'1'}),...(cookie?{Cookie:cookie}:{})},body:dataBody===undefined?undefined:JSON.stringify(dataBody)});
    const json=await response.json();assert.equal(response.status,expected,JSON.stringify(json));
    if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
    return json;
  }
  async function change(action,expected=200){
    const state=await request('state');
    const preview=await request('preview',{revision:state.revision,action},expected);
    if(expected!==200)return preview;
    await request('commit',{token:preview.token});
    return request('state');
  }
  try{
    base=await start();
    await request('setup',{name:'Responsabile',username:'admin',password:'PasswordTest123!'});
    let state=await request('state');
    const task=state.tasks.find(item=>item.status==='unplanned');
    const fixedStart='2026-11-02T10:00';
    const metadataBefore=structuredClone({machines:state.machines,types:state.types,articles:state.articles,setupRules:state.setupRules,scrapReasons:state.scrapReasons,machineStopReasons:state.machineStopReasons,calendar:state.calendar});
    const preview=await request('preview',{revision:state.revision,action:{kind:'plan',id:task.id,fixedStart}});
    const stalePreview=await request('preview',{revision:state.revision,action:{kind:'plan',id:task.id,fixedStart}});
    assert.equal(preview.placement.id,task.id);assert.equal(preview.placement.fixedStart,fixedStart);
    assert.equal(preview.placement.start,fixedStart);assert.equal(preview.placement.machineId,task.machineId);
    assert.match(preview.placement.end,/^2026-11-/);
    const committed=await request('commit',{token:preview.token,includeState:'planning'});assert.ok(committed.planningState);
    await request('commit',{token:stalePreview.token,includeState:'planning'},409);
    state=await request('state');assert.equal(committed.planningState.revision,state.revision);assert.deepEqual(committed.planningState.planning,state.planning);
    for(const changed of committed.planningState.tasks)assert.deepEqual(changed,state.tasks.find(item=>item.id===changed.id));
    assert.ok(committed.planningState.tasks.some(item=>item.id===task.id));
    assert.deepEqual({machines:state.machines,types:state.types,articles:state.articles,setupRules:state.setupRules,scrapReasons:state.scrapReasons,machineStopReasons:state.machineStopReasons,calendar:state.calendar},metadataBefore);
    const audit=await request(`mes/audit?taskId=${encodeURIComponent(task.id)}`),planningAudit=audit.items.find(item=>item.action==='commit');
    assert.deepEqual(Object.keys(planningAudit.before),['tasks']);assert.deepEqual(Object.keys(planningAudit.after),['tasks']);
    let pinned=state.tasks.find(item=>item.id===task.id);
    assert.equal(pinned.fixedStart,fixedStart);
    assert.equal(pinned.start,fixedStart);
    const queueMate=state.tasks.find(item=>item.status==='unplanned'&&item.machineId===task.machineId&&item.id!==task.id);
    assert.ok(queueMate,'serve una seconda attività della macchina per verificare i conflitti');
    const beforeConflict=structuredClone(state);
    await change({kind:'plan',id:queueMate.id,fixedStart},400);
    state=await request('state');
    assert.equal(state.revision,beforeConflict.revision);
    assert.deepEqual(state.tasks,beforeConflict.tasks,'un pin occupato non deve modificare il piano');
    await change({kind:'plan',id:queueMate.id,fixedStart:'2026-11-01T10:00'},400);
    state=await request('state');
    assert.equal(state.revision,beforeConflict.revision,'un inizio fuori calendario non deve modificare il piano');

    await stop();base=await start();
    await request('login',{username:'admin',password:'PasswordTest123!'});
    state=await request('state');pinned=state.tasks.find(item=>item.id===task.id);
    assert.equal(pinned.fixedStart,fixedStart,'il pin deve sopravvivere al riavvio');

    state=await change({kind:'task',id:pinned.id,values:{...pinned,title:`${pinned.title} aggiornata`}});
    pinned=state.tasks.find(item=>item.id===task.id);
    assert.equal(pinned.fixedStart,fixedStart,'la modifica anagrafica conserva il pin');
    await request('planning/release',{revision:state.revision,reason:'Verifica pin rilasciato'});
    state=await request('state');pinned=state.tasks.find(item=>item.id===task.id);
    assert.equal(JSON.parse(pinned.releasedPayload).fixedStart,fixedStart);
    assert.equal(pinned.planningState,'released');

    state=await change({kind:'plan',id:task.id,unplan:true});
    assert.equal(state.tasks.find(item=>item.id===task.id).fixedStart,null);
    state=await change({kind:'plan',id:task.id});
    assert.equal(state.tasks.find(item=>item.id===task.id).fixedStart,null);
  }finally{
    if(child&&child.exitCode===null)await stop();
    rmSync(data,{recursive:true,force:true});
  }
});

test('spostare un task automatico conserva date e assenza di pin dei successori',async()=>{
  const data=mkdtempSync(path.join(tmpdir(),'aloven-fixed-move-'));
  let child,base,cookie='';
  async function start(){
    child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'0',DATA_DIR:data,BACKUP_DIR:path.join(data,'backups')},stdio:['ignore','pipe','pipe']});
    return new Promise((resolve,reject)=>{let output='',errors='';const timer=setTimeout(()=>reject(new Error(`Server non avviato: ${errors}`)),15000);child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});child.stderr.on('data',chunk=>errors+=chunk);child.on('exit',()=>{clearTimeout(timer);reject(new Error(`Server terminato: ${output}\n${errors}`));});});
  }
  async function stop(){const exited=once(child,'exit');child.kill();await exited;}
  async function request(endpoint,dataBody,expected=200){
    const response=await fetch(`${base}/api/${endpoint}`,{method:dataBody===undefined?'GET':'POST',headers:{...(dataBody===undefined?{}:{'Content-Type':'application/json','X-Aloven-Request':'1'}),...(cookie?{Cookie:cookie}:{})},body:dataBody===undefined?undefined:JSON.stringify(dataBody)});
    const json=await response.json();assert.equal(response.status,expected,JSON.stringify(json));
    if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
    return json;
  }
  async function change(action,expected=200){
    const state=await request('state');const preview=await request('preview',{revision:state.revision,action},expected);
    if(expected!==200)return preview;
    await request('commit',{token:preview.token});return request('state');
  }
  function businessDate(anchor,offsetDays,direction=1){
    const date=new Date(`${anchor.slice(0,10)}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+offsetDays);
    while([0,6].includes(date.getUTCDay()))date.setUTCDate(date.getUTCDate()+direction);
    return date.toISOString().slice(0,10);
  }
  try{
    base=await start();await request('setup',{name:'Responsabile',username:'admin',password:'PasswordTest123!'});
    let state=await request('state');
    const groups=Map.groupBy(state.tasks.filter(task=>task.status==='unplanned'),task=>task.machineId);
    const pair=[...groups.values()].find(tasks=>tasks.length>=2);assert.ok(pair,'servono due attività non pianificate sulla stessa macchina');
    const [first,second]=pair;
    state=await change({kind:'type',values:{name:'Fixed start A',color:'#123456'}});const typeA=state.types.find(type=>type.name==='Fixed start A');
    state=await change({kind:'type',values:{name:'Fixed start B',color:'#654321'}});const typeB=state.types.find(type=>type.name==='Fixed start B');
    state=await change({kind:'task',id:first.id,values:{...state.tasks.find(task=>task.id===first.id),typeId:typeA.id}});
    state=await change({kind:'task',id:second.id,values:{...state.tasks.find(task=>task.id===second.id),typeId:typeB.id}});
    const secondSetup=state.tasks.find(task=>task.id===second.id).setupMinutes;
    state=await change({kind:'setupRule',values:{machineId:first.machineId,fromTypeId:typeA.id,toTypeId:typeB.id,minutes:secondSetup+15}});
    const transitionRule=state.setupRules.find(rule=>rule.machineId===first.machineId&&rule.fromTypeId===typeA.id&&rule.toTypeId===typeB.id);
    state=await change({kind:'plan',id:first.id});state=await change({kind:'plan',id:second.id});
    let originalFirst=structuredClone(state.tasks.find(task=>task.id===first.id));
    let originalSecond=structuredClone(state.tasks.find(task=>task.id===second.id));
    assert.equal(originalFirst.fixedStart,null);assert.equal(originalSecond.fixedStart,null);

    const idleGap=Math.max(0,Date.parse(`${originalSecond.start}Z`)-Date.parse(`${originalFirst.end}Z`));
    const overlapping=new Date(Date.parse(`${originalFirst.start}Z`)+idleGap+15*60000).toISOString().slice(0,16);
    await change({kind:'plan',id:first.id,fixedStart:overlapping},400);
    state=await request('state');assert.equal(state.tasks.find(task=>task.id===second.id).start,originalSecond.start);

    const machine=state.machines.find(item=>item.id===first.machineId);
    const future=`${businessDate(machine.anchor,35,1)}T08:00`;
    const beforeTransitionConflict=structuredClone(state);
    await change({kind:'plan',id:first.id,fixedStart:future},400);
    state=await request('state');assert.deepEqual(state.tasks,beforeTransitionConflict.tasks,'il cambio di setup del successore deve rifiutare tutta la modifica');

    state=await change({kind:'setupRule',id:transitionRule.id,remove:true});
    const targetMachine=state.machines.find(item=>item.id!==first.machineId);
    const targetTask=state.tasks.find(task=>task.status==='unplanned'&&task.machineId===targetMachine.id);
    assert.ok(targetTask,'serve una coda destinazione per verificare entrambe le macchine');
    state=await change({kind:'plan',id:targetTask.id});
    const editableFirst=state.tasks.find(task=>task.id===first.id);
    state=await change({kind:'task',id:first.id,values:{...editableFirst,compatibleMachineIds:[first.machineId,targetMachine.id],preferredMachineId:first.machineId}});
    originalFirst=structuredClone(state.tasks.find(task=>task.id===first.id));
    originalSecond=structuredClone(state.tasks.find(task=>task.id===second.id));
    const originalTarget=structuredClone(state.tasks.find(task=>task.id===targetTask.id));
    const targetFuture=`${businessDate(targetMachine.anchor,35,1)}T08:00`;
    state=await change({kind:'plan',id:first.id,machineId:targetMachine.id,fixedStart:targetFuture});
    let moved=state.tasks.find(task=>task.id===first.id),successor=state.tasks.find(task=>task.id===second.id);
    assert.equal(moved.start,targetFuture);assert.equal(moved.fixedStart,targetFuture);assert.equal(moved.machineId,targetMachine.id);
    assert.equal(successor.start,originalSecond.start);assert.equal(successor.end,originalSecond.end);
    assert.deepEqual(successor.segments,originalSecond.segments);assert.equal(successor.fixedStart,null);
    assert.equal(state.tasks.find(task=>task.id===targetTask.id).start,originalTarget.start,'anche la coda destinazione resta ferma');

    await stop();base=await start();await request('login',{username:'admin',password:'PasswordTest123!'});
    state=await request('state');moved=state.tasks.find(task=>task.id===first.id);successor=state.tasks.find(task=>task.id===second.id);
    assert.equal(moved.fixedStart,targetFuture,'il nuovo pin deve persistere al riavvio');
    assert.equal(moved.machineId,targetMachine.id);
    assert.equal(successor.start,originalSecond.start);assert.equal(successor.fixedStart,null);

    const early=`${businessDate(machine.anchor,-1,-1)}T08:00`;
    state=await change({kind:'plan',id:first.id,machineId:first.machineId,fixedStart:early});
    moved=state.tasks.find(task=>task.id===first.id);successor=state.tasks.find(task=>task.id===second.id);
    assert.equal(moved.start,early,'il pin può precedere l’anchor in uno spazio libero');
    assert.equal(successor.start,originalSecond.start);assert.equal(successor.end,originalSecond.end);
    assert.equal(successor.fixedStart,null,'preservare l’inizio non deve creare altri pin');
    assert.equal(state.tasks.find(task=>task.id===targetTask.id).start,originalTarget.start);

    state=await change({kind:'task',id:first.id,values:{...moved,machineId:targetMachine.id,compatibleMachineIds:[machine.id,targetMachine.id],preferredMachineId:targetMachine.id}});
    moved=state.tasks.find(task=>task.id===first.id);
    assert.equal(moved.status,'unplanned');assert.equal(moved.position,null);assert.equal(moved.start,null);
    assert.equal(moved.fixedStart,null,'il cambio macchina che ritira l’attività deve eliminare il pin precedente');
  }finally{
    if(child&&child.exitCode===null)await stop();rmSync(data,{recursive:true,force:true});
  }
});
