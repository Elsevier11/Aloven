import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { buildStatisticsReport, buildStatisticsWorkbook } from './statistics.mjs';

function fixture() {
  const db=new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE machines(id TEXT PRIMARY KEY,name TEXT NOT NULL);
    CREATE TABLE execution(taskId TEXT PRIMARY KEY,phase TEXT,setupStartedAt TEXT,setupEndedAt TEXT,runEndedAt TEXT,runActiveSeconds REAL,producedQuantity REAL,taskTitle TEXT,machineId TEXT,productCode TEXT,productDescription TEXT,productUnit TEXT,scrapQuantity REAL,scrapReason TEXT,qualityStatus TEXT,plannedSetupMinutes REAL,plannedRunMinutes REAL,plannedQuantity REAL,scrapReasonCode TEXT);
    CREATE TABLE machineStops(id TEXT PRIMARY KEY,machineId TEXT,startedAt TEXT,endedAt TEXT,reason TEXT,reasonCode TEXT);
    INSERT INTO machines VALUES ('M1','Accoppiatrice 1'),('M2','Accoppiatrice 2');
  `);
  const execution=db.prepare('INSERT INTO execution VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  execution.run('t1','completed','2026-03-31T21:40:00Z','2026-03-31T22:00:00Z','2026-03-31T22:30:00Z',3600,90,'=ATTIVITA','M1','=PROD','Prodotto\u0001 A','m',10,null,'nonconforming',null,90,null,null);
  execution.run('t2','completed',null,null,'2026-04-01T08:00:00Z',7200,0,'B','M1','P2','Prodotto B','m',0,null,'conforming',0,120,0,null);
  execution.run('t3','completed','2026-04-01T09:00:00Z','2026-04-01T09:30:00Z','2026-04-01T12:00:00Z',5400,50,'C','M1','P3','Prodotto C','kg',5,'Pieghe','conforming',30,80,60,'folds');
  execution.run('t4','completed',null,null,'2026-04-01T13:00:00Z',1800,10,'D','M2','P4','Prodotto D','m2',0,null,'review',0,30,10,null);
  const stop=db.prepare('INSERT INTO machineStops VALUES (?,?,?,?,?,?)');
  stop.run('s1','M1','2026-03-31T21:00:00Z','2026-04-01T00:00:00Z','Guasto','breakdown');
  stop.run('s2','M1','2026-04-01T20:00:00Z',null,'Vecchio fermo',null);
  stop.run('s3','M2','2026-04-01T10:00:00Z','2026-04-01T11:00:00Z','Materiali','materials');
  return db;
}

test('statistiche: date di Roma, unità separate, valori mancanti e fermi ritagliati',()=>{
  const db=fixture();
  const report=buildStatisticsReport(db,{from:'2026-04-01',to:'2026-04-01',machineId:'M1'},new Date('2026-04-01T21:00:00Z'));
  assert.equal(report.details.length,3);
  assert.equal(report.details[0].completedDate,'2026-04-01','il completamento UTC deve cadere nel giorno locale di Roma');
  assert.deepEqual(report.monthly.map(row=>row.unit),['kg','m']);
  const metres=report.monthly.find(row=>row.unit==='m');
  assert.equal(metres.plannedQuantity,null,'una quantità pianificata mancante non deve diventare zero');
  assert.equal(metres.plannedSetupHours,null,'un tempo pianificato mancante non deve diventare zero');
  assert.equal(metres.goodQuantity,90);
  assert.equal(metres.scrapQuantity,10);
  assert.equal(metres.scrapRate,0.1);
  assert.equal(report.products.find(row=>row.productCode==='P2').scrapRate,null,'denominatore zero');
  assert.equal(report.totals.stoppedHours,3,'due ore prima della mezzanotte UTC incluse nel giorno di Roma e un’ora di fermo aperto');
  assert.equal(report.totals.stopCount,2);
  assert.equal(report.totals.openStopCount,1);
  assert.equal(report.stopReasons.find(row=>row.reasonCode==='unclassified-legacy').label,'Vecchio fermo');
  assert.equal(report.scrapReasons.find(row=>row.reasonCode==='unclassified-legacy').label,'Non classificata (storico)');
  db.close();
});

test('statistiche: default storico, validazione filtri e macchina',()=>{
  const db=fixture();
  const report=buildStatisticsReport(db,{},new Date('2026-04-02T10:00:00Z'));
  assert.equal(report.filters.from,'2026-04-01');
  assert.equal(report.filters.to,'2026-04-02');
  assert.equal(report.details.length,4);
  assert.throws(()=>buildStatisticsReport(db,{from:'2026-02-30',to:'2026-04-01'}),/Intervallo date/);
  assert.throws(()=>buildStatisticsReport(db,{from:'2026-04-02',to:'2026-04-01'}),/data iniziale/);
  assert.throws(()=>buildStatisticsReport(db,{machineId:'inesistente'}),error=>error.status===404);
  db.close();
});

test('export XLSX: contenitore nativo, fogli, filtri e stringhe non interpretate come formule',()=>{
  const db=fixture(),report=buildStatisticsReport(db,{from:'2026-04-01',to:'2026-04-01'},new Date('2026-04-01T21:00:00Z'));
  const file=buildStatisticsWorkbook(report);
  assert.equal(file.subarray(0,4).toString('hex'),'504b0304');
  const raw=file.toString('utf8');
  assert.match(raw,/\[Content_Types\]\.xml/);
  assert.match(raw,/Mensile/);
  assert.match(raw,/Dettaglio/);
  assert.match(raw,/autoFilter/);
  assert.match(raw,/formatCode="#,##0\.00"/);
  assert.match(raw,/<\/fills><borders/);
  assert.match(raw,/Completamento runEndedAt nel giorno locale Europe\/Rome/);
  assert.match(raw,/01\/04\/2026 00:30:00/);
  assert.doesNotMatch(raw,/Prodotto\u0001 A/);
  assert.match(raw,/Prodotto A/);
  assert.match(raw,/t="inlineStr"[^>]*><is><t xml:space="preserve">=PROD<\/t>/);
  assert.doesNotMatch(raw,/<f>/);
  db.close();
});

test('API statistiche richiede sessione, valida filtri ed esporta XLSX',async()=>{
  const data=mkdtempSync(path.join(tmpdir(),'aloven-statistics-'));
  let child,base,cookie='';
  try {
    child=spawn(process.execPath,['server.mjs'],{cwd:process.cwd(),env:{...process.env,PORT:'0',DATA_DIR:data},stdio:['ignore','pipe','pipe']});
    base=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(new Error('Server non avviato: '+output)),10000);child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});child.stderr.on('data',chunk=>output+=chunk);child.on('exit',()=>reject(new Error('Server terminato: '+output)));});
    let response=await fetch(`${base}/api/statistics`);assert.equal(response.status,401);
    response=await fetch(`${base}/api/setup`,{method:'POST',headers:{'Content-Type':'application/json','X-Aloven-Request':'1'},body:JSON.stringify({name:'Admin',username:'admin',password:'PasswordTest123!'})});
    assert.equal(response.status,200);cookie=response.headers.get('set-cookie').split(';')[0];
    response=await fetch(`${base}/api/statistics?from=2026-04-01&to=2026-04-01`,{headers:{Cookie:cookie}});assert.equal(response.status,200);assert.equal((await response.json()).totals.count,0);
    response=await fetch(`${base}/api/statistics?from=2026-99-01&to=2026-04-01`,{headers:{Cookie:cookie}});assert.equal(response.status,400);
    response=await fetch(`${base}/api/statistics/export?from=2026-04-01&to=2026-04-01`,{headers:{Cookie:cookie}});assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/spreadsheetml/);assert.match(response.headers.get('content-disposition'),/\.xlsx/);assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0,4).toString('hex'),'504b0304');
  } finally {
    if(child && child.exitCode===null){const done=once(child,'exit');child.kill();await done;}
    rmSync(data,{recursive:true,force:true});
  }
});
