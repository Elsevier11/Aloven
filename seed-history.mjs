import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes, scryptSync } from 'node:crypto';
import { scheduleTask } from './scheduler.mjs';
import { validateFinishDeclaration, executionMetrics } from './quality.mjs';

// Additive, deterministic demo history. Never updates existing operational rows.
const dir = process.env.DATA_DIR || path.resolve('data');
const db = new DatabaseSync(path.join(dir, 'aloven.sqlite'));
db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000');
const prefix = 'sim10m-v1';
const marker = `${prefix}-loaded`;
const from = '2025-12-01', until = '2026-10-01';
const reportPath = path.join(dir, 'history-demo-report.json');
const tables = ['tasks','execution','executionEvents','executionLots','machineStops','machines','types','articles','setupRules','users','sessions','scrapReasons','machineStopReasons'];
const before = Object.fromEntries(tables.map(t => [t, db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));
const calendar = JSON.parse(db.prepare('SELECT value FROM meta WHERE key=?').get('calendar').value);
const machines = before.machines;
const scraps = before.scrapReasons.filter(x => x.active);
const stops = before.machineStopReasons.filter(x => x.active);
if (!scraps.length || !stops.length) throw new Error('Servono causali attive per scarti e fermi.');
const articles = new Map(before.articles.map(x => [x.id,x]));
const templates = before.tasks.filter(x => !x.id.startsWith(prefix) && ['component1','component2','product'].every(role => articles.has(x[`${role}ArticleId`])));
if (machines.some(m => !templates.some(t => t.machineId === m.id))) throw new Error('Mancano lavorazioni modello per una macchina.');
let randomState = 20261009;
function random() { randomState = (Math.imul(randomState,1664525)+1013904223) >>> 0; return randomState / 4294967296; }
function integer(a,b) { return a + Math.floor(random() * (b-a+1)); }
function minutes(a,b) { return (Date.parse(`${b}Z`)-Date.parse(`${a}Z`))/60000; }
function add(iso,n) { return new Date(Date.parse(`${iso}Z`)+n*60000).toISOString().slice(0,16); }
const rome = new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
function timestamp(local) {
  const target = Date.parse(`${local}Z`); let guess = target;
  for(let i=0;i<3;i++) { const p=Object.fromEntries(rome.formatToParts(new Date(guess)).map(x=>[x.type,x.value])); const represented=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`); guess += target-represented; }
  return new Date(guess).toISOString();
}
const inserts = new Map();
function insert(table,value) {
  const fields=Object.keys(value),key=table+fields.join(',');
  if(!inserts.has(key)) inserts.set(key,db.prepare(`INSERT INTO ${table} (${fields.join(',')}) VALUES (${fields.map(()=>'?').join(',')})`));
  inserts.get(key).run(...Object.values(value));
}
function summary() {
  return {
    simulated:true, dataset:prefix, from, through:'2026-09-30',
    monthly:db.prepare(`SELECT substr(t.start,1,7) month,count(*) activities,round(sum(e.producedQuantity),2) goodQuantity,round(sum(e.scrapQuantity),2) scrapQuantity,round(sum(e.runActiveSeconds)/3600,2) runHours FROM tasks t JOIN execution e ON e.taskId=t.id WHERE t.id LIKE ? GROUP BY month ORDER BY month`).all(`${prefix}%`),
    counts:Object.fromEntries(['tasks','execution','executionEvents','executionLots','machineStops'].map(t=>[t,Number(db.prepare(`SELECT count(*) n FROM ${t} WHERE ${t==='execution'?'taskId':'id'} LIKE ?`).get(`${prefix}%`).n)])),
    units:[...new Set(templates.map(t=>articles.get(t.productArticleId).unit))],
  };
}
if(db.prepare('SELECT 1 FROM meta WHERE key=?').get(marker)) {
  console.log(JSON.stringify({alreadyLoaded:true,...summary()},null,2)); db.close();
} else {
  mkdirSync(path.join(dir,'backups'),{recursive:true});
  const backup=path.join(dir,'backups',`aloven-before-history-${Date.now()}.sqlite`);
  db.prepare('VACUUM INTO ?').run(backup);
  const counts = {tasks:0,execution:0,executionEvents:0,executionLots:0,machineStops:0};
  db.exec('BEGIN IMMEDIATE');
  try {
    for(let n=1;n<=3;n++) {
      const salt=randomBytes(16).toString('hex');
      insert('users',{id:`${prefix}-worker-${n}`,name:`Operatore DEMO ${n}`,username:`${prefix}-worker-${n}`,password:`${salt}:${scryptSync(randomBytes(32).toString('hex'),salt,64).toString('hex')}`,role:'operator'});
    }
    let seq=0,eventSeq=0,lotSeq=0,stopSeq=0;
    for(const [machineIndex,machine] of machines.entries()) {
      const pool=templates.filter(t=>t.machineId===machine.id);
      const cal={weekly:calendar.weekly,exceptions:{...calendar.exceptions,...(calendar.machineExceptions?.[machine.id]||{})}};
      let cursor=`${from}T00:00`;
      let position=-100000+machineIndex*10000;
      const existing=before.tasks.filter(t=>t.machineId===machine.id && t.start && t.end);
      for(let day=from;day<until;day=add(`${day}T00:00`,1440).slice(0,10)) {
        if(cursor.slice(0,10)>day) continue;
        const weekday=new Date(`${day}T12:00Z`).getUTCDay();
        const shifts=cal.exceptions[day]??cal.weekly[weekday]??[];
        if(!shifts.length) continue;
        cursor=cursor>`${day}T${shifts[0][0]}`?cursor:`${day}T${shifts[0][0]}`;
        const jobs=integer(2,4),month=Number(day.slice(5,7));
        // Lower summer load, with varied products and process-specific losses.
        if(month===8 && random()<0.38) continue;
        for(let j=0;j<jobs;j++) {
          const model=pool[integer(0,pool.length-1)],id=`${prefix}-task-${++seq}`;
          const setup=integer(12,35),run=seq%47===0?integer(350,460):integer(65,145);
          const planned=scheduleTask({setupMinutes:setup,runMinutes:run},cursor,cal);
          if(planned.start.slice(0,10)!==day || planned.end.slice(0,10)>=until) break;
          const setupActual=Math.max(5,Math.round(setup*(0.8+random()*0.5)));
          const runActual=Math.max(20,Math.round(run*(0.85+random()*0.35+(machineIndex===2?0.06:0))));
          const stopDuration=random()<0.17?integer(8,28):0;
          const actual=scheduleTask({setupMinutes:setupActual,runMinutes:runActual+stopDuration},cursor,cal);
          if(actual.end.slice(0,10)>=until) break;
          const end=actual.end>planned.end?actual.end:planned.end;
          if(existing.some(t=>t.start<end&&t.end>planned.start)) { cursor=end; continue; }
          const product=articles.get(model.productArticleId);
          const quantity=Math.round(run*machine.speed*(0.8+random()*0.35));
          const loss=random()<0.12?0:Math.round(quantity*(0.004+random()*0.032+(machineIndex===2?0.006:0)));
          const good=Math.max(0,quantity-loss-integer(0,Math.max(1,Math.round(quantity*0.015))));
          const scrap=loss?scraps[integer(0,scraps.length-1)]:null;
          const qc=random()<0.045?'nonconforming':random()<0.06?'review':'conforming';
          const title=`${model.productDescription} · DEMO-STORICO ${day.replaceAll('-','')}-${seq}`;
          const task={...model,id,title,setupMinutes:setup,runMinutes:run,status:'completed',position:position++,start:planned.start,end:planned.end,segments:JSON.stringify(planned.segments),notes:'DATI SIMULATI per analisi e statistiche. Nessun ordine ERP o movimento di magazzino reale.',quantity,calculationMode:'manual',effectiveSetupMinutes:setup};
          insert('tasks',task); counts.tasks++;
          const setupSegment=actual.segments.find(x=>x.kind==='setup'),runs=actual.segments.filter(x=>x.kind==='run');
          const execution={taskId:id,phase:'completed',setupStartedAt:timestamp(setupSegment.start),setupEndedAt:timestamp(setupSegment.end),runStartedAt:timestamp(runs[0].start),runEndedAt:timestamp(actual.end),runActiveSeconds:runActual*60,lastRunStartedAt:null,producedQuantity:good,taskTitle:title,machineId:machine.id,productCode:model.productCode,productDescription:model.productDescription,productUnit:product.unit,scrapQuantity:loss,scrapReason:scrap?.description??null,scrapReasonId:scrap?.id??null,scrapReasonCode:scrap?.code??null,qualityStatus:qc,qualityNotes:qc==='conforming'?null:'SIMULAZIONE: controllo adesione da verificare.',qualityChecks:JSON.stringify({appearance:'pass',bonding:qc==='nonconforming'?'fail':qc==='review'?'na':'pass'}),plannedSetupMinutes:setup,plannedRunMinutes:run,plannedQuantity:quantity};
          for(const role of ['component1','component2']) { const article=articles.get(model[`${role}ArticleId`]); for(const suffix of ['Code','Description']) execution[role+suffix]=model[role+suffix]; execution[role+'Unit']=article.unit; }
          const worker={id:`${prefix}-worker-${(seq%3)+1}`,name:`Operatore DEMO ${(seq%3)+1}`};
          const events=[];
          function event(action,local,reason=null) { events.push({id:`${prefix}-event-${++eventSeq}`,taskId:id,action,at:timestamp(local),userId:worker.id,userName:worker.name,reason}); }
          event('start_setup',setupSegment.start); event('finish_setup',setupSegment.end); event('start_run',runs[0].start);
          let stopped=false;
          for(let k=0;k<runs.length;k++) {
            const segment=runs[k];
            if(stopDuration&&!stopped&&minutes(segment.start,segment.end)>=stopDuration+12) {
              const start=add(segment.start,5),finish=add(start,stopDuration),reason=stops[integer(0,stops.length-1)];
              event('pause_run',start,`Fermo macchina: ${reason.description}`); event('resume_run',finish);
              insert('machineStops',{id:`${prefix}-stop-${++stopSeq}`,machineId:machine.id,startedAt:timestamp(start),endedAt:timestamp(finish),reason:reason.description,reasonId:reason.id,reasonCode:reason.code,userId:worker.id,userName:worker.name,endedByUserId:worker.id,endedByUserName:worker.name}); counts.machineStops++; stopped=true;
            }
            if(k<runs.length-1) { event('pause_run',segment.end,'SIMULAZIONE: fine fascia lavorativa'); event('resume_run',runs[k+1].start); }
          }
          if(stopDuration&&!stopped) throw new Error('Fermo senza intervallo disponibile');
          event('finish_run',actual.end);
          let activeAt=null,activeSeconds=0;
          for(const e of events.sort((a,b)=>a.at.localeCompare(b.at))) {
            if(['start_run','resume_run'].includes(e.action)) activeAt=Date.parse(e.at);
            if(['pause_run','finish_run'].includes(e.action)) { if(activeAt===null) throw new Error('Sequenza eventi non valida'); activeSeconds+=(Date.parse(e.at)-activeAt)/1000; activeAt=null; }
          }
          if(activeSeconds!==execution.runActiveSeconds) throw new Error('Eventi e tempo attivo non corrispondono');
          const lots=[];
          for(const role of ['component1','component2']) {
            const unit=execution[role+'Unit'];
            // Demo conversion coefficients only; no real BOM consumption is inferred.
            const total=Math.round((good+loss)*(unit===product.unit?1:unit==='kg'?0.18:unit==='m2'?1.5:1)*1.015*100)/100;
            const portions=random()<0.3?[Math.round(total*0.55*100)/100]:[];
            portions.push(Math.round((total-(portions[0]||0))*100)/100);
            for(const [n,q] of portions.entries()) { const lot=`DEMO-${role}-${day.slice(0,7).replace('-','')}-${seq}-${n+1}`,code=execution[role+'Code']; lots.push({component:role,lot,quantity:q,barcode:`${code}|${lot}|${q}`}); insert('executionLots',{id:`${prefix}-lot-${++lotSeq}`,taskId:id,component:role,articleCode:code,lot,quantity:q,unit,barcode:`${code}|${lot}|${q}`}); counts.executionLots++; }
          }
          validateFinishDeclaration({producedQuantity:good,scrapQuantity:loss,scrapReasonId:scrap?.id??null,qualityStatus:qc,qualityNotes:execution.qualityNotes,qualityChecks:JSON.parse(execution.qualityChecks),lots},execution);
          if(executionMetrics(execution).actualRunSeconds!==runActual*60) throw new Error('Consuntivo incoerente');
          insert('execution',execution); counts.execution++;
          for(const e of events.sort((a,b)=>a.at.localeCompare(b.at))) { insert('executionEvents',e); counts.executionEvents++; }
          cursor=end;
        }
      }
    }
    for(const t of tables) {
      const current=new Map(db.prepare(`SELECT * FROM ${t}`).all().map(x=>[x.id??x.taskId??x.token,x]));
      for(const row of before[t]) if(JSON.stringify(current.get(row.id??row.taskId??row.token))!==JSON.stringify(row)) throw new Error(`Dati preesistenti alterati: ${t}`);
    }
    if(db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Relazioni non valide');
    const result=summary();
    if(result.monthly.length!==10||result.monthly.some(x=>x.activities<20)) throw new Error('Copertura mensile insufficiente');
    db.prepare('INSERT INTO meta(key,value) VALUES (?,?)').run(marker,JSON.stringify({from,until,counts,simulated:true}));
    db.prepare("UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'").run();
    db.exec('COMMIT');
    writeFileSync(reportPath,JSON.stringify({...result,backup},null,2));
    console.log(JSON.stringify({...result,backup,reportPath},null,2));
  } catch(error) { db.exec('ROLLBACK'); throw error; }
  finally { db.close(); }
}
