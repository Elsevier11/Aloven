import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { buildStatisticsReport, buildStatisticsWorkbook } from './statistics.mjs';

function fixture() {
  const db=new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE machines(id TEXT PRIMARY KEY,name TEXT NOT NULL);
    INSERT INTO machines VALUES ('M1','Accoppiatrice 1'),('M2','Accoppiatrice 2');
    CREATE TABLE execution(
      taskId TEXT PRIMARY KEY,phase TEXT,setupStartedAt TEXT,setupEndedAt TEXT,setupPausedSeconds REAL,
      runEndedAt TEXT,runActiveSeconds REAL,producedQuantity REAL,taskTitle TEXT,machineId TEXT,
      productCode TEXT,productDescription TEXT,productUnit TEXT,scrapQuantity REAL,scrapReason TEXT,
      qualityStatus TEXT,plannedSetupMinutes REAL,plannedRunMinutes REAL,plannedQuantity REAL,scrapReasonCode TEXT
    );
    CREATE TABLE executionEvents(id TEXT PRIMARY KEY,taskId TEXT,action TEXT,at TEXT);
    CREATE TABLE machineStops(id TEXT PRIMARY KEY,machineId TEXT,startedAt TEXT,endedAt TEXT,reason TEXT,reasonCode TEXT);
  `);
  const execution=db.prepare('INSERT INTO execution VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  execution.run('real-1','completed','2026-03-29T08:00:00Z','2026-03-29T09:00:00Z',600,'2026-03-29T10:00:00Z',600,10,'Ordine reale','M1','P1','Prodotto 1','m',2,null,'conforming',30,10,12,null);
  execution.run('legacy-1','completed',null,null,null,'2026-03-29T11:00:00Z',1200,5,'Storico senza eventi','M1','P2','Prodotto 2','m',0,null,'conforming',30,20,5,null);
  execution.run('sim10m-v1-task-1','completed','2026-03-29T08:00:00Z','2026-03-29T08:30:00Z',0,'2026-03-29T12:00:00Z',3600,100,'DEMO-STORICO · ordine','M1','PD','Prodotto demo','m',5,null,'conforming',30,60,105,null);
  execution.run('long-run','completed','2026-03-28T20:00:00Z','2026-03-28T20:30:00Z',0,'2026-03-29T22:00:00Z',82800,23,'Ordine DST','M2','P3','Prodotto 3','kg',0,null,'conforming',30,1380,23,null);
  execution.run('paused-run','completed','2026-03-29T20:00:00Z','2026-03-29T20:30:00Z',0,'2026-03-31T22:00:00Z',14400,4,'Ordine con pausa lunga','M2','P4','Prodotto 4','kg',0,null,'conforming',30,240,4,null);
  execution.run('open-run','run_running','2026-03-30T08:00:00Z','2026-03-30T08:30:00Z',0,null,0,null,'Ordine aperto','M1','P5','Prodotto 5','m',null,null,null,30,120,10,null);
  const event=db.prepare('INSERT INTO executionEvents VALUES (?,?,?,?)');
  event.run('e1','real-1','start_run','2026-03-29T09:50:00Z');event.run('e2','real-1','finish_run','2026-03-29T10:00:00Z');
  event.run('e3','sim10m-v1-task-1','start_run','2026-03-29T11:00:00Z');event.run('e4','sim10m-v1-task-1','finish_run','2026-03-29T12:00:00Z');
  event.run('e5','long-run','start_run','2026-03-28T22:00:00Z');event.run('e6','long-run','finish_run','2026-03-29T22:00:00Z');
  event.run('e7','paused-run','start_run','2026-03-29T22:00:00Z');event.run('e8','paused-run','pause_run','2026-03-30T00:00:00Z');event.run('e9','paused-run','resume_run','2026-03-31T20:00:00Z');event.run('e10','paused-run','finish_run','2026-03-31T22:00:00Z');
  event.run('e11','open-run','start_run','2026-03-30T10:00:00Z');
  db.exec(`
    INSERT INTO machineStops VALUES ('stop-real','M1','2026-03-29T09:00:00Z','2026-03-29T09:30:00Z','Guasto','breakdown');
    INSERT INTO machineStops VALUES ('sim10m-v1-stop-1','M1','2026-03-29T09:30:00Z','2026-03-29T10:00:00Z','DEMO','demo');
  `);
  return db;
}

test('filtro demo è esplicito, coerente su produzione, eventi e fermi',()=>{
  const db=fixture(),now=new Date('2026-03-30T12:00:00Z');
  const included=buildStatisticsReport(db,{from:'2026-03-29',to:'2026-03-29'},now);
  const excluded=buildStatisticsReport(db,{from:'2026-03-29',to:'2026-03-29',excludeDemo:true},now);
  assert.equal(included.filters.excludeDemo,false);
  assert.ok(included.details.some(row=>row.taskId==='sim10m-v1-task-1'));
  assert.ok(included.stopReasons.some(row=>row.reasonCode==='demo'));
  assert.ok(!excluded.details.some(row=>row.taskId==='sim10m-v1-task-1'));
  assert.ok(!excluded.stopReasons.some(row=>row.reasonCode==='demo'));
  assert.equal(excluded.dailyActivity.find(row=>row.machineId==='M1').activeRunHours,0.17);
  assert.throws(()=>buildStatisticsReport(db,{excludeDemo:'yes'},now),/dimostrativi/);
  db.close();
});

test('il dettaglio conserva i secondi di lavorazione per velocità e riepiloghi',()=>{
 const db=fixture();db.exec('ALTER TABLE execution ADD COLUMN interruptedAt TEXT');
 db.prepare("UPDATE execution SET interruptedAt=?,runEndedAt=?,producedQuantity=10,scrapQuantity=0,runActiveSeconds=600 WHERE taskId='open-run'").run('2026-03-30T10:30:00Z','2026-03-30T10:30:00Z');
 const report=buildStatisticsReport(db,{from:'2026-03-30',to:'2026-03-30',machineId:'M1',excludeDemo:true},new Date('2026-03-30T12:00:00Z'));
 const row=report.details[0];
 assert.equal(row.actualRunSeconds,600);assert.equal(row.goodQuantity/(row.actualRunSeconds/60),1);
 assert.equal(row.actualRunHours,report.speeds[0].activeRunHours,'ore dettaglio e aggregato sullo stesso campione');
 db.prepare("UPDATE execution SET runActiveSeconds=NULL WHERE taskId='open-run'").run();
 const missing=buildStatisticsReport(db,{from:'2026-03-30',to:'2026-03-30',machineId:'M1',excludeDemo:true},new Date('2026-03-30T12:00:00Z')).details[0];
 assert.equal(missing.actualRunSeconds,null);assert.equal(missing.actualRunHours,null,'dato mancante diverso da zero');db.close();
});

test('interruzione conserva produzione parziale e chiude il tempo attivo alla conferma',()=>{
 const db=fixture();db.exec('ALTER TABLE execution ADD COLUMN interruptedAt TEXT');
 db.prepare("UPDATE execution SET interruptedAt=?,runEndedAt=?,producedQuantity=3,scrapQuantity=0,runActiveSeconds=1800 WHERE taskId='open-run'").run('2026-03-30T10:30:00Z','2026-03-30T10:30:00Z');
 const report=buildStatisticsReport(db,{from:'2026-03-30',to:'2026-03-30',machineId:'M1',excludeDemo:true},new Date('2026-03-30T12:00:00Z'));
 assert.equal(report.details.length,1);assert.equal(report.details[0].goodQuantity,3);assert.equal(report.details[0].closureStatus,'Interrotta');assert.equal(report.details[0].actualRunHours,0.5);assert.equal(report.dailyActivity[0].activeRunHours,0.5);assert.equal(report.coverage.status,'complete');
 // Preparation-only interruption does not create a production declaration.
 db.prepare("UPDATE execution SET producedQuantity=NULL WHERE taskId='open-run'").run();assert.equal(buildStatisticsReport(db,{from:'2026-03-30',to:'2026-03-30',machineId:'M1'},new Date('2026-03-30T12:00:00Z')).details.length,0);db.close();
});

test('attività giornaliera usa eventi, spezza alla mezzanotte di Roma e rispetta DST e macchina',()=>{
  const db=fixture(),now=new Date('2026-03-30T12:00:00Z');
  const report=buildStatisticsReport(db,{from:'2026-03-28',to:'2026-03-29',machineId:'M2',excludeDemo:true},now);
  assert.deepEqual(report.dailyActivity,[
    {date:'2026-03-28',machineId:'M2',machineName:'Accoppiatrice 2',activeRunHours:1},
    {date:'2026-03-29',machineId:'M2',machineName:'Accoppiatrice 2',activeRunHours:23},
  ]);
  assert.ok(report.dailyActivity.every(row=>row.machineId==='M2'));
  assert.equal(report.coverage.status,'complete');
  db.close();
});

test('copertura parziale non inventa tempo per consuntivi senza eventi',()=>{
  const db=fixture();
  const report=buildStatisticsReport(db,{from:'2026-03-29',to:'2026-03-29',machineId:'M1',excludeDemo:true},new Date('2026-03-30T12:00:00Z'));
  assert.equal(report.coverage.status,'partial');
  assert.equal(report.coverage.relevantExecutionCount,2);
  assert.equal(report.coverage.executionWithEventsCount,1);
  assert.equal(report.coverage.missingEventExecutionCount,1);
  assert.equal(report.dailyActivity.length,1);
  db.close();
});

test('pause su più giorni non contano e un intervallo aperto termina a now',()=>{
  const db=fixture();
  const paused=buildStatisticsReport(db,{from:'2026-03-30',to:'2026-03-31',machineId:'M2',excludeDemo:true},new Date('2026-04-01T12:00:00Z'));
  assert.deepEqual(paused.dailyActivity,[
    {date:'2026-03-30',machineId:'M2',machineName:'Accoppiatrice 2',activeRunHours:2},
    {date:'2026-03-31',machineId:'M2',machineName:'Accoppiatrice 2',activeRunHours:2},
  ]);
  const live=buildStatisticsReport(db,{from:'2026-03-30',to:'2026-03-30',machineId:'M1',excludeDemo:true},new Date('2026-03-30T12:00:00Z'));
  assert.deepEqual(live.dailyActivity,[{date:'2026-03-30',machineId:'M1',machineName:'Accoppiatrice 1',activeRunHours:2}]);
  assert.equal(live.coverage.status,'complete');
  db.close();
});

test('eventi allo stesso millisecondo rispettano l’ordine di registrazione, non gli ID casuali',()=>{
  const db=fixture();
  db.prepare('INSERT INTO machines VALUES (?,?)').run('M3','Accoppiatrice 3');
  db.prepare('INSERT INTO execution VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('tie-run','completed',null,null,null,'2026-04-02T10:00:00Z',0,0,'Ordine istantaneo','M3','P6','Prodotto 6','m',0,null,'conforming',0,0,0,null);
  db.prepare('INSERT INTO executionEvents VALUES (?,?,?,?)').run('z-start','tie-run','start_run','2026-04-02T10:00:00Z');
  db.prepare('INSERT INTO executionEvents VALUES (?,?,?,?)').run('a-finish','tie-run','finish_run','2026-04-02T10:00:00Z');
  const report=buildStatisticsReport(db,{from:'2026-04-02',to:'2026-04-02',machineId:'M3',excludeDemo:true},new Date('2026-04-03T00:00:00Z'));
  assert.equal(report.coverage.status,'complete');
  assert.equal(report.coverage.incompleteSequenceCount,0);
  assert.deepEqual(report.dailyActivity,[]);
  db.close();
});

test('delta attrezzaggio usa solo coppie disponibili e sottrae le pause',()=>{
  const db=fixture();
  const report=buildStatisticsReport(db,{from:'2026-03-29',to:'2026-03-29',machineId:'M1',excludeDemo:true},new Date('2026-03-30T12:00:00Z'));
  assert.equal(report.totals.setupPairedCount,1);
  assert.equal(report.totals.setupDeltaHours,0.33);
  assert.equal(report.totals.averageSetupDeltaMinutes,20);
  assert.equal(report.details.find(row=>row.taskId==='real-1').actualSetupHours,0.83);
  assert.equal(report.details.find(row=>row.taskId==='legacy-1').setupDeltaHours,null);
  db.close();
});

test('velocità effettiva raggruppa macchina, prodotto e unità usando minuti attivi',()=>{
  const db=fixture();
  const report=buildStatisticsReport(db,{from:'2026-03-29',to:'2026-03-29',machineId:'M1',excludeDemo:true},new Date('2026-03-30T12:00:00Z'));
  const speed=report.speeds.find(row=>row.productCode==='P1');
  assert.equal(speed.activeRunHours,0.17);
  assert.equal(speed.goodUnitsPerMinute,1);
  assert.equal(speed.totalUnitsPerMinute,1.2);
  assert.equal(speed.unit,'m');
  db.close();
});

test('export contiene nove fogli e documenta filtro e copertura',()=>{
  const db=fixture();
  const report=buildStatisticsReport(db,{from:'2026-03-29',to:'2026-03-29',excludeDemo:true},new Date('2026-03-30T12:00:00Z'));
  const raw=buildStatisticsWorkbook(report).toString('utf8');
  assert.equal((raw.match(/<sheet name=/g)||[]).length,9);
  assert.match(raw,/Velocità/);
  assert.match(raw,/Attività giornaliera/);
  assert.match(raw,/Dati dimostrativi/);
  assert.match(raw,/Esclusi/);
  assert.match(raw,/Copertura parziale/);
  db.close();
});
