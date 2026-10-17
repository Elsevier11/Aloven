import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { buildStatisticsReport } from './statistics.mjs';

// Indicatori per il titolare: puntualità, scostamento % tempi previsti/effettivi, confronto col periodo precedente.
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE machines(id TEXT PRIMARY KEY,name TEXT NOT NULL);
    INSERT INTO machines VALUES ('M1','ACC-01'),('M2','ACC-02');
    CREATE TABLE tasks(id TEXT PRIMARY KEY,dueDate TEXT);
    CREATE TABLE execution(
      taskId TEXT PRIMARY KEY,phase TEXT,setupStartedAt TEXT,setupEndedAt TEXT,setupPausedSeconds REAL,
      runEndedAt TEXT,runActiveSeconds REAL,producedQuantity REAL,taskTitle TEXT,machineId TEXT,
      productCode TEXT,productDescription TEXT,productUnit TEXT,scrapQuantity REAL,scrapReason TEXT,
      qualityStatus TEXT,plannedSetupMinutes REAL,plannedRunMinutes REAL,plannedQuantity REAL,scrapReasonCode TEXT
    );
    CREATE TABLE executionEvents(id TEXT PRIMARY KEY,taskId TEXT,action TEXT,at TEXT);
    CREATE TABLE machineStops(id TEXT PRIMARY KEY,machineId TEXT,startedAt TEXT,endedAt TEXT,reason TEXT,reasonCode TEXT);
  `);
  const insert = db.prepare('INSERT INTO execution VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  // id, chiusura, setup effettivo (min), run effettivo (s), run previsto (min), setup previsto (min), consegna
  const rows = [
    ['a', '2026-05-12T10:00:00Z', 30, 3600, 60, 30, '2026-05-12'], // in orario, tempi esatti
    ['b', '2026-05-13T10:00:00Z', 60, 7200, 60, 30, '2026-05-11'], // 2 giorni di ritardo, run +100 %, setup +100 %
    ['c', '2026-05-14T10:00:00Z', 30, 3600, 60, 30, null],         // senza consegna: fuori dalla puntualità
    ['p1', '2026-05-05T10:00:00Z', 30, 3600, 60, 30, '2026-05-06'], // periodo precedente
  ];
  for (const [id, end, setup, runSeconds, plannedRun, plannedSetup, due] of rows) {
    const setupStart = new Date(Date.parse(end) - (runSeconds + setup * 60) * 1000).toISOString();
    const setupEnd = new Date(Date.parse(setupStart) + setup * 60000).toISOString();
    insert.run(id, 'completed', setupStart, setupEnd, 0, end, runSeconds, 100, 'Ordine ' + id, 'M1', 'P', 'Prodotto', 'm', 0, null, 'conforming', plannedSetup, plannedRun, 100, null);
    if (due) db.prepare('INSERT INTO tasks VALUES (?,?)').run(id, due);
  }
  return db;
}

const now = new Date('2026-05-20T10:00:00Z');

test('la puntualità conta solo i consuntivi con consegna e misura i giorni di ritardo', () => {
  const t = buildStatisticsReport(fixture(), { from: '2026-05-10', to: '2026-05-16' }, now).totals;
  assert.equal(t.count, 3);
  assert.equal(t.dueCount, 2);
  assert.equal(t.withoutDueDateCount, 1);
  assert.equal(t.lateCount, 1);
  assert.equal(t.punctualityRate, 0.5);
  assert.equal(t.averageLateDays, 2);
});

test('senza nessuna consegna indicata la puntualità non è calcolabile (null, non 100 %)', () => {
  const db = fixture();
  db.exec('DELETE FROM tasks');
  const t = buildStatisticsReport(db, { from: '2026-05-10', to: '2026-05-16' }, now).totals;
  assert.equal(t.dueCount, 0);
  assert.equal(t.punctualityRate, null);
  assert.equal(t.averageLateDays, null);
});

test('lo scostamento percentuale confronta effettivo e previsto sulle sole coppie complete', () => {
  const t = buildStatisticsReport(fixture(), { from: '2026-05-10', to: '2026-05-16' }, now).totals;
  // previsto 180 min, effettivo 60+120+60 = 240 min → +33,33 %
  assert.equal(t.runDeviationRate, 0.3333);
  // setup previsto 90 min, effettivo 120 min → +33,33 %
  assert.equal(t.setupDeviationRate, 0.3333);
  assert.equal(t.runPairedCount, 3);
});

test('lo scostamento è null quando manca il tempo previsto', () => {
  const db = fixture();
  db.exec('UPDATE execution SET plannedRunMinutes=NULL, plannedSetupMinutes=NULL');
  const t = buildStatisticsReport(db, { from: '2026-05-10', to: '2026-05-16' }, now).totals;
  assert.equal(t.runDeviationRate, null);
  assert.equal(t.setupDeviationRate, null);
});

test('il periodo precedente ha la stessa durata e termina il giorno prima', () => {
  const report = buildStatisticsReport(fixture(), { from: '2026-05-10', to: '2026-05-16' }, now);
  assert.equal(report.previous.from, '2026-05-03');
  assert.equal(report.previous.to, '2026-05-09');
  assert.equal(report.previous.count, 1);
  assert.equal(report.previous.punctualityRate, 1);
  assert.equal(report.previous.runDeviationRate, 0);
  assert.equal(report.previous.quantities[0].goodQuantity, 100);
});

test('senza dati nel periodo precedente il confronto è assente e il calcolo non si ripete', () => {
  const report = buildStatisticsReport(fixture(), { from: '2026-05-03', to: '2026-05-09' }, now);
  assert.equal(report.previous, null);
  const inner = buildStatisticsReport(fixture(), { from: '2026-05-10', to: '2026-05-16' }, now, { withPrevious: false });
  assert.equal(inner.previous, null);
});

test('i dettagli riportano consegna e giorni di ritardo, null se la consegna manca', () => {
  const details = buildStatisticsReport(fixture(), { from: '2026-05-10', to: '2026-05-16' }, now).details;
  const byId = Object.fromEntries(details.map(row => [row.taskId, row]));
  assert.equal(byId.a.lateDays, 0);
  assert.equal(byId.b.lateDays, 2);
  assert.equal(byId.b.dueDate, '2026-05-11');
  assert.equal(byId.c.dueDate, null);
  assert.equal(byId.c.lateDays, null);
});
