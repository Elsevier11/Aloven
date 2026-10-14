import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  correctFinishedExecution,
  decideQualityDisposition,
  decorateMesExecutions,
  finalizeMesExecution,
  listMesAudit,
  migrateMesRecords,
  traceLots,
  validateOutputLot,
} from './mes-records.mjs';

const admin = {id: 'admin-1', name: 'Amministratore', role: 'admin'};
const operator = {id: 'operator-1', name: 'Operatore', role: 'operator'};

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    INSERT INTO meta VALUES ('revision','10');
    CREATE TABLE tasks(id TEXT PRIMARY KEY,title TEXT,outputSentinel TEXT);
    INSERT INTO tasks VALUES ('task-1','Ordine preservato','dato esistente');
    CREATE TABLE execution(
      taskId TEXT PRIMARY KEY, phase TEXT, producedQuantity REAL, scrapQuantity REAL, scrapReason TEXT,
      scrapReasonId TEXT, scrapReasonCode TEXT, qualityStatus TEXT, qualityNotes TEXT, qualityChecks TEXT,
      component1Code TEXT,component1Unit TEXT,component2Code TEXT,component2Unit TEXT,
      productCode TEXT,productDescription TEXT,productUnit TEXT,taskTitle TEXT,machineId TEXT,runEndedAt TEXT
    );
    INSERT INTO execution VALUES (
      'task-1','completed',8,2,'Difetto','reason-1','defect','nonconforming','Nota',
      '{"appearance":"fail","bonding":"pass"}','C1','m','C2','kg','P1','Prodotto','m','Ordine preservato','M1','2026-10-10T10:00:00.000Z'
    );
    CREATE TABLE executionLots(
      id TEXT PRIMARY KEY,taskId TEXT,component TEXT,articleCode TEXT,lot TEXT COLLATE NOCASE,
      quantity REAL,unit TEXT,barcode TEXT,UNIQUE(taskId,component,lot)
    );
    INSERT INTO executionLots VALUES ('old-1','task-1','component1','C1','IN-A',5,'m',NULL);
    INSERT INTO executionLots VALUES ('old-2','task-1','component2','C2','IN-B',3,'kg',NULL);
    CREATE TABLE scrapReasons(id TEXT PRIMARY KEY,code TEXT,description TEXT,active INTEGER);
    INSERT INTO scrapReasons VALUES ('reason-1','defect','Difetto',1);
  `);
  let sequence = 0;
  return {db, makeId: () => `id-${++sequence}`};
}

function correction(revision = 11) {
  return {
    taskId: 'task-1', revision, operationId: 'op-correct-1', reason: 'Errore di trascrizione verificato',
    producedQuantity: 9, scrapQuantity: 1, scrapReasonId: 'reason-1', outputLot: 'OUT-9',
    qualityStatus: 'conforming', qualityNotes: '', qualityChecks: {appearance: 'pass', bonding: 'pass'},
    lots: [
      {component: 'component1', lot: 'IN-A2', quantity: 6},
      {component: 'component2', lot: 'IN-B2', quantity: 4},
    ],
  };
}

test('migrazione additiva idempotente preserva dati legacy senza inventare lotto o disposizione', () => {
  const {db} = fixture();
  assert.deepEqual(migrateMesRecords(db), {migrated: true});
  const task = db.prepare('SELECT * FROM tasks WHERE id=?').get('task-1');
  const execution = db.prepare('SELECT * FROM execution WHERE taskId=?').get('task-1');
  assert.equal(task.outputSentinel, 'dato esistente');
  assert.equal(task.outputLot, null);
  assert.equal(execution.outputLot, null);
  assert.equal(execution.qualityDisposition, null);
  assert.equal(db.prepare("SELECT value FROM meta WHERE key='revision'").get().value, '11');
  assert.deepEqual(migrateMesRecords(db), {migrated: false});
  assert.equal(db.prepare("SELECT value FROM meta WHERE key='revision'").get().value, '11');
  db.close();
});

test('chiusura classifica la nuova esecuzione, preservando i payload legacy senza lotto', () => {
  const {db, makeId} = fixture();
  migrateMesRecords(db);
  assert.deepEqual(finalizeMesExecution(db, 'task-1', {}, operator, makeId), {outputLot: null, qualityDisposition: 'pending'});
  assert.throws(() => finalizeMesExecution(db, 'task-1', {outputLot: ''}, operator, makeId), /lotto prodotto/i);
  const result = finalizeMesExecution(db, 'task-1', {outputLot: ' OUT-1 '}, operator, makeId, '2026-10-11T08:00:00.000Z');
  assert.deepEqual(result, {outputLot: 'OUT-1', qualityDisposition: 'pending'});
  const row = db.prepare('SELECT outputLot,qualityDisposition FROM execution WHERE taskId=?').get('task-1');
  assert.deepEqual({...row}, result);
  assert.equal(listMesAudit(db).total, 2);
  db.close();
});

test('validazione lotto rifiuta controlli e lunghezze senza normalizzare dati fittizi', () => {
  assert.equal(validateOutputLot(' Lotto-01 '), 'Lotto-01');
  assert.equal(validateOutputLot(null), null);
  assert.throws(() => validateOutputLot(null, {required: true}), /lotto prodotto/i);
  assert.throws(() => validateOutputLot('A\nB'), /caratteri di controllo/i);
  assert.throws(() => validateOutputLot('x'.repeat(81)), /massimo 80/i);
});

test('rettifica admin sostituisce dichiarazione e lotti, conserva originale e resetta pending', () => {
  const {db, makeId} = fixture();
  migrateMesRecords(db);
  const result = correctFinishedExecution(db, correction(), admin, makeId, '2026-10-11T09:00:00.000Z');
  assert.deepEqual(result, {ok: true, taskId: 'task-1', revision: 12});
  const after = db.prepare('SELECT * FROM execution WHERE taskId=?').get('task-1');
  assert.equal(after.producedQuantity, 9);
  assert.equal(after.scrapQuantity, 1);
  assert.equal(after.outputLot, 'OUT-9');
  assert.equal(after.qualityDisposition, 'pending');
  assert.equal(after.runEndedAt, '2026-10-10T10:00:00.000Z');
  assert.deepEqual(db.prepare('SELECT lot FROM executionLots ORDER BY lot').all().map(x => x.lot), ['IN-A2', 'IN-B2']);
  const audit = listMesAudit(db, {entityId: 'task-1'}).items[0];
  assert.equal(audit.before.producedQuantity, 8);
  assert.deepEqual(audit.before.lots.map(x => x.lot), ['IN-A', 'IN-B']);
  assert.equal(audit.after.producedQuantity, 9);
  assert.throws(() => db.prepare('UPDATE mesAuditLog SET reason=?').run('alterato'), /non può essere modificato/);
  db.close();
});

test('rettifica invalida, non admin e revisione concorrente sono atomiche', () => {
  const {db, makeId} = fixture();
  migrateMesRecords(db);
  const initial = JSON.stringify(executionState(db));
  assert.throws(() => correctFinishedExecution(db, correction(), operator, makeId), error => error.status === 403);
  assert.equal(JSON.stringify(executionState(db)), initial);
  const invalid = correction(); invalid.outputLot = ''; invalid.operationId = 'invalid';
  assert.throws(() => correctFinishedExecution(db, invalid, admin, makeId), /lotto prodotto/i);
  assert.equal(JSON.stringify(executionState(db)), initial);
  const stale = correction(10); stale.operationId = 'stale';
  assert.throws(() => correctFinishedExecution(db, stale, admin, makeId), error => error.status === 409);
  assert.equal(JSON.stringify(executionState(db)), initial);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mesAuditLog').get().n, 0);
  db.close();
});

function executionState(db) {
  return {
    execution: db.prepare('SELECT * FROM execution WHERE taskId=?').get('task-1'),
    lots: db.prepare('SELECT * FROM executionLots ORDER BY id').all(),
    revision: db.prepare("SELECT value FROM meta WHERE key='revision'").get().value,
  };
}

test('operationId consente replay identico ma non payload o proprietario diversi', () => {
  const {db, makeId} = fixture();
  migrateMesRecords(db);
  const payload = correction();
  const first = correctFinishedExecution(db, payload, admin, makeId);
  const replay = correctFinishedExecution(db, payload, admin, makeId);
  assert.deepEqual(replay, {...first, replay: true});
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mesAuditLog').get().n, 1);
  const changed = structuredClone(payload); changed.reason = 'Motivo differente';
  assert.throws(() => correctFinishedExecution(db, changed, admin, makeId), error => error.status === 409);
  assert.throws(() => correctFinishedExecution(db, payload, {...admin, id: 'admin-2'}, makeId), error => error.status === 409);
  db.close();
});

test('rettifica conserva lo snapshot della stessa causale inattiva e rifiuta una diversa inattiva', () => {
  const {db, makeId} = fixture();
  migrateMesRecords(db);
  db.prepare('UPDATE scrapReasons SET code=?,description=?,active=0 WHERE id=?').run('renamed','Rinominata','reason-1');
  db.prepare('INSERT INTO scrapReasons VALUES (?,?,?,0)').run('reason-2','inactive','Inattiva');
  correctFinishedExecution(db, correction(), admin, makeId);
  const preserved=db.prepare('SELECT scrapReasonId,scrapReasonCode,scrapReason FROM execution WHERE taskId=?').get('task-1');
  assert.deepEqual({...preserved},{scrapReasonId:'reason-1',scrapReasonCode:'defect',scrapReason:'Difetto'});
  const before=JSON.stringify(executionState(db));
  const changed=correction(12);changed.operationId='op-inactive';changed.scrapReasonId='reason-2';
  assert.throws(()=>correctFinishedExecution(db,changed,admin,makeId),/causale di scarto attiva/i);
  assert.equal(JSON.stringify(executionState(db)),before);
  db.close();
});

test('decisione qualità è storica, admin-only, ottimistica e non altera quantità', () => {
  const {db, makeId} = fixture();
  migrateMesRecords(db);
  const payload = {taskId: 'task-1', revision: 11, operationId: 'decision-1', disposition: 'rework', reason: 'Ripassare il bordo'};
  assert.throws(() => decideQualityDisposition(db, payload, operator, makeId), error => error.status === 403);
  const result = decideQualityDisposition(db, payload, admin, makeId, '2026-10-11T10:00:00.000Z');
  assert.equal(result.disposition, 'rework');
  const row = db.prepare('SELECT producedQuantity,scrapQuantity,qualityDisposition FROM execution WHERE taskId=?').get('task-1');
  assert.deepEqual({...row}, {producedQuantity: 8, scrapQuantity: 2, qualityDisposition: 'rework'});
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM qualityDecisions').get().n, 1);
  assert.throws(() => db.prepare('DELETE FROM qualityDecisions').run(), /non possono essere eliminate/);
  const decorated = decorateMesExecutions(db, [{taskId: 'task-1', qualityDisposition: 'rework'}]);
  assert.equal(decorated[0].qualityDecisions.length, 1);
  assert.equal(decorated[0].qualityClassification, 'classified');
  db.close();
});

test('tracciabilità cerca lotto esatto case-insensitive nelle due direzioni e filtra articolo', () => {
  const {db, makeId} = fixture();
  migrateMesRecords(db);
  finalizeMesExecution(db, 'task-1', {outputLot: 'OUT-1'}, operator, makeId);
  assert.equal(traceLots(db, {lot: 'in-a'}).records[0].outputLot, 'OUT-1');
  assert.equal(traceLots(db, {lot: 'in-a'}).records[0].orderReference, null, 'riferimento mancante resta null');
  db.prepare("UPDATE tasks SET orderReference='ORD-7',customer='Cliente Test' WHERE id='task-1'").run();
  const referenced = traceLots(db, {lot: 'in-a'}).records[0];
  assert.equal(referenced.orderReference, 'ORD-7');assert.equal(referenced.customer, 'Cliente Test');assert.equal(referenced.erpReference, null);
  assert.deepEqual(traceLots(db, {lot: 'out-1'}).records[0].matchedDirections, ['output']);
  assert.equal(traceLots(db, {lot: 'IN-A', articleCode: 'c1', direction: 'input'}).records.length, 1);
  assert.equal(traceLots(db, {lot: 'IN-A', articleCode: 'wrong', direction: 'input'}).records.length, 0);
  assert.equal(traceLots(db, {lot: 'IN'}).records.length, 0);
  db.close();
});
