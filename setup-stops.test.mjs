import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrateShopfloor, performShopfloorAction, shopfloorExecutions } from './shopfloor.mjs';
import { migrateQuality } from './quality.mjs';
import { migrateDowntime, performMachineStopAction } from './downtime.mjs';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    INSERT INTO meta VALUES ('revision','10');
    CREATE TABLE machines(id TEXT PRIMARY KEY);
    INSERT INTO machines VALUES ('M1');
    CREATE TABLE tasks(
      id TEXT PRIMARY KEY,machineId TEXT,status TEXT,position INTEGER,
      setupMinutes REAL,runMinutes REAL,quantity REAL,effectiveSetupMinutes REAL
    );
    INSERT INTO tasks VALUES ('T1','M1','in_progress',1,30,60,100,30);
    CREATE TABLE machineStopReasons(id TEXT PRIMARY KEY,code TEXT,description TEXT,active INTEGER);
    INSERT INTO machineStopReasons VALUES ('R1','breakdown','Guasto',1);
  `);
  migrateShopfloor(db);
  migrateQuality(db);
  db.prepare(`INSERT INTO execution(
    taskId,phase,setupStartedAt,runActiveSeconds,taskTitle,machineId,
    component1Code,component1Description,component1Unit,
    component2Code,component2Description,component2Unit,
    productCode,productDescription,productUnit,
    plannedSetupMinutes,plannedRunMinutes,plannedQuantity
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'T1','setup_running','2026-10-11T08:00:00.000Z',0,'Test','M1',
    'A','A','m','B','B','m','P','P','m',30,60,100,
  );
  const revisionBeforeDowntime = Number(db.prepare("SELECT value FROM meta WHERE key='revision'").get().value);
  assert.deepEqual(migrateDowntime(db),{migrated:true});
  db.exec('ALTER TABLE machineStops ADD COLUMN reasonId TEXT; ALTER TABLE machineStops ADD COLUMN reasonCode TEXT;');
  return {db,revisionBeforeDowntime};
}

test('fermi ripetuti prima della ripresa setup conservano la pausa originaria e un solo audit di ripresa',()=>{
  const {db,revisionBeforeDowntime}=fixture();
  let serial=0;
  const makeId=()=>`id-${++serial}`;
  const user={id:'U1',name:'Operatore'};
  const revision=()=>Number(db.prepare("SELECT value FROM meta WHERE key='revision'").get().value);
  const stop=(action,at,expectedRevision=revision())=>performMachineStopAction(db,{revision:expectedRevision,machineId:'M1',action,...(action==='stop'?{reasonId:'R1'}:{})},user,makeId,at);
  const shop=(action,at,expectedRevision=revision())=>performShopfloorAction(db,{revision:expectedRevision,taskId:'T1',action},user,makeId,at);

  try {
    assert.equal(revision(),revisionBeforeDowntime+1);
    assert.equal(db.prepare("SELECT value FROM meta WHERE key='downtime-v2'").get().value,'1');
    assert.equal(db.prepare("SELECT setupPausedAt,setupPausedSeconds FROM execution WHERE taskId='T1'").get().setupPausedSeconds,0);
    const migratedRevision=revision();
    assert.deepEqual(migrateDowntime(db),{migrated:false});
    assert.equal(revision(),migratedRevision,'la migrazione ripetuta non incrementa la revisione');

    const firstRevision=revision();
    stop('stop','2026-10-11T08:05:00.000Z',firstRevision);
    assert.throws(()=>stop('stop','2026-10-11T08:06:00.000Z'),/già ferma/);
    assert.throws(()=>stop('stop','2026-10-11T08:06:00.000Z',firstRevision),/dati sono cambiati/i);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM machineStops').get().count,1,'stop duplicato registrato');
    assert.throws(()=>shop('finish_setup','2026-10-11T08:07:00.000Z'),/macchina è ferma/i);
    assert.throws(()=>shop('start_run','2026-10-11T08:07:00.000Z'),/macchina è ferma/i);

    stop('resume','2026-10-11T08:10:00.000Z');
    stop('stop','2026-10-11T08:15:00.000Z');
    let execution=db.prepare("SELECT setupPausedAt,setupPausedSeconds FROM execution WHERE taskId='T1'").get();
    assert.equal(execution.setupPausedAt,'2026-10-11T08:05:00.000Z','il secondo fermo ha sovrascritto l’inizio pausa setup');
    assert.equal(execution.setupPausedSeconds,0);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM machineStops').get().count,2);
    assert.throws(()=>shop('finish_setup','2026-10-11T08:16:00.000Z'),/macchina è ferma/i);
    assert.throws(()=>shop('start_run','2026-10-11T08:16:00.000Z'),/macchina è ferma/i);

    stop('resume','2026-10-11T08:20:00.000Z');
    assert.throws(()=>shop('finish_setup','2026-10-11T08:21:00.000Z'),/preparazione è sospesa/i);
    assert.throws(()=>shop('start_run','2026-10-11T08:21:00.000Z'),/non può essere avviata/i);
    const resumeRevision=revision();
    shop('resume_setup','2026-10-11T08:25:00.000Z',resumeRevision);
    assert.throws(()=>shop('resume_setup','2026-10-11T08:25:00.000Z',resumeRevision),/dati sono cambiati/i);
    execution=db.prepare("SELECT setupPausedAt,setupPausedSeconds FROM execution WHERE taskId='T1'").get();
    assert.equal(execution.setupPausedAt,null);
    assert.equal(execution.setupPausedSeconds,20*60,'non è stata esclusa l’intera pausa tra primo fermo e ripresa esplicita');
    assert.equal(db.prepare('SELECT COUNT(*) count FROM setupResumeEvents').get().count,1,'audit ripresa duplicato');

    shop('finish_setup','2026-10-11T08:30:00.000Z');
    shop('start_run','2026-10-11T08:30:00.000Z');
    const projected=shopfloorExecutions(db,'2026-10-11T08:30:00.000Z').find(row=>row.taskId==='T1');
    assert.equal(projected.setupActualSeconds,10*60);
    assert.equal(projected.events.filter(event=>event.action==='resume_setup').length,1);
    assert.deepEqual(db.prepare('SELECT startedAt,endedAt FROM machineStops ORDER BY startedAt').all().map(row=>({...row})),[
      {startedAt:'2026-10-11T08:05:00.000Z',endedAt:'2026-10-11T08:10:00.000Z'},
      {startedAt:'2026-10-11T08:15:00.000Z',endedAt:'2026-10-11T08:20:00.000Z'},
    ]);
  } finally {
    db.close();
  }
});
