import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { migrateProduction } from './production.mjs';

test('production-v1 migra il catalogo una sola volta e conserva gli snapshot storici',()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'aloven-production-migration-'));
  const db=new DatabaseSync(path.join(directory,'migration.sqlite'));
  try {
    db.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE machines(id TEXT PRIMARY KEY,name TEXT,description TEXT,anchor TEXT);
      CREATE TABLE types(id TEXT PRIMARY KEY,name TEXT,color TEXT);
      CREATE TABLE tasks(id TEXT PRIMARY KEY,title TEXT,typeId TEXT REFERENCES types(id),machineId TEXT REFERENCES machines(id),setupMinutes INTEGER,runMinutes INTEGER,status TEXT,position INTEGER,start TEXT,end TEXT,segments TEXT,notes TEXT,component1Code TEXT,component1Description TEXT,component2Code TEXT,component2Description TEXT,productCode TEXT,productDescription TEXT);
      INSERT INTO meta VALUES ('revision','7');
      INSERT INTO machines VALUES ('m','Macchina','','2026-10-08T08:00');
      INSERT INTO types VALUES ('a','A','#000000');
      INSERT INTO tasks VALUES ('new','Nuova','a','m',10,20,'unplanned',NULL,NULL,NULL,'[]','','DUP','Descrizione canonica','','','','');
      INSERT INTO tasks VALUES ('old','Storica','a','m',10,20,'completed',0,'2026-10-08T08:00','2026-10-08T08:30','[{"start":"2026-10-08T08:00","end":"2026-10-08T08:10","kind":"setup"},{"start":"2026-10-08T08:10","end":"2026-10-08T08:30","kind":"run"}]','','dup','Descrizione storica','','','','');`);
    assert.deepEqual(migrateProduction(db),{migrated:true});
    const revision=db.prepare("SELECT value FROM meta WHERE key='revision'").get().value;
    const [fresh,historical]=['new','old'].map(id=>db.prepare('SELECT * FROM tasks WHERE id=?').get(id));
    assert.equal(revision,'8');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM articles').get().n,1);
    assert.equal(fresh.component1ArticleId,historical.component1ArticleId);
    assert.equal(fresh.component1Description,'Descrizione canonica');
    assert.equal(historical.component1Description,'Descrizione storica');
    assert.equal(historical.effectiveSetupMinutes,10);
    assert.deepEqual(migrateProduction(db),{migrated:false});
    assert.equal(db.prepare("SELECT value FROM meta WHERE key='revision'").get().value,'8');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM setupRules').get().n,0);
  } finally {db.close();rmSync(directory,{recursive:true,force:true});}
});

test('catalogo, calcolo automatico, velocità e regole setup usano preview/commit',async()=>{
  const data=mkdtempSync(path.join(tmpdir(),'aloven-production-http-'));
  let child,base,cookie='';
  async function start(){
    child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'0',DATA_DIR:data},stdio:['ignore','pipe','pipe']});
    return new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(new Error(`Server non avviato: ${output}`)),10000);child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});child.stderr.on('data',chunk=>{output+=chunk;});child.on('exit',()=>{clearTimeout(timer);reject(new Error(`Server terminato: ${output}`));});});
  }
  async function request(endpoint,data,expected=200){const response=await fetch(`${base}/api/${endpoint}`,{method:data?'POST':'GET',headers:{...(data?{'Content-Type':'application/json','X-Aloven-Request':'1'}:{}),...(cookie?{Cookie:cookie}:{})},body:data?JSON.stringify(data):undefined});const json=await response.json();assert.equal(response.status,expected,JSON.stringify(json));if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return json;}
  async function preview(action,state){return request('preview',{revision:(state??await request('state')).revision,action});}
  async function change(action){const state=await request('state');const result=await preview(action,state);await request('commit',{token:result.token});return request('state');}
  async function stop(){if(child?.exitCode===null){const done=once(child,'exit');child.kill();await done;}}
  const taskValues=(title,machineId,typeId,componentId,productId,overrides={})=>({title,machineId,typeId,setupMinutes:20,runMinutes:30,quantity:null,calculationMode:'manual',notes:'',component1ArticleId:componentId,component2ArticleId:componentId,productArticleId:productId,...overrides});
  try {
    base=await start();await request('setup',{name:'Admin',username:'admin',password:'PasswordTest123!'});
    let state=await change({kind:'machine',values:{name:'Macchina produzione',description:'Test',anchor:'2026-10-08T08:00',speed:10,speedUnit:'m'}});
    const machine=state.machines.find(item=>item.name==='Macchina produzione');
    state=await change({kind:'article',values:{code:'COMP-1',description:'Componente',unit:'m',kind:'component'}});
    const component=state.articles.find(item=>item.code==='COMP-1');
    state=await change({kind:'article',values:{code:'PROD-1',description:'Prodotto',unit:'m',kind:'product'}});
    const product=state.articles.find(item=>item.code==='PROD-1');
    state=await change({kind:'article',values:{code:'PROD-KG',description:'Prodotto kg',unit:'kg',kind:'product'}});
    const productKg=state.articles.find(item=>item.code==='PROD-KG');
    const [typeA,typeB]=state.types.slice(0,2);

    await request('preview',{revision:state.revision,action:{kind:'task',values:taskValues('Quantità zero',machine.id,typeA.id,component.id,product.id,{calculationMode:'automatic',quantity:0})}},400);
    await request('preview',{revision:state.revision,action:{kind:'task',values:taskValues('Unità errata',machine.id,typeA.id,component.id,productKg.id,{calculationMode:'automatic',quantity:100})}},400);
    state=await change({kind:'task',values:taskValues('Automatica',machine.id,typeA.id,component.id,product.id,{calculationMode:'automatic',quantity:1000,runMinutes:999})});
    const automatic=state.tasks.find(item=>item.title==='Automatica');assert.equal(automatic.runMinutes,100);assert.equal(automatic.productCode,'PROD-1');
    await request('preview',{revision:state.revision,action:{kind:'article',id:product.id,remove:true}},400);

    const speedPreview=await preview({kind:'machine',id:machine.id,values:{...machine,speed:20}},state);
    const speedChange=speedPreview.changes.find(item=>item.id===automatic.id);assert.equal(speedChange.oldRunMinutes,100);assert.equal(speedChange.runMinutes,50);
    state=await change({kind:'article',values:{code:'UNRELATED',description:'Concorrenza',unit:'m',kind:'component'}});
    await request('commit',{token:speedPreview.token},409);
    state=await change({kind:'machine',id:machine.id,values:{...machine,speed:20}});assert.equal(state.tasks.find(item=>item.id===automatic.id).runMinutes,50);

    state=await change({kind:'task',values:taskValues('Prima',machine.id,typeA.id,component.id,product.id,{setupMinutes:10})});const first=state.tasks.find(item=>item.title==='Prima');
    state=await change({kind:'task',values:taskValues('Seconda',machine.id,typeB.id,component.id,product.id,{setupMinutes:20})});const second=state.tasks.find(item=>item.title==='Seconda');
    state=await change({kind:'plan',id:first.id});state=await change({kind:'plan',id:second.id});assert.equal(state.tasks.find(item=>item.id===second.id).effectiveSetupMinutes,20);
    const rulePreview=await preview({kind:'setupRule',values:{machineId:machine.id,fromTypeId:typeA.id,toTypeId:typeB.id,minutes:5}},state);
    assert.equal(rulePreview.changes.find(item=>item.id===second.id).setupMinutes,5);
    await request('commit',{token:rulePreview.token});state=await request('state');const rule=state.setupRules.find(item=>item.machineId===machine.id);
    const reorderPreview=await preview({kind:'plan',id:second.id,beforeId:first.id},state);assert.equal(reorderPreview.changes.find(item=>item.id===second.id).setupMinutes,20);await request('commit',{token:reorderPreview.token});
    state=await change({kind:'plan',id:first.id,beforeId:second.id});assert.equal(state.tasks.find(item=>item.id===second.id).effectiveSetupMinutes,5);
    state=await change({kind:'status',id:first.id,status:'in_progress'});state=await change({kind:'status',id:first.id,status:'completed'});state=await change({kind:'status',id:second.id,status:'in_progress'});
    const frozen=structuredClone(state.tasks.find(item=>item.id===second.id));state=await change({kind:'setupRule',id:rule.id,values:{...rule,minutes:8}});assert.deepEqual(state.tasks.find(item=>item.id===second.id),frozen);

    state=await change({kind:'article',id:product.id,values:{...product,code:'PROD-NEW',description:'Prodotto aggiornato'}});
    assert.equal(state.tasks.find(item=>item.id===second.id).productCode,'PROD-1','snapshot bloccato');
    assert.equal(state.tasks.find(item=>item.id===automatic.id).productCode,'PROD-NEW','snapshot modificabile');
  } finally {await stop();rmSync(data,{recursive:true,force:true});}
});
