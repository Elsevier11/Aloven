import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { executionMetrics, migrateQuality, validateFinishDeclaration } from './quality.mjs';
import { migrateShopfloor } from './shopfloor.mjs';

function execution(overrides={}) {
  return {component1Code:'ART-A',component2Code:'ART-B',...overrides};
}

function declaration(overrides={}) {
  return {
    producedQuantity:10,
    scrapQuantity:0,
    scrapReason:null,
    qualityStatus:'conforming',
    qualityNotes:'',
    qualityChecks:{appearance:'pass',bonding:'pass'},
    lots:[
      {component:'component1',lot:'LOT-A',quantity:2,barcode:'ART-A|LOT-A|2'},
      {component:'component2',lot:'LOT-B',quantity:3,barcode:'lot-b'},
    ],
    ...overrides,
  };
}

test('valida scarti, qualità e barcode rispetto allo snapshot',()=>{
  const valid=validateFinishDeclaration(declaration(),execution());
  assert.equal(valid.goodQuantity,10);
  assert.equal(valid.lots[0].barcode,'ART-A|LOT-A|2');
  assert.equal(valid.lots[1].barcode,'lot-b');
  assert.throws(()=>validateFinishDeclaration(declaration({qualityStatus:'conforming',qualityChecks:{appearance:'fail',bonding:'pass'}}),execution()),/conforme/);
  assert.throws(()=>validateFinishDeclaration(declaration({qualityStatus:'conforming',qualityChecks:{appearance:'na',bonding:'na'}}),execution()),/conforme/);
  assert.throws(()=>validateFinishDeclaration(declaration({qualityStatus:'review',qualityNotes:' '}),execution()),/note qualità/);
  assert.throws(()=>validateFinishDeclaration(declaration({qualityStatus:'nonconforming',qualityNotes:null}),execution()),/note qualità/);
  assert.throws(()=>validateFinishDeclaration(declaration({scrapQuantity:1}),execution()),/motivazione per lo scarto/);
  assert.throws(()=>validateFinishDeclaration(declaration({producedQuantity:1e9,scrapQuantity:1,scrapReason:'Difetto'}),execution()),/somma/);
  assert.throws(()=>validateFinishDeclaration(declaration({lots:[{component:'component1',lot:'LOT-A',quantity:2,barcode:'ALTRO|LOT-A|2'},{component:'component2',lot:'LOT-B',quantity:3}]}),execution()),/articolo/);
  assert.throws(()=>validateFinishDeclaration(declaration({lots:[{component:'component1',lot:'LOT-A',quantity:2,barcode:'ART-A|LOT-X|2'},{component:'component2',lot:'LOT-B',quantity:3}]}),execution()),/lotto/);
  assert.throws(()=>validateFinishDeclaration(declaration({lots:[{component:'component1',lot:'LOT-A',quantity:2,barcode:'ART-A|LOT-A|3'},{component:'component2',lot:'LOT-B',quantity:3}]}),execution()),/quantità/);
  assert.throws(()=>validateFinishDeclaration(declaration({lots:[{component:'component1',lot:'LOT-A',quantity:2,barcode:'SCANSIONE'},{component:'component2',lot:'LOT-B',quantity:3}]}),execution()),/non corrisponde/);
  assert.throws(()=>validateFinishDeclaration(declaration({lots:[{component:'component1',lot:'LOT-A',quantity:2,barcode:'LOT-A\nALTRO'},{component:'component2',lot:'LOT-B',quantity:3}]}),execution()),/caratteri di controllo/);
  assert.throws(()=>validateFinishDeclaration(declaration({lots:[{component:'component1',lot:'LOT-A',quantity:1e9+1},{component:'component2',lot:'LOT-B',quantity:3}]}),execution()),/Quantità consumata/);
});

test('shopfloor-v2 conserva null storici, backfill del piano ed è idempotente',()=>{
  const db=new DatabaseSync(':memory:');
  try {
    db.exec(`
      CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      INSERT INTO meta VALUES ('revision','7');
      CREATE TABLE tasks(id TEXT PRIMARY KEY,setupMinutes REAL,runMinutes REAL,quantity REAL,effectiveSetupMinutes REAL);
      INSERT INTO tasks VALUES ('task-1',12,34,56,9);
    `);
    migrateShopfloor(db);
    db.prepare(`INSERT INTO execution(taskId,phase,runActiveSeconds,taskTitle,machineId,component1Code,component1Description,component1Unit,component2Code,component2Description,component2Unit,productCode,productDescription,productUnit)
      VALUES ('task-1','completed',4,'Titolo','M1','A','A','kg','B','B','kg','P','P','kg')`).run();
    assert.deepEqual(migrateQuality(db),{migrated:true});
    const row=db.prepare('SELECT * FROM execution WHERE taskId=?').get('task-1');
    assert.equal(row.plannedSetupMinutes,9);
    assert.equal(row.plannedRunMinutes,34);
    assert.equal(row.plannedQuantity,56);
    assert.equal(row.scrapQuantity,null);
    assert.equal(row.qualityStatus,null);
    assert.equal(row.qualityChecks,null);
    assert.equal(db.prepare("SELECT value FROM meta WHERE key='revision'").get().value,'9');
    assert.deepEqual(migrateQuality(db),{migrated:false});
    assert.equal(db.prepare("SELECT value FROM meta WHERE key='revision'").get().value,'9');
  } finally {db.close();}
});

test('shopfloor-v2 esegue rollback atomico se il backfill fallisce',()=>{
  const db=new DatabaseSync(':memory:');
  try {
    db.exec("CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL); INSERT INTO meta VALUES ('revision','1'); CREATE TABLE tasks(id TEXT PRIMARY KEY)");
    migrateShopfloor(db);
    assert.throws(()=>migrateQuality(db),/no such column/);
    assert.equal(db.prepare("SELECT 1 FROM meta WHERE key='shopfloor-v2'").get(),undefined);
    assert.equal(db.prepare("SELECT 1 FROM pragma_table_info('execution') WHERE name='scrapQuantity'").get(),undefined);
  } finally {db.close();}
});

test('metriche confrontano snapshot e tempi reali, inclusi valori zero',()=>{
  const direct=executionMetrics({phase:'completed',setupStartedAt:null,setupEndedAt:null,runActiveSeconds:0,lastRunStartedAt:null,plannedSetupMinutes:0,plannedRunMinutes:0,plannedQuantity:0,producedQuantity:0,scrapQuantity:0});
  assert.deepEqual(direct,{plannedSetupSeconds:0,actualSetupSeconds:0,setupDeltaSeconds:0,plannedRunSeconds:0,actualRunSeconds:0,runDeltaSeconds:0,plannedQuantity:0,goodQuantity:0,scrapQuantity:0,totalQuantity:0,scrapPercent:null});
  const known=executionMetrics({phase:'completed',setupStartedAt:'2026-01-01T08:00:00.000Z',setupEndedAt:'2026-01-01T08:05:00.000Z',runActiveSeconds:600,lastRunStartedAt:null,plannedSetupMinutes:4,plannedRunMinutes:8,plannedQuantity:10,producedQuantity:8,scrapQuantity:2});
  assert.equal(known.actualSetupSeconds,300);
  assert.equal(known.setupDeltaSeconds,60);
  assert.equal(known.actualRunSeconds,600);
  assert.equal(known.runDeltaSeconds,120);
  assert.equal(known.scrapPercent,20);
  const live=executionMetrics({phase:'run_running',setupStartedAt:null,setupEndedAt:null,runActiveSeconds:30,lastRunStartedAt:'2026-01-01T09:00:00.000Z',plannedSetupMinutes:null,plannedRunMinutes:1,plannedQuantity:null,producedQuantity:null,scrapQuantity:null},'2026-01-01T09:00:10.000Z');
  assert.equal(live.actualRunSeconds,40);
  assert.equal(live.runDeltaSeconds,null);
  assert.equal(live.setupDeltaSeconds,null);
});
