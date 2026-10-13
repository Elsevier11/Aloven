import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {validateFinishDeclaration} from './quality.mjs';
import {releasedPayload} from './planning-release.mjs';

// Explicit, one-time data operation. Never run automatically at startup.
const dir=path.resolve(process.env.DATA_DIR||'data');
const db=new DatabaseSync(path.join(dir,'aloven.sqlite'));
const marker='demo-duration-20-percent-v1';
const originalTitles=new Set(['Rivestimento sedile automotive · lotto DEMO-240','Laminato outdoor traspirante · lotto DEMO-241','Tomaia mesh con film · lotto DEMO-118','Rivestimento arredo imbottito · lotto DEMO-086']);
const historical=t=>t.id.startsWith('sim10m-v1-task-')&&t.title.includes('DEMO-STORICO')&&t.notes.includes('DATI SIMULATI');
const demo=t=>historical(t)||(/^textile-demo-\d{3}$/.test(t.id)&&t.notes.includes('Dati dimostrativi'))||originalTitles.has(t.title);
const scale=x=>x==null?x:Math.round(x/5*1000)/1000;
function shortenSegments(value,runMinutes){
 const segments=typeof value==='string'?JSON.parse(value):value;
 let remaining=runMinutes;const result=[];
 for(const s of segments){
  if(s.kind==='setup'){result.push({...s});continue;}
  if(remaining<=0)break;
  const start=Date.parse(s.start+'Z'),duration=(Date.parse(s.end+'Z')-start)/60000;
  const used=Math.min(remaining,duration);
  result.push({...s,end:new Date(start+used*60000).toISOString().slice(0,16)});remaining-=used;
 }
 assert.equal(remaining,0,'Segmenti insufficienti');
 return {segments:JSON.stringify(result),end:result.at(-1).end};
}
function update(table,key,row){
 const fields=Object.keys(row).filter(f=>f!==key);
 db.prepare(`UPDATE ${table} SET ${fields.map(f=>`${f}=?`).join(',')} WHERE ${key}=?`).run(...fields.map(f=>row[f]),row[key]);
}
function group(rows,key){const m=new Map();for(const r of rows){if(!m.has(r[key]))m.set(r[key],[]);m.get(r[key]).push(r);}return m;}
db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000');
try{
 if(db.prepare('SELECT value FROM meta WHERE key=?').get(marker)){console.log(JSON.stringify({alreadyApplied:true}));}
 else{
  const backup=path.join(dir,'backups',`aloven-before-demo-reduction-${Date.now()}.sqlite`);
  mkdirSync(path.dirname(backup),{recursive:true});db.prepare('VACUUM INTO ?').run(backup);
  db.exec('BEGIN IMMEDIATE');
  try{
   const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name);
   const before=Object.fromEntries(tables.map(t=>[t,db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));
   const expected=structuredClone(before);
   const events=group(expected.executionEvents,'taskId'),lots=group(expected.executionLots,'taskId');
   const targets=new Map(expected.tasks.filter(demo).map(t=>[t.id,t]));
   assert.equal(targets.size,2396,'Dataset dimostrativo inatteso: riesaminare prima di modificare');
   let executions=0,removedEvents=0;
   for(const t of targets.values()){
    assert.notEqual(t.status,'in_progress','Attività avviata: interrompere la riduzione e riesaminare');
    assert.equal(t.calculationMode,'manual');
    t.runMinutes=Math.max(1,Math.round(t.runMinutes/5));t.quantity=scale(t.quantity);
    if(t.start)Object.assign(t,shortenSegments(t.segments,t.runMinutes));
    // A completed task is immutable for planning purposes, but its published
    // historical view must follow intentional data migrations. Never create a
    // snapshot for a draft or for work that was never released.
    if(t.status==='completed'&&t.releasedVersion!=null&&t.releasedPayload!=null)t.releasedPayload=JSON.stringify(releasedPayload(t));
    update('tasks','id',t);
   }
   const removedIds=new Set();
   for(const e of expected.execution){
    if(!historical(targets.get(e.taskId)||{id:'',title:'',notes:''}))continue;
    const taskEvents=events.get(e.taskId).sort((a,b)=>a.at.localeCompare(b.at));
    assert.ok(taskEvents.every(x=>x.id.startsWith('sim10m-v1-event-')&&x.userId.startsWith('sim10m-v1-worker-')),'Storico modificato da operatore');
    let remaining=e.runActiveSeconds/5,activeAt=null,finished=false;
    const finish=taskEvents.find(x=>x.action==='finish_run');
    for(const event of taskEvents){
     if(finished){if(event!==finish)removedIds.add(event.id);continue;}
     if(['start_run','resume_run'].includes(event.action))activeAt=Date.parse(event.at);
     if(['pause_run','finish_run'].includes(event.action)){
      assert.notEqual(activeAt,null);
      const duration=(Date.parse(event.at)-activeAt)/1000;
      if(remaining<=duration){
       finish.at=new Date(activeAt+remaining*1000).toISOString();finished=true;
       if(event!==finish)removedIds.add(event.id);
      }else{remaining-=duration;activeAt=null;}
     }
    }
    assert.ok(finished);
    e.runActiveSeconds=scale(e.runActiveSeconds);e.runEndedAt=finish.at;
    e.plannedRunMinutes=targets.get(e.taskId).runMinutes;
    for(const f of ['producedQuantity','scrapQuantity','plannedQuantity'])e[f]=scale(e[f]);
    for(const lot of lots.get(e.taskId)){
     assert.ok(lot.id.startsWith('sim10m-v1-lot-'));
     lot.quantity=scale(lot.quantity);lot.barcode=`${lot.articleCode}|${lot.lot}|${lot.quantity}`;
     update('executionLots','id',lot);
    }
    validateFinishDeclaration({...e,qualityChecks:JSON.parse(e.qualityChecks),lots:lots.get(e.taskId)},e);
    update('execution','taskId',e);update('executionEvents','id',finish);executions++;
    let active=null,total=0;
    for(const event of taskEvents.filter(x=>!removedIds.has(x.id)).sort((a,b)=>a.at.localeCompare(b.at))){
     if(['start_run','resume_run'].includes(event.action))active=Date.parse(event.at);
     if(['pause_run','finish_run'].includes(event.action)){assert.notEqual(active,null);total+=(Date.parse(event.at)-active)/1000;active=null;}
    }
    assert.equal(total,e.runActiveSeconds,'Secondi attivi incoerenti');
   }
   for(const id of removedIds)db.prepare('DELETE FROM executionEvents WHERE id=?').run(id);
   removedEvents=removedIds.size;expected.executionEvents=expected.executionEvents.filter(x=>!removedIds.has(x.id));
   // Every table must match the exact intended rows; this includes real declarations,
   // published payloads, pins, maintenance, audit, reasons and machine stops.
   for(const table of tables)assert.ok(JSON.stringify(db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())===JSON.stringify(expected[table]),`Differenze inattese: ${table}`);
   // Machine stops are independent machine records, not task durations: retain
   // them even when a shortened simulated execution now finishes before a stop.
   assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
   assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
   const report={updatedTasks:targets.size,historicalExecutions:executions,preservedOperatorExecutions:expected.execution.length-executions,scaledLots:expected.executionLots.filter(l=>l.id.startsWith('sim10m-v1-lot-')).length,removedObsoleteSimulatedEvents:removedEvents,setupUnchanged:true,startsAndPositionsUnchanged:true,completedSnapshotsAligned:true,draftsPublished:false,backup};
   db.prepare('INSERT INTO meta(key,value) VALUES (?,?)').run(marker,JSON.stringify(report));
   db.prepare("UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'").run();
   db.exec('COMMIT');writeFileSync(path.join(dir,'demo-reduction-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }catch(error){db.exec('ROLLBACK');throw error;}
 }
}finally{db.close();}
