import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { migrateShopfloor } from './shopfloor.mjs';

test('shopfloor-v1 crea tabelle logiche senza FK ed è atomica, persistente e idempotente',()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'aloven-shopfloor-migration-'));
  const filename=path.join(directory,'migration.sqlite');
  let db=new DatabaseSync(filename);
  try {
    db.exec("CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL); INSERT INTO meta VALUES ('revision','7')");
    assert.deepEqual(migrateShopfloor(db),{migrated:true});
    assert.equal(db.prepare("SELECT value FROM meta WHERE key='revision'").get().value,'8');
    assert.equal(db.prepare("SELECT value FROM meta WHERE key='shopfloor-v1'").get().value,'1');
    for(const table of ['execution','executionEvents','executionLots']){
      assert.ok(db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table));
      assert.deepEqual(db.prepare(`PRAGMA foreign_key_list(${table})`).all(),[]);
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM executionEvents').get().count,0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM executionLots').get().count,0);
    assert.deepEqual(migrateShopfloor(db),{migrated:false});
    assert.equal(db.prepare("SELECT value FROM meta WHERE key='revision'").get().value,'8');
    db.close();db=new DatabaseSync(filename);
    assert.deepEqual(migrateShopfloor(db),{migrated:false});
    assert.deepEqual(db.prepare('SELECT * FROM execution').all(),[]);
  } finally {db.close();rmSync(directory,{recursive:true,force:true});}
});

test('reparto registra tempi reali, pause, dichiarazioni e snapshot senza alterare il piano',async()=>{
  const data=mkdtempSync(path.join(tmpdir(),'aloven-shopfloor-http-'));
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
  async function change(action){const state=await request('state');const preview=await request('preview',{revision:state.revision,action});await request('commit',{token:preview.token});return request('state');}
  async function shopfloor(taskId,action,values={},expected=200,revision){const state=revision===undefined?await request('state'):null;return request('shopfloor/action',{revision:revision??state.revision,taskId,action,...values},expected);}
  async function login(username){await request('login',{username,password:'PasswordTest123!'});return cookie;}
  async function stop(){if(child?.exitCode===null){const done=once(child,'exit');child.kill();await done;}}
  const delay=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
  try {
    base=await start();await request('setup',{name:'Amministratore',username:'admin',password:'PasswordTest123!'});const adminCookie=cookie;
    await request('users',{name:'Operatrice Reparto',username:'operator',password:'PasswordTest123!',role:'operator'});
    let state=await request('state');assert.deepEqual(state.executions,[]);
    const machine=state.machines[0], candidates=state.tasks.filter(task=>task.machineId===machine.id&&task.status==='unplanned').slice(0,2);
    assert.equal(candidates.length,2);
    const first=candidates[0], legacy=candidates[1];
    state=await change({kind:'task',values:{
      title:'Esecuzione setup zero',machineId:machine.id,typeId:first.typeId,setupMinutes:0,runMinutes:20,quantity:null,calculationMode:'manual',notes:'',
      component1ArticleId:first.component1ArticleId,component2ArticleId:first.component2ArticleId,productArticleId:first.productArticleId,
    }});
    const zero=state.tasks.find(task=>task.title==='Esecuzione setup zero');
    state=await change({kind:'plan',id:first.id});state=await change({kind:'plan',id:zero.id});
    const planned=state.tasks.find(task=>task.id===first.id), plannedDates={start:planned.start,end:planned.end};
    const stalePreview=await request('preview',{revision:state.revision,action:{kind:'type',values:{name:'Anteprima obsoleta',color:'#123456'}}});

    await login('operator');const operatorCookie=cookie;
    await shopfloor(zero.id,'start_setup',{},400);
    const beforeStart=await request('state'), staleRevision=beforeStart.revision, earliest=beforeStart.tasks.find(task=>task.id===first.id);
    await shopfloor(first.id,'start_setup',{at:'1900-01-01T00:00:00.000Z'},200,staleRevision);
    state=await request('state');let execution=state.executions.find(item=>item.taskId===first.id);
    assert.equal(state.tasks.find(task=>task.id===first.id).status,'in_progress');assert.equal(execution.phase,'setup_running');
    assert.notEqual(execution.setupStartedAt,'1900-01-01T00:00:00.000Z');assert.ok(Number.isFinite(Date.parse(execution.setupStartedAt)));
    assert.equal(execution.taskTitle,earliest.title);assert.equal(execution.productCode,earliest.productCode);
    await shopfloor(first.id,'start_setup',{},409,staleRevision);
    await shopfloor(first.id,'start_run',{},409);
    await request('preview',{revision:state.revision,action:{kind:'status',id:first.id,status:'completed'}},400);

    cookie=adminCookie;await request('commit',{token:stalePreview.token},409);
    state=await request('state');const component=state.articles.find(article=>article.id===first.component1ArticleId), oldCode=execution.component1Code;
    state=await change({kind:'article',id:component.id,values:{...component,code:`${component.code}-MOD`,description:`${component.description} modificata`}});
    execution=state.executions.find(item=>item.taskId===first.id);assert.equal(execution.component1Code,oldCode,'lo snapshot operativo resta invariato');
    await request('preview',{revision:state.revision,action:{kind:'article',id:component.id,values:{...component,unit:component.unit==='m'?'kg':'m'}}},400);

    cookie=operatorCookie;await shopfloor(first.id,'finish_setup');state=await request('state');execution=state.executions.find(item=>item.taskId===first.id);
    assert.equal(execution.phase,'setup_done');assert.ok(execution.setupEndedAt);assert.ok(execution.setupActualSeconds>=0);
    await shopfloor(first.id,'start_run');await delay(25);
    const beforeMissingReason=(await request('state')).revision;await shopfloor(first.id,'pause_run',{},400,beforeMissingReason);
    assert.equal((await request('state')).revision,beforeMissingReason,'una richiesta rifiutata non cambia revisione');
    await shopfloor(first.id,'pause_run',{reason:'Cambio bobina'});state=await request('state');execution=state.executions.find(item=>item.taskId===first.id);
    assert.equal(execution.phase,'run_paused');assert.ok(execution.runActualSeconds>0);const pausedSeconds=execution.runActualSeconds;
    await delay(25);execution=(await request('state')).executions.find(item=>item.taskId===first.id);assert.equal(execution.runActualSeconds,pausedSeconds,'la pausa non conta come tempo attivo');
    await shopfloor(first.id,'resume_run');await delay(25);
    const validLots=[
      {component:'component1',lot:'C1-A',quantity:1,barcode:`${execution.component1Code}|C1-A|1`,unit:'kg',articleCode:'MANOMESSO'},
      {component:'component1',lot:'C1-B',quantity:2,barcode:'c1-b'},
      {component:'component2',lot:'C2-A',quantity:3,barcode:`${execution.component2Code}|C2-A`,unit:'kg',articleCode:'MANOMESSO'},
    ];
    await shopfloor(first.id,'finish_run',{producedQuantity:2,lots:validLots.slice(0,2)},400);
    await shopfloor(first.id,'finish_run',{producedQuantity:2,lots:[validLots[0],{...validLots[0],lot:' c1-a '},validLots[2]]},400);
    await shopfloor(first.id,'finish_run',{producedQuantity:2,lots:[{...validLots[0],quantity:0},validLots[2]]},400);
    const beforeAtomicFailure=(await request('state')).revision;
    await shopfloor(first.id,'finish_run',{producedQuantity:12.5,scrapQuantity:0,qualityStatus:'conforming',qualityNotes:'',qualityChecks:{appearance:'pass',bonding:'pass'},lots:[{...validLots[0],barcode:'CODICE-ESTRANEO'},validLots[2]]},400,beforeAtomicFailure);
    const afterAtomicFailure=await request('state'), failedExecution=afterAtomicFailure.executions.find(item=>item.taskId===first.id);
    assert.equal(afterAtomicFailure.revision,beforeAtomicFailure,'una chiusura non valida viene annullata interamente');assert.equal(failedExecution.phase,'run_running');assert.deepEqual(failedExecution.lots,[]);
    await shopfloor(first.id,'finish_run',{producedQuantity:12.5,scrapQuantity:0,qualityStatus:'conforming',qualityNotes:'',qualityChecks:{appearance:'pass',bonding:'pass'},lots:validLots,at:'1900-01-01T00:00:00.000Z'});
    state=await request('state');execution=state.executions.find(item=>item.taskId===first.id);
    assert.equal(execution.phase,'completed');assert.equal(execution.producedQuantity,12.5);assert.equal(execution.lots.length,3);
    assert.deepEqual(execution.events.map(event=>event.action),['start_setup','finish_setup','start_run','pause_run','resume_run','finish_run']);
    assert.equal(execution.events[3].reason,'Cambio bobina');assert.ok(execution.events.every(event=>event.userName==='Operatrice Reparto'));
    assert.ok(execution.runActualSeconds>=pausedSeconds);assert.ok(execution.runEndedAt);assert.equal(execution.lastRunStartedAt,null);
    assert.deepEqual({start:state.tasks.find(task=>task.id===first.id).start,end:state.tasks.find(task=>task.id===first.id).end},plannedDates,'i tempi reali non ripianificano le date');
    for(const lot of execution.lots){const prefix=lot.component;assert.equal(lot.articleCode,execution[`${prefix}Code`]);assert.equal(lot.unit,execution[`${prefix}Unit`]);}
    assert.deepEqual(execution.lots.map(lot=>lot.barcode),validLots.map(lot=>lot.barcode));

    await shopfloor(zero.id,'start_run');await delay(10);await shopfloor(zero.id,'pause_run',{reason:'Fine turno'});
    state=await request('state');const zeroPaused=state.executions.find(item=>item.taskId===zero.id), zeroSeconds=zeroPaused.runActualSeconds;
    await shopfloor(zero.id,'finish_run',{producedQuantity:0,lots:[{component:'component1',lot:'Z1',quantity:1},{component:'component2',lot:'Z2',quantity:1}]},400);
    await delay(15);await shopfloor(zero.id,'finish_run',{producedQuantity:0,scrapQuantity:0,reason:'Prova senza produzione',qualityStatus:'conforming',qualityNotes:'',qualityChecks:{appearance:'pass',bonding:'pass'},lots:[{component:'component1',lot:'Z1',quantity:1},{component:'component2',lot:'Z2',quantity:1}]});
    const zeroDone=(await request('state')).executions.find(item=>item.taskId===zero.id);assert.equal(zeroDone.runActualSeconds,zeroSeconds,'chiudere da pausa non aggiunge tempo');assert.equal(zeroDone.setupStartedAt,null);assert.equal(zeroDone.setupEndedAt,null);

    cookie=adminCookie;state=await change({kind:'plan',id:legacy.id});state=await change({kind:'status',id:legacy.id,status:'in_progress'});
    assert.ok(!state.executions.some(item=>item.taskId===legacy.id),'gli stati storici non inventano tempi');
    cookie=operatorCookie;await shopfloor(legacy.id,'start_setup');state=await request('state');assert.equal(state.executions.find(item=>item.taskId===legacy.id).phase,'setup_running');

    const beforeRestart=structuredClone(state.executions);await stop();base=await start();state=await request('state');
    const withoutLiveSetup=items=>items.map(item=>({...item,setupActualSeconds:0,metrics:{...item.metrics,actualSetupSeconds:0}}));
    assert.deepEqual(withoutLiveSetup(state.executions),withoutLiveSetup(beforeRestart),'eventi, lotti e dichiarazioni persistono al riavvio');
  } finally {await stop();rmSync(data,{recursive:true,force:true});}
});
