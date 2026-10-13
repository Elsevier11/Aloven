import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {migratePlanningRelease,releasedTasks,releasePlanning} from './planning-release.mjs';
import {TEST_NOW} from './test-clock.mjs';

test('la migrazione considera rilasciato il piano esistente ed è idempotente',()=>{
  const db=new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    INSERT INTO meta VALUES ('revision','7');
    CREATE TABLE tasks(id TEXT PRIMARY KEY,title TEXT,status TEXT,position INTEGER,machineId TEXT,start TEXT,end TEXT,segments TEXT,effectiveSetupMinutes INTEGER);
    INSERT INTO tasks VALUES ('P1','Pianificata','planned',0,'M1','2026-10-12T08:00','2026-10-12T10:00','[]',20);
    INSERT INTO tasks VALUES ('U1','Non pianificata','unplanned',NULL,'M1',NULL,NULL,'[]',NULL);
    CREATE TABLE execution(taskId TEXT PRIMARY KEY);
  `);
  const first=migratePlanningRelease(db,()=> 'migration-id','2026-10-11T12:00:00.000Z');
  assert.deepEqual(first,{migrated:true,released:1});
  assert.equal(db.prepare("SELECT value FROM meta WHERE key='revision'").get().value,'8');
  const tasks=db.prepare('SELECT * FROM tasks ORDER BY id').all();
  assert.equal(tasks.find(task=>task.id==='P1').releasedVersion,1);
  assert.equal(tasks.find(task=>task.id==='U1').releasedVersion,null);
  assert.equal(releasedTasks(tasks).find(task=>task.id==='P1').position,0);
  assert.equal(releasedTasks(tasks).find(task=>task.id==='U1').position,null);
  assert.deepEqual(migratePlanningRelease(db),{migrated:false});
  assert.equal(db.prepare("SELECT value FROM meta WHERE key='revision'").get().value,'8');
  db.prepare("UPDATE tasks SET status='completed',title='Pianificata ridotta' WHERE id='P1'").run();
  db.prepare("INSERT INTO tasks(id,title,status,position,machineId,start,end,segments,effectiveSetupMinutes) VALUES ('C1','Storica','completed',NULL,'M1',NULL,NULL,'[]',NULL)").run();
  db.prepare("INSERT INTO tasks(id,title,status,position,machineId,start,end,segments,effectiveSetupMinutes) VALUES ('N1','Nuova','planned',1,'M1','2026-10-12T10:00','2026-10-12T11:00','[]',10)").run();
  const released=releasePlanning(db,{revision:8,reason:'Nuovo piano'},{id:'A1',name:'Admin',role:'admin'},()=> 'release-id','2026-10-11T13:00:00.000Z');
  assert.equal(released.version,2,'lo storico completato senza snapshot non blocca nuovi rilasci');
  assert.equal(db.prepare("SELECT json_extract(releasedPayload,'$.title') title FROM tasks WHERE id='P1'").get().title,'Pianificata','il rilascio non riscrive implicitamente lo snapshot storico');
  assert.equal(db.prepare("SELECT releasedVersion FROM tasks WHERE id='C1'").get().releasedVersion,null);
  db.close();
});

test('la riparazione riallinea solo snapshot completati, crea un backup verificato ed è idempotente',()=>{
  const data=mkdtempSync(path.join(tmpdir(),'aloven-release-repair-'));
  const dbPath=path.join(data,'aloven.sqlite');
  const db=new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    INSERT INTO meta VALUES ('revision','12');
    CREATE TABLE tasks(id TEXT PRIMARY KEY,title TEXT,status TEXT,position INTEGER,machineId TEXT,start TEXT,end TEXT,segments TEXT,effectiveSetupMinutes INTEGER,releasedPayload TEXT,releasedVersion INTEGER);
    INSERT INTO tasks VALUES ('C1','Completata ridotta','completed',0,'M1','2026-09-01T08:00','2026-09-01T09:00','[]',10,'{"id":"C1","title":"Completata originale","status":"planned","position":0,"machineId":"M1","start":"2026-09-01T08:00","end":"2026-09-01T12:00","segments":[],"effectiveSetupMinutes":10}',1);
    INSERT INTO tasks VALUES ('D1','Bozza','planned',1,'M1','2026-10-13T08:00','2026-10-13T09:00','[]',10,NULL,NULL);
    INSERT INTO tasks VALUES ('U1','Mai pubblicata','completed',NULL,'M1',NULL,NULL,'[]',NULL,NULL,NULL);
  `);
  db.close();
  try{
    const env={...process.env,DATA_DIR:data,BACKUP_DIR:path.join(data,'backups')};
    const first=JSON.parse(execFileSync(process.execPath,['repair-release-snapshots.mjs'],{cwd:path.resolve('.'),env,encoding:'utf8'}));
    assert.equal(first.updatedSnapshots,1);
    assert.equal(first.backupVerified,true);
    let check=new DatabaseSync(dbPath);
    assert.equal(check.prepare("SELECT json_extract(releasedPayload,'$.title') title FROM tasks WHERE id='C1'").get().title,'Completata ridotta');
    assert.equal(check.prepare("SELECT releasedPayload FROM tasks WHERE id='D1'").get().releasedPayload,null,'la bozza non viene pubblicata');
    assert.equal(check.prepare("SELECT releasedPayload FROM tasks WHERE id='U1'").get().releasedPayload,null,'una completata mai pubblicata resta senza snapshot');
    assert.equal(check.prepare("SELECT value FROM meta WHERE key='revision'").get().value,'13');
    check.close();
    const backups=readdirSync(path.join(data,'backups'));
    assert.equal(backups.length,1);
    const second=JSON.parse(execFileSync(process.execPath,['repair-release-snapshots.mjs'],{cwd:path.resolve('.'),env,encoding:'utf8'}));
    assert.equal(second.updatedSnapshots,0);
    assert.equal(second.backup,null);
    assert.equal(readdirSync(path.join(data,'backups')).length,1,'la seconda esecuzione non crea backup inutili');
    check=new DatabaseSync(dbPath);assert.equal(check.prepare("SELECT value FROM meta WHERE key='revision'").get().value,'13');check.close();
  }finally{rmSync(data,{recursive:true,force:true});}
});

test('bozza, rilascio, avvio da snapshot e interruzione confermata sono concorrenti e atomici',async()=>{
  const data=mkdtempSync(path.join(tmpdir(),'aloven-release-'));
  let child,base,cookie='';
  async function start(){
    child=spawn(process.execPath,['server.mjs'],{env:{...process.env,ALOVEN_NOW:TEST_NOW,PORT:'0',DATA_DIR:data,BACKUP_DIR:path.join(data,'backups')},stdio:['ignore','pipe','pipe']});
    return new Promise((resolve,reject)=>{let output='',errors='';const timer=setTimeout(()=>reject(new Error(`Server non avviato: ${errors}`)),15000);child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});child.stderr.on('data',chunk=>errors+=chunk);child.on('exit',()=>{clearTimeout(timer);reject(new Error(`Server terminato: ${output}\n${errors}`));});});
  }
  async function request(endpoint,data,expected=200,session=cookie){
    const response=await fetch(`${base}/api/${endpoint}`,{method:data===undefined?'GET':'POST',headers:{...(data===undefined?{}:{'Content-Type':'application/json','X-Aloven-Request':'1'}),...(session?{Cookie:session}:{})},body:data===undefined?undefined:JSON.stringify(data)});
    const json=await response.json();assert.equal(response.status,expected,JSON.stringify(json));
    if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return json;
  }
  async function change(action){const state=await request('state');const preview=await request('preview',{revision:state.revision,action});await request('commit',{token:preview.token});return request('state');}
  async function release(reason='Piano di prova'){const state=await request('state');return request('planning/release',{revision:state.revision,reason});}
  async function stop(){const exited=once(child,'exit');child.kill();await exited;}
  try{
    base=await start();
    await request('setup',{name:'Responsabile',username:'admin',password:'PasswordTest123!'});const adminCookie=cookie;
    await request('users',{name:'Operatore',username:'operator',password:'PasswordTest123!',role:'operator'});
    let state=await request('state');
    let first=state.tasks.find(task=>task.status==='unplanned'&&task.setupMinutes>0);
    assert.ok(first);
    const queueMate=state.tasks.find(task=>task.status==='unplanned'&&task.id!==first.id&&task.machineId===first.machineId);
    assert.ok(queueMate);
    const otherMachine=state.machines.find(machine=>machine.id!==first.machineId),otherSpeed=otherMachine.speed*2;
    state=await change({kind:'machine',id:otherMachine.id,values:{...otherMachine,speed:otherSpeed}});
    state=await change({kind:'task',id:first.id,values:{...first,calculationMode:'automatic',quantity:100,compatibleMachineIds:[first.machineId,otherMachine.id],preferredMachineId:first.machineId}});
    state=await change({kind:'task',id:queueMate.id,values:{...queueMate,calculationMode:'manual',compatibleMachineIds:[queueMate.machineId,otherMachine.id],preferredMachineId:queueMate.machineId}});
    first=state.tasks.find(task=>task.id===first.id);
    state=await change({kind:'plan',id:first.id});state=await change({kind:'plan',id:queueMate.id});
    assert.equal(state.tasks.find(task=>task.id===first.id).planningState,'unreleased');
    const staleRevision=state.revision;
    await request('login',{username:'operator',password:'PasswordTest123!'});const operatorCookie=cookie;
    let operatorDraft=await request('state');
    assert.equal(operatorDraft.tasks.find(task=>task.id===first.id).position,state.tasks.find(task=>task.id===first.id).position,'anche l’operatore vede la bozza nell’area di pianificazione');
    assert.equal(operatorDraft.tasks.find(task=>task.id===first.id).planningState,'unreleased');
    await request('planning/release',{revision:operatorDraft.revision,reason:'Tentativo operatore'},403);
    let operatorState=await request('state?view=shopfloor');
    assert.equal(operatorState.tasks.find(task=>task.id===first.id).position,null,'il bordo macchina non vede la bozza prima del rilascio');
    await request('shopfloor/action',{revision:operatorState.revision,taskId:first.id,action:'start_setup'},409);
    cookie=adminCookie;
    const adminShopfloorBeforeRelease=await request('state?view=shopfloor');
    assert.equal(adminShopfloorBeforeRelease.tasks.find(task=>task.id===first.id).position,null,'anche l’amministratore vede solo il rilasciato sul bordo macchina');
    const releaseResult=await release();assert.equal(releaseResult.version,1);
    await request('planning/release',{revision:staleRevision,reason:'obsoleta'},409);
    state=await request('state');assert.equal(state.planning.hasDraftChanges,false);
    const released=state.tasks.find(task=>task.id===first.id);assert.equal(released.planningState,'released');

    // A later draft withdrawal does not alter the queue already published to the operator.
    state=await change({kind:'plan',id:first.id,unplan:true});
    assert.equal(state.tasks.find(task=>task.id===first.id).planningState,'pending_removal');
    cookie=operatorCookie;operatorDraft=await request('state');
    assert.equal(operatorDraft.tasks.find(task=>task.id===first.id).position,null,'l’operatore che pianifica vede il ritiro in bozza');
    operatorState=await request('state?view=shopfloor');
    assert.equal(operatorState.tasks.find(task=>task.id===first.id).position,released.position);
    assert.equal(operatorState.tasks.find(task=>task.id===first.id).status,'planned','il ritiro in bozza non ritira il piano già pubblicato');
    cookie=adminCookie;state=await change({kind:'plan',id:first.id,machineId:otherMachine.id,fixedStart:'2026-11-02T10:00'});
    const releaseBeforeStart=state.revision;
    assert.equal(state.tasks.find(task=>task.id===first.id).machineId,otherMachine.id);
    assert.equal(state.tasks.find(task=>task.id===first.id).fixedStart,'2026-11-02T10:00');
    assert.equal(state.tasks.find(task=>task.id===first.id).runMinutes,Math.ceil(100/otherSpeed),'il cambio macchina ricalcola solo le durate automatiche');
    cookie=operatorCookie;operatorDraft=await request('state');
    assert.equal(operatorDraft.tasks.find(task=>task.id===first.id).machineId,otherMachine.id,'la pianificazione operatore espone la macchina della bozza');
    assert.equal(operatorDraft.tasks.find(task=>task.id===first.id).fixedStart,'2026-11-02T10:00','la pianificazione operatore espone la data della bozza anche senza attività rilasciate quel giorno');
    assert.equal(operatorDraft.tasks.find(task=>task.id===first.id).planningState,'modified');
    operatorState=await request('state?view=shopfloor');
    assert.equal(operatorState.tasks.find(task=>task.id===first.id).machineId,released.machineId,'la nuova destinazione resta in bozza');
    assert.equal(operatorState.tasks.find(task=>task.id===first.id).fixedStart,null,'un pin di bozza non deve entrare nel piano rilasciato automatico');
    cookie=adminCookie;const adminShopfloor=await request('state?view=shopfloor');
    assert.equal(adminShopfloor.tasks.find(task=>task.id===first.id).machineId,released.machineId,'lo scope bordo macchina resta rilasciato anche per l’amministratore');
    assert.equal(adminShopfloor.tasks.find(task=>task.id===first.id).fixedStart,null);
    cookie=operatorCookie;
    await request('shopfloor/action',{revision:operatorState.revision,taskId:first.id,action:'start_setup'});
    cookie=adminCookie;state=await request('state');
    assert.equal(state.tasks.find(task=>task.id===first.id).status,'in_progress');
    assert.equal(state.tasks.find(task=>task.id===first.id).machineId,released.machineId,'all’avvio prevale la destinazione rilasciata');
    assert.equal(state.tasks.find(task=>task.id===first.id).fixedStart,null,'all’avvio deve essere adottato il pin nullo del piano rilasciato');
    await request('planning/release',{revision:releaseBeforeStart,reason:'Tentativo concorrente'},409);
    await request('planning/release',{revision:state.revision,reason:'Coda con posizione duplicata'},409);
    state=await change({kind:'plan',id:queueMate.id});
    assert.equal(state.planning.hasDraftChanges,false,'il riordino riallinea la bozza al piano operativo');
    const stopReason=state.machineStopReasons.find(reason=>reason.active);
    await request('machine-stop',{revision:state.revision,machineId:released.machineId,action:'stop',reasonId:stopReason.id});
    state=await request('state');
    assert.ok(state.executions.find(item=>item.taskId===first.id).setupPausedAt);
    const requested=await request('planning/interruption-request',{revision:state.revision,taskId:first.id,reason:'Cambio urgente di priorità'});
    cookie=operatorCookie;
    const rejected=await request('shopfloor/interruption',{revision:requested.revision,requestId:requested.request.id,action:'reject',reason:'Devo prima mettere in sicurezza la macchina'});
    assert.equal(rejected.request.status,'rejected');
    operatorState=await request('state?view=shopfloor');
    assert.equal(operatorState.executions.find(item=>item.taskId===first.id).phase,'setup_running','il rifiuto non chiude la preparazione');
    cookie=adminCookie;const requestedAgain=await request('planning/interruption-request',{revision:operatorState.revision,taskId:first.id,reason:'Macchina ora in sicurezza'});
    cookie=operatorCookie;
    const confirmed=await request('shopfloor/interruption',{revision:requestedAgain.revision,requestId:requestedAgain.request.id,action:'confirm'});
    assert.equal(confirmed.request.status,'confirmed');
    operatorState=await request('state?view=shopfloor');
    assert.equal(operatorState.tasks.find(task=>task.id===first.id).status,'cancelled');
    const interruptedSetup=operatorState.executions.find(item=>item.taskId===first.id);
    assert.equal(interruptedSetup.phase,'cancelled');
    assert.equal(interruptedSetup.producedQuantity,null);
    assert.ok(interruptedSetup.setupEndedAt);assert.equal(interruptedSetup.setupPausedAt,null);assert.ok(interruptedSetup.setupPausedSeconds>=0);assert.ok(interruptedSetup.setupActualSeconds>=0);
    cookie=adminCookie;state=await request('state');
    await request('preview',{revision:state.revision,action:{kind:'task',id:first.id,remove:true}},400);
    const manualMinutes=state.tasks.find(item=>item.id===queueMate.id).runMinutes;
    state=await change({kind:'plan',id:queueMate.id,machineId:otherMachine.id});
    assert.equal(state.tasks.find(item=>item.id===queueMate.id).runMinutes,manualMinutes,'il cambio macchina conserva la durata manuale');

    // A running interruption requires and stores the complete partial declaration.
    cookie=adminCookie;state=await request('state');
    const second=state.tasks.find(task=>task.status==='unplanned'&&task.id!==first.id&&![released.machineId,otherMachine.id].includes(task.machineId)&&task.setupMinutes===0) || state.tasks.find(task=>task.status==='unplanned'&&task.id!==first.id&&![released.machineId,otherMachine.id].includes(task.machineId));
    state=await change({kind:'plan',id:second.id});await release('Secondo rilascio');
    cookie=operatorCookie;operatorState=await request('state?view=shopfloor');
    if(second.setupMinutes>0){await request('shopfloor/action',{revision:operatorState.revision,taskId:second.id,action:'start_setup'});operatorState=await request('state?view=shopfloor');await request('shopfloor/action',{revision:operatorState.revision,taskId:second.id,action:'finish_setup'});}
    operatorState=await request('state?view=shopfloor');await request('shopfloor/action',{revision:operatorState.revision,taskId:second.id,action:'start_run'});
    cookie=adminCookie;state=await request('state');
    const interruption=await request('planning/interruption-request',{revision:state.revision,taskId:second.id,reason:'Ordine cliente annullato'});
    cookie=operatorCookie;
    await request('shopfloor/interruption',{revision:interruption.revision,requestId:interruption.request.id,action:'confirm'},400);
    operatorState=await request('state?view=shopfloor');
    const task=operatorState.tasks.find(item=>item.id===second.id);
    const declaration={revision:operatorState.revision,requestId:interruption.request.id,action:'confirm',goodQuantity:2,scrapQuantity:0,qualityStatus:'conforming',qualityNotes:'',plausibilityReason:'Chiusura parziale per annullamento ordine',qualityChecks:{appearance:'pass',bonding:'pass'},outputLot:'OUT-PARTIAL-1',lots:[{component:'component1',lot:'LOT-A',quantity:1},{component:'component2',lot:'LOT-B',quantity:1}]};
    await request('shopfloor/interruption',declaration);
    operatorState=await request('state?view=shopfloor');const execution=operatorState.executions.find(item=>item.taskId===task.id);
    assert.equal(execution.phase,'cancelled');assert.equal(execution.producedQuantity,2);assert.equal(execution.outputLot,'OUT-PARTIAL-1');assert.equal(execution.lots.length,2);assert.ok(execution.runEndedAt);
    // Il report usa il giorno aziendale Europe/Rome, anche vicino alla mezzanotte UTC.
    const closedDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(execution.runEndedAt)),report=await request(`statistics?from=${closedDate}&to=${closedDate}`);
    assert.equal(report.details.find(item=>item.taskId===task.id)?.closureStatus,'Interrotta','il consuntivo parziale entra nelle statistiche');
    cookie=adminCookie;state=await request('state');
    await request('mes/correction',{revision:state.revision,operationId:'correct-interrupted-1',taskId:task.id,reason:'Verifica quantità parziale',producedQuantity:3,scrapQuantity:0,scrapReasonId:null,qualityStatus:'conforming',qualityNotes:'',qualityChecks:{appearance:'pass',bonding:'pass'},outputLot:'OUT-PARTIAL-1',lots:execution.lots.map(lot=>({component:lot.component,lot:lot.lot,quantity:lot.quantity,barcode:lot.barcode}))});
    state=await request('state');assert.equal(state.executions.find(item=>item.taskId===task.id).producedQuantity,3);
    await request('mes/quality',{revision:state.revision,operationId:'quality-interrupted-1',taskId:task.id,disposition:'rework',reason:'Lotto parziale da rilavorare'});
    state=await request('state');assert.equal(state.executions.find(item=>item.taskId===task.id).qualityDisposition,'rework');
  }finally{if(child&&child.exitCode===null)await stop();rmSync(data,{recursive:true,force:true});}
});
