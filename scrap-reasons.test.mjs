import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { migrateReasonCatalogs, reasonCatalog, updateReasonCatalog } from './scrap-reasons.mjs';

function baseDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    INSERT INTO meta VALUES ('revision','20');
    CREATE TABLE execution(taskId TEXT PRIMARY KEY,scrapReason TEXT);
    INSERT INTO execution VALUES ('legacy','Testo storico libero');
    CREATE TABLE machineStops(id TEXT PRIMARY KEY,reason TEXT NOT NULL);
    INSERT INTO machineStops VALUES ('legacy-stop','Fermo storico libero');
  `);
  return db;
}

test('migrazione cataloghi causali è atomica, idempotente e conserva gli storici legacy',()=>{
  const db=baseDb();
  try {
    assert.deepEqual(migrateReasonCatalogs(db),{migrated:true});
    assert.equal(reasonCatalog(db,'scrap').length,6);
    assert.equal(reasonCatalog(db,'machineStop').length,6);
    assert.ok(reasonCatalog(db,'scrap').every(reason=>reason.active&&reason.descriptionEn));
    assert.deepEqual({...db.prepare('SELECT scrapReason,scrapReasonId,scrapReasonCode FROM execution WHERE taskId=?').get('legacy')},{scrapReason:'Testo storico libero',scrapReasonId:null,scrapReasonCode:null});
    assert.deepEqual({...db.prepare('SELECT reason,reasonId,reasonCode FROM machineStops WHERE id=?').get('legacy-stop')},{reason:'Fermo storico libero',reasonId:null,reasonCode:null});
    assert.equal(db.prepare("SELECT value FROM meta WHERE key='revision'").get().value,'21');
    assert.deepEqual(migrateReasonCatalogs(db),{migrated:false});
    assert.equal(db.prepare("SELECT value FROM meta WHERE key='revision'").get().value,'21');
  } finally {db.close();}

  const broken=baseDb();
  try {
    broken.exec('CREATE TABLE scrapReasons(id TEXT PRIMARY KEY)');
    assert.throws(()=>migrateReasonCatalogs(broken));
    assert.equal(broken.prepare("SELECT value FROM meta WHERE key='revision'").get().value,'20');
    assert.equal(broken.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='machineStopReasons'").get(),undefined);
    assert.ok(!broken.prepare('PRAGMA table_info(execution)').all().some(column=>column.name==='scrapReasonId'));
  } finally {broken.close();}
});

test('CRUD causali applica revisione, unicità case-insensitive, fallback EN e protegge quelle usate',()=>{
  const db=baseDb();let nextId=0;
  try {
    migrateReasonCatalogs(db);
    let revision=21;
    assert.deepEqual(updateReasonCatalog(db,'scrap',{revision,code:'CUSTOM',description:'Personalizzata',descriptionEn:'',active:true},()=>`new-${++nextId}`),{ok:true});
    revision++;
    const created=reasonCatalog(db,'scrap').find(reason=>reason.code==='CUSTOM');
    assert.equal(created.descriptionEn,'Personalizzata');
    assert.throws(()=>updateReasonCatalog(db,'scrap',{revision:revision-1,id:created.id,code:'changed',description:'Cambio',active:true},()=>''),error=>error.status===409);
    assert.equal(reasonCatalog(db,'scrap').find(reason=>reason.id===created.id).code,'CUSTOM');
    assert.throws(()=>updateReasonCatalog(db,'scrap',{revision,code:'custom',description:'Duplicata',active:true},()=>''),/già una causale/);
    assert.equal(db.prepare("SELECT value FROM meta WHERE key='revision'").get().value,String(revision));
    updateReasonCatalog(db,'scrap',{revision,id:created.id,code:'CUSTOM',description:'Nuovo testo',descriptionEn:'New text',active:false},()=>false);
    revision++;
    assert.equal(reasonCatalog(db,'scrap').find(reason=>reason.id===created.id).active,false);
    updateReasonCatalog(db,'scrap',{revision,id:created.id,remove:true},()=>false);
    revision++;
    assert.ok(!reasonCatalog(db,'scrap').some(reason=>reason.id===created.id));

    const used=reasonCatalog(db,'scrap')[0];
    db.prepare('UPDATE execution SET scrapReasonId=?,scrapReasonCode=? WHERE taskId=?').run(used.id,used.code,'legacy');
    assert.throws(()=>updateReasonCatalog(db,'scrap',{revision,id:used.id,remove:true},()=>false),/Disattivala/);
    assert.ok(reasonCatalog(db,'scrap').some(reason=>reason.id===used.id));
  } finally {db.close();}
});

test('API cataloghi è riservata agli amministratori',async()=>{
  const data=mkdtempSync(path.join(tmpdir(),'aloven-reasons-http-'));
  let child,base,cookie='';
  const request=async(endpoint,payload,expected=200)=>{
    const response=await fetch(`${base}/api/${endpoint}`,{method:payload?'POST':'GET',headers:{...(payload?{'Content-Type':'application/json','X-Aloven-Request':'1'}:{}),...(cookie?{Cookie:cookie}:{})},body:payload?JSON.stringify(payload):undefined});
    const json=await response.json();assert.equal(response.status,expected,JSON.stringify(json));
    if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
    return json;
  };
  try {
    child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'0',DATA_DIR:data},stdio:['ignore','pipe','pipe']});
    base=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(new Error(output)),10000);child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});child.stderr.on('data',chunk=>output+=chunk);});
    await request('setup',{name:'Admin',username:'admin',password:'PasswordTest123!'});
    let state=await request('state');
    assert.equal(state.scrapReasons.length,6);assert.equal(state.machineStopReasons.length,6);
    await request('users',{name:'Operatore',username:'operator',password:'PasswordTest123!',role:'operator'});
    await request('login',{username:'operator',password:'PasswordTest123!'});
    state=await request('state');
    await request('scrap-reasons',{revision:state.revision,code:'x',description:'X',active:true},403);
    await request('machine-stop-reasons',{revision:state.revision,code:'x',description:'X',active:true},403);
  } finally {
    if(child?.exitCode===null){const done=once(child,'exit');child.kill();await done;}
    rmSync(data,{recursive:true,force:true});
  }
});
