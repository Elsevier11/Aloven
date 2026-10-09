import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { migrateDowntime } from './downtime.mjs';

test('downtime-v1 crea uno storico logico persistente e la migrazione è idempotente',()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'aloven-downtime-migration-'));
  const filename=path.join(directory,'migration.sqlite');
  let db=new DatabaseSync(filename);
  try {
    db.exec("CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL); INSERT INTO meta VALUES ('revision','11')");
    assert.deepEqual(migrateDowntime(db),{migrated:true});
    assert.equal(db.prepare("SELECT value FROM meta WHERE key='revision'").get().value,'12');
    assert.equal(db.prepare("SELECT value FROM meta WHERE key='downtime-v1'").get().value,'1');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_list(machineStops)').all(),[]);
    db.prepare('INSERT INTO machineStops VALUES (?,?,?,?,?,?,?,?,?)').run('s1','M1','2026-10-08T08:00:00.000Z',null,'Guasto','u1','Operatore',null,null);
    assert.throws(()=>db.prepare('INSERT INTO machineStops VALUES (?,?,?,?,?,?,?,?,?)').run('s2','M1','2026-10-08T09:00:00.000Z',null,'Altro','u1','Operatore',null,null));
    assert.deepEqual(migrateDowntime(db),{migrated:false});
    assert.equal(db.prepare("SELECT value FROM meta WHERE key='revision'").get().value,'12');
    db.close();db=new DatabaseSync(filename);
    assert.equal(db.prepare('SELECT reason FROM machineStops WHERE id=?').get('s1').reason,'Guasto');
  } finally {db.close();rmSync(directory,{recursive:true,force:true});}
});

test('API fermi macchina blocca gli avvii, sospende la lavorazione e conserva lo storico',async()=>{
  const data=mkdtempSync(path.join(tmpdir(),'aloven-downtime-http-'));
  let child,base,cookie='';
  async function start(){
    child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'0',DATA_DIR:data},stdio:['ignore','pipe','pipe']});
    return new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(new Error(`Server non avviato: ${output}`)),10000);child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});child.stderr.on('data',chunk=>{output+=chunk;});child.on('exit',()=>{clearTimeout(timer);reject(new Error(`Server terminato: ${output}`));});});
  }
  async function request(endpoint,data,expected=200){
    const response=await fetch(`${base}/api/${endpoint}`,{method:data?'POST':'GET',headers:{...(data?{'Content-Type':'application/json','X-Aloven-Request':'1'}:{}),...(cookie?{Cookie:cookie}:{})},body:data?JSON.stringify(data):undefined});
    const json=await response.json();assert.equal(response.status,expected,JSON.stringify(json));
    if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
    return json;
  }
  async function change(action,expected=200){const state=await request('state');const preview=await request('preview',{revision:state.revision,action},expected);if(expected!==200)return preview;await request('commit',{token:preview.token});return request('state');}
  async function shopfloor(taskId,action,expected=200){const state=await request('state');return request('shopfloor/action',{revision:state.revision,taskId,action},expected);}
  async function machineStop(machineId,action,reasonId,expected=200,forcedRevision){const state=forcedRevision===undefined?await request('state'):null;return request('machine-stop',{revision:forcedRevision??state.revision,machineId,action,...(reasonId===undefined?{}:{reasonId})},expected);}
  async function login(username){await request('login',{username,password:'PasswordTest123!'});return cookie;}
  async function stop(){if(child?.exitCode===null){const done=once(child,'exit');child.kill();await done;}}
  try {
    base=await start();
    await request('setup',{name:'Amministratore',username:'admin',password:'PasswordTest123!'});const adminCookie=cookie;
    await request('users',{name:'Operatore Fermi',username:'operator',password:'PasswordTest123!',role:'operator'});
    let state=await request('state');assert.deepEqual(state.machineStops,[]);
    const task=state.tasks.find(item=>item.status==='unplanned'&&item.setupMinutes>0), machineId=task.machineId;
    state=await change({kind:'plan',id:task.id});

    const breakdown=state.machineStopReasons.find(reason=>reason.code==='breakdown').id;
    const maintenance=state.machineStopReasons.find(reason=>reason.code==='maintenance').id;
    const materials=state.machineStopReasons.find(reason=>reason.code==='materials').id;
    cookie='';await request('machine-stop',{revision:state.revision,machineId,action:'stop',reasonId:breakdown},401);
    const operatorCookie=await login('operator');
    const beforeInvalid=(await request('state')).revision;
    await machineStop(machineId,'stop','',400,beforeInvalid);
    assert.equal((await request('state')).revision,beforeInvalid);
    await machineStop(machineId,'stop',breakdown);
    state=await request('state');
    assert.equal(state.machineStops.length,1);assert.equal(state.machineStops[0].endedAt,null);assert.equal(state.machineStops[0].userName,'Operatore Fermi');
    await shopfloor(task.id,'start_setup',409);
    await change({kind:'status',id:task.id,status:'in_progress'},400);
    await machineStop(machineId,'resume',undefined,409,state.revision-1);
    await machineStop(machineId,'resume');

    await shopfloor(task.id,'start_setup');
    const setupStop=await machineStop(machineId,'stop',breakdown,400);
    assert.match(setupStop.error,/Termina prima l.attrezzaggio.*non può essere interrotto/);
    await shopfloor(task.id,'finish_setup');
    await machineStop(machineId,'stop',materials);
    await shopfloor(task.id,'start_run',409);
    await machineStop(machineId,'resume');
    await shopfloor(task.id,'start_run');
    await new Promise(resolve=>setTimeout(resolve,20));

    await machineStop(machineId,'stop',maintenance);
    state=await request('state');
    let execution=state.executions.find(item=>item.taskId===task.id);
    assert.equal(execution.phase,'run_paused');assert.ok(execution.runActualSeconds>0);
    assert.deepEqual(execution.events.slice(-1).map(event=>[event.action,event.reason]),[['pause_run','Fermo macchina: Manutenzione']]);
    await machineStop(machineId,'resume');
    state=await request('state');execution=state.executions.find(item=>item.taskId===task.id);
    assert.equal(execution.phase,'run_paused','la ripresa macchina non riprende automaticamente la lavorazione');
    await shopfloor(task.id,'resume_run');

    assert.equal(state.machineStops.length,3);
    assert.ok(state.machineStops.every(item=>item.endedAt&&item.endedByUserName==='Operatore Fermi'));
    const maintenanceStop=state.machineStops.find(item=>item.reasonId===maintenance);
    assert.deepEqual({reason:maintenanceStop.reason,code:maintenanceStop.reasonCode},{reason:'Manutenzione',code:'maintenance'});
    cookie=adminCookie;let catalogState=await request('state');const maintenanceReason=catalogState.machineStopReasons.find(item=>item.id===maintenance);
    await request('machine-stop-reasons',{revision:catalogState.revision,id:maintenance,code:maintenanceReason.code,description:'Manutenzione modificata',descriptionEn:'Changed maintenance',active:false});
    catalogState=await request('state');
    assert.equal(catalogState.machineStops.find(item=>item.id===maintenanceStop.id).reason,'Manutenzione','lo storico del fermo resta uno snapshot');
    await request('machine-stop-reasons',{revision:catalogState.revision,id:maintenance,remove:true},400);
    state=catalogState;cookie=operatorCookie;
    const beforeRestart=structuredClone(state.machineStops);
    await stop();base=await start();state=await request('state');
    assert.deepEqual(state.machineStops,beforeRestart);
    cookie=adminCookie;
  } finally {await stop();rmSync(data,{recursive:true,force:true});}
});
