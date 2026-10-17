import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {TEST_NOW} from './test-clock.mjs';
import {machineLiveStatus} from './live-status.mjs';

test('stato vivo: macchine, attività in corso e fermi dal solo database',()=>{
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE execution(taskId TEXT PRIMARY KEY,phase TEXT,setupStartedAt TEXT,setupEndedAt TEXT,runStartedAt TEXT,runEndedAt TEXT,runActiveSeconds REAL DEFAULT 0,lastRunStartedAt TEXT,producedQuantity REAL,setupPausedAt TEXT,setupPausedSeconds REAL DEFAULT 0,interruptedAt TEXT,plannedSetupMinutes REAL,plannedRunMinutes REAL,plannedQuantity REAL,scrapQuantity REAL);
    CREATE TABLE machineStops(id TEXT PRIMARY KEY,machineId TEXT,startedAt TEXT,endedAt TEXT,reason TEXT);`);
  const add=(taskId,phase,extra={})=>{const row={taskId,phase,runActiveSeconds:0,setupPausedSeconds:0,...extra},keys=Object.keys(row);db.prepare(`INSERT INTO execution(${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...keys.map(key=>row[key]));};
  const now='2026-10-07T10:00:00.000Z',machines=['A','B','C','D','E','F'].map(id=>({id}));
  const task=(id,machineId,status='in_progress',extra={})=>({id,machineId,status,setupMinutes:30,runMinutes:120,effectiveSetupMinutes:20,end:'2026-10-07T14:00',...extra});
  const tasks=[task('ta','A'),task('tb','B'),task('tc','C'),task('td','D'),task('te','E'),task('tf','F','completed'),task('tg','C','planned')];
  add('ta','setup_running',{setupStartedAt:'2026-10-07T09:30:00.000Z',plannedSetupMinutes:25,plannedRunMinutes:90});
  add('tb','setup_running',{setupStartedAt:'2026-10-07T09:00:00.000Z',setupPausedAt:'2026-10-07T09:20:00.000Z'});
  add('tc','run_running',{setupStartedAt:'2026-10-07T08:00:00.000Z',setupEndedAt:'2026-10-07T08:20:00.000Z',runStartedAt:'2026-10-07T08:30:00.000Z',lastRunStartedAt:'2026-10-07T09:00:00.000Z',runActiveSeconds:600});
  add('td','run_paused',{runStartedAt:'2026-10-07T08:30:00.000Z',runActiveSeconds:1800});
  add('te','setup_done',{setupStartedAt:'2026-10-07T08:00:00.000Z',setupEndedAt:'2026-10-07T08:40:00.000Z'});
  add('tf','completed');
  db.prepare("INSERT INTO machineStops VALUES ('s1','D','2026-10-07T09:50:00.000Z',NULL,'Guasto motore'),('s2','A','2026-10-06T09:00:00.000Z','2026-10-06T10:00:00.000Z','Chiuso')").run();
  const live=Object.fromEntries(machineLiveStatus(db,{machines,tasks,now}).map(item=>[item.machineId,item]));
  assert.equal(live.A.state,'setup');assert.equal(live.A.taskId,'ta');assert.equal(live.A.phaseSince,'2026-10-07T09:30:00.000Z');assert.equal(live.A.plannedSetupMinutes,25,'prevale il previsto congelato all\'avvio');assert.equal(live.A.plannedRunMinutes,90);assert.equal(live.A.setupActualSeconds,1800);assert.equal(live.A.stop,null,'un fermo chiuso non conta');
  assert.equal(live.B.state,'setup_paused');
  assert.equal(live.C.state,'run');assert.equal(live.C.runActualSeconds,600+3600);assert.equal(live.C.plannedSetupMinutes,20,'senza snapshot usa l\'attrezzaggio effettivo');assert.equal(live.C.plannedEnd,'2026-10-07T14:00');
  assert.equal(live.D.state,'stopped','il fermo aperto prevale');assert.equal(live.D.phase,'run_paused');assert.deepEqual(live.D.stop,{reason:'Guasto motore',startedAt:'2026-10-07T09:50:00.000Z'});
  assert.equal(live.E.state,'setup_done');assert.equal(live.E.phaseSince,'2026-10-07T08:40:00.000Z');
  assert.equal(live.F.state,'idle','una completata non è in corso');assert.equal(live.F.taskId,null);
  assert.throws(()=>machineLiveStatus({},{machines,tasks}),TypeError);
  db.prepare("UPDATE execution SET interruptedAt='2026-10-07T09:59:00.000Z' WHERE taskId='tc'").run();
  assert.equal(machineLiveStatus(db,{machines,tasks,now}).find(item=>item.machineId==='C').phase,null,'un\'esecuzione interrotta dal reparto non conta');
});

test('stato vivo via HTTP: la vista pianificazione espone fasi, fermo e orologio del server',async()=>{
  const data=mkdtempSync(path.join(tmpdir(),'aloven-live-'));let child,base,cookie='';
  const start=()=>new Promise((resolve,reject)=>{child=spawn(process.execPath,['server.mjs'],{env:{...process.env,ALOVEN_NOW:TEST_NOW,PORT:'0',DATA_DIR:data,BACKUP_DIR:path.join(data,'backups')},stdio:['ignore','pipe','pipe']});let output='',errors='';const timer=setTimeout(()=>reject(new Error(errors||output||'Server non avviato')),15000);child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});child.stderr.on('data',chunk=>errors+=chunk);child.on('exit',()=>{clearTimeout(timer);reject(new Error(output+errors));});});
  async function request(endpoint,payload,expected=200){const response=await fetch(`${base}/api/${endpoint}`,{method:payload===undefined?'GET':'POST',headers:{...(payload===undefined?{}:{'Content-Type':'application/json','X-Aloven-Request':'1'}),...(cookie?{Cookie:cookie}:{})},body:payload===undefined?undefined:JSON.stringify(payload)});const json=await response.json();assert.equal(response.status,expected,JSON.stringify(json));if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return json;}
  const live=async id=>{const state=await request('state?view=planning');assert.equal(state.serverNow,new Date(TEST_NOW).toISOString());assert.equal(state.liveMachines.length,state.machines.length);return state.liveMachines.find(item=>item.machineId===id);};
  const floor=async(taskId,action,extra={})=>request('shopfloor/action',{revision:(await request('state')).revision,taskId,action,...extra});
  try{
    base=await start();await request('setup',{name:'Admin',username:'admin',password:'PasswordTest123!'});
    let state=await request('state');const task=state.tasks.find(item=>item.machineId==='CNC-01'&&item.status==='unplanned');
    const plan=await request('preview',{revision:state.revision,action:{kind:'plan',id:task.id}});const committed=await request('commit',{token:plan.token,includeState:'planning'});
    assert.ok(Array.isArray(committed.planningState.liveMachines)&&committed.planningState.serverNow,'anche la risposta del salvataggio porta lo stato vivo');
    state=await request('state');await request('planning/release',{revision:state.revision,reason:'Rilascio per la prova'});
    assert.equal((await live('CNC-01')).state,'idle');
    await floor(task.id,'start_setup');let item=await live('CNC-01');assert.equal(item.state,'setup');assert.equal(item.taskId,task.id);assert.ok(item.phaseSince);assert.equal(item.plannedEnd,(await request('state')).tasks.find(x=>x.id===task.id).end);
    await floor(task.id,'finish_setup');assert.equal((await live('CNC-01')).state,'setup_done');
    await floor(task.id,'start_run');assert.equal((await live('CNC-01')).state,'run');
    await floor(task.id,'pause_run',{reason:'Cambio rotolo'});assert.equal((await live('CNC-01')).state,'paused');
    await floor(task.id,'resume_run');assert.equal((await live('CNC-01')).state,'run');
    state=await request('state');const reason=state.machineStopReasons.find(item=>item.active);
    await request('machine-stop',{action:'stop',machineId:'CNC-01',reasonId:reason.id,revision:state.revision});
    item=await live('CNC-01');assert.equal(item.state,'stopped');assert.ok(item.stop.reason&&item.stop.startedAt);assert.equal(item.phase,'run_paused','il fermo macchina sospende la lavorazione attiva');
    for(const other of (await request('state?view=planning')).liveMachines.filter(x=>x.machineId!=='CNC-01'))assert.equal(other.state,'idle');
    await request('machine-stop',{action:'resume',machineId:'CNC-01',revision:(await request('state')).revision});assert.equal((await live('CNC-01')).stop,null);
  }finally{if(child&&child.exitCode===null){const done=once(child,'exit');child.kill();await done;}rmSync(data,{recursive:true,force:true});}
});

test('stato vivo: ultimo operatore che ha registrato un evento sull\'attività',()=>{
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE execution(taskId TEXT PRIMARY KEY,phase TEXT,setupStartedAt TEXT,setupEndedAt TEXT,runStartedAt TEXT,runEndedAt TEXT,runActiveSeconds REAL DEFAULT 0,lastRunStartedAt TEXT,producedQuantity REAL,setupPausedAt TEXT,setupPausedSeconds REAL DEFAULT 0,interruptedAt TEXT,plannedSetupMinutes REAL,plannedRunMinutes REAL);
    CREATE TABLE machineStops(id TEXT PRIMARY KEY,machineId TEXT,startedAt TEXT,endedAt TEXT,reason TEXT);
    CREATE TABLE executionEvents(id TEXT PRIMARY KEY,taskId TEXT,action TEXT,at TEXT,userName TEXT);`);
  db.prepare("INSERT INTO execution(taskId,phase,runActiveSeconds) VALUES ('ta','run_running',0)").run();
  db.prepare("INSERT INTO executionEvents VALUES ('e1','ta','start_setup','2026-10-07T08:00:00Z','Anna Bianchi'),('e2','ta','start_run','2026-10-07T09:00:00Z','Mario Rossi')").run();
  const tasks=[{id:'ta',machineId:'A',status:'in_progress',setupMinutes:30,runMinutes:60},{id:'tb',machineId:'B',status:'planned',setupMinutes:30,runMinutes:60}];
  const live=Object.fromEntries(machineLiveStatus(db,{machines:[{id:'A'},{id:'B'}],tasks,now:'2026-10-07T10:00:00.000Z'}).map(item=>[item.machineId,item]));
  assert.equal(live.A.operatorName,'Mario Rossi');
  assert.equal(live.B.operatorName,null);
});

test('stato vivo: senza la colonna userName negli eventi l\'operatore è assente, non un errore',()=>{
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE execution(taskId TEXT PRIMARY KEY,phase TEXT,setupStartedAt TEXT,setupEndedAt TEXT,runActiveSeconds REAL DEFAULT 0,lastRunStartedAt TEXT,setupPausedAt TEXT,setupPausedSeconds REAL DEFAULT 0,interruptedAt TEXT,plannedSetupMinutes REAL,plannedRunMinutes REAL);
    CREATE TABLE machineStops(id TEXT PRIMARY KEY,machineId TEXT,startedAt TEXT,endedAt TEXT,reason TEXT);
    CREATE TABLE executionEvents(id TEXT PRIMARY KEY,taskId TEXT,action TEXT,at TEXT);`);
  db.prepare("INSERT INTO execution(taskId,phase) VALUES ('ta','run_running')").run();
  const live=machineLiveStatus(db,{machines:[{id:'A'}],tasks:[{id:'ta',machineId:'A',status:'in_progress',setupMinutes:0,runMinutes:60}],now:'2026-10-07T10:00:00.000Z'});
  assert.equal(live[0].operatorName,null);
});
