import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { suggestSetup } from './setup-suggestion.mjs';

function fixture(rows) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE execution(taskId TEXT PRIMARY KEY,phase TEXT,machineId TEXT,productCode TEXT,
    setupStartedAt TEXT,setupEndedAt TEXT,setupPausedSeconds REAL,runEndedAt TEXT)`);
  const insert = db.prepare('INSERT INTO execution VALUES (?,?,?,?,?,?,?,?)');
  rows.forEach(([machineId, productCode, minutes, paused = 0, phase = 'completed'], index) => {
    const start = Date.parse('2026-01-01T08:00:00Z') + index * 86400000;
    insert.run('t' + index, phase, machineId, productCode, new Date(start).toISOString(), new Date(start + minutes * 60000).toISOString(), paused, new Date(start + 7200000).toISOString());
  });
  return db;
}

test('stesso articolo sulla stessa macchina: mediana dei tempi reali', () => {
  const db = fixture([['M1', 'A', 20], ['M1', 'A', 30], ['M1', 'A', 100], ['M1', 'B', 5], ['M2', 'A', 90]]);
  assert.deepEqual(suggestSetup(db, { machineId: 'M1', productCode: 'A' }), { minutes: 30, basis: 'article', count: 3 });
});

test('le pause di attrezzaggio non contano nel tempo suggerito', () => {
  const db = fixture([['M1', 'A', 40, 600], ['M1', 'A', 40, 600], ['M1', 'A', 40, 600]]);
  assert.equal(suggestSetup(db, { machineId: 'M1', productCode: 'A' }).minutes, 30);
});

test('pochi casi per l\'articolo: si usa la macchina, dichiarandolo', () => {
  const db = fixture([['M1', 'A', 20], ['M1', 'B', 30], ['M1', 'C', 40], ['M1', 'D', 50], ['M1', 'E', 60]]);
  assert.deepEqual(suggestSetup(db, { machineId: 'M1', productCode: 'A' }), { minutes: 40, basis: 'machine', count: 5 });
});

test('storico insufficiente o macchina senza storico: nessun suggerimento', () => {
  const db = fixture([['M1', 'A', 20], ['M1', 'B', 30]]);
  assert.equal(suggestSetup(db, { machineId: 'M1', productCode: 'A' }), null);
  assert.equal(suggestSetup(db, { machineId: 'M9', productCode: 'A' }), null);
  assert.equal(suggestSetup(db, { productCode: 'A' }), null);
});

test('si contano solo le attività completate e con inizio e fine attrezzaggio validi', () => {
  const db = fixture([['M1', 'A', 20], ['M1', 'A', 20], ['M1', 'A', 20, 0, 'run_running']]);
  assert.equal(suggestSetup(db, { machineId: 'M1', productCode: 'A' }), null);
  db.exec("UPDATE execution SET setupEndedAt=setupStartedAt");
  assert.equal(suggestSetup(db, { machineId: 'M1', productCode: 'A' }), null);
});

test('usa solo gli ultimi consuntivi: i tempi recenti prevalgono sui vecchi', () => {
  const rows = Array.from({ length: 25 }, (_, index) => ['M1', 'A', index < 5 ? 120 : 20]);
  const db = fixture(rows);
  // gli ultimi 20 (i più recenti) sono tutti da 20 minuti: i cinque vecchi da 120 non pesano
  assert.deepEqual(suggestSetup(db, { machineId: 'M1', productCode: 'A' }), { minutes: 20, basis: 'article', count: 20 });
});

test('un database senza le colonne dell\'attrezzaggio non genera errori', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE execution(taskId TEXT PRIMARY KEY,phase TEXT,machineId TEXT)');
  assert.equal(suggestSetup(db, { machineId: 'M1', productCode: 'A' }), null);
});
