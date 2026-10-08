import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrateTextile } from './textile.mjs';

const anchor = '2026-10-08T08:00';

function database({ empty = false } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT NOT NULL);
    CREATE TABLE sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id));
    CREATE TABLE machines(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,description TEXT NOT NULL,anchor TEXT NOT NULL);
    CREATE TABLE types(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,color TEXT NOT NULL);
    CREATE TABLE tasks(id TEXT PRIMARY KEY,title TEXT NOT NULL,typeId TEXT NOT NULL REFERENCES types(id),machineId TEXT NOT NULL REFERENCES machines(id),setupMinutes INTEGER NOT NULL,runMinutes INTEGER NOT NULL,status TEXT NOT NULL,position INTEGER,start TEXT,end TEXT,segments TEXT NOT NULL DEFAULT '[]',notes TEXT NOT NULL DEFAULT '');
    INSERT INTO meta VALUES ('revision','7'),('calendar','{"weekly":{},"exceptions":{},"machineExceptions":{}}');
    INSERT INTO users VALUES ('user-1','Utente');
    INSERT INTO sessions VALUES ('session-1','user-1');`);
  if (!empty) {
    db.exec(`INSERT INTO machines VALUES
      ('CNC-01','Centro di lavoro CNC','Fresatura','${anchor}'),
      ('TOR-02','Tornio automatico','Tornitura','${anchor}'),
      ('LAS-03','Taglio laser','Taglio','${anchor}');
      INSERT INTO types VALUES
      ('fresatura','Fresatura','#2563eb'),
      ('tornitura','Tornitura','#0891b2'),
      ('taglio','Taglio','#a855f7');
      INSERT INTO tasks(id,title,typeId,machineId,setupMinutes,runMinutes,status,position,start,end,segments,notes) VALUES
      ('sample-1','Staffa supporto · lotto 240','fresatura','CNC-01',30,180,'planned',0,'2026-10-08T08:00','2026-10-08T11:30','[{"start":"2026-10-08T08:00","end":"2026-10-08T11:30","kind":"run"}]','nota seed'),
      ('sample-2','Piastra di fissaggio · lotto 241','fresatura','CNC-01',45,360,'unplanned',NULL,NULL,NULL,'[]',''),
      ('sample-3','Albero motore · lotto 118','tornitura','TOR-02',20,210,'unplanned',NULL,NULL,NULL,'[]',''),
      ('sample-4','Pannelli laterali · lotto 086','taglio','LAS-03',15,90,'completed',1,'2026-10-07T08:00','2026-10-07T10:00','[{"start":"2026-10-07T08:00","end":"2026-10-07T10:00","kind":"run"}]','storico bloccato'),
      ('custom-1','Attività personalizzata','fresatura','CNC-01',10,95,'unplanned',NULL,NULL,NULL,'[]','non modificare');`);
  }
  return db;
}

test('migra schema e dati, crea 60 attività coerenti e preserva dati operativi', () => {
  const db = database();
  const lockedBefore = db.prepare("SELECT * FROM tasks WHERE id='sample-4'").get();
  const result = migrateTextile(db, anchor);
  assert.equal(result.migrated, true);
  assert.deepEqual(result.machineIds, ['CNC-01', 'TOR-02', 'LAS-03', 'ACC-04']);
  assert.deepEqual(result.typeIds, ['fresatura', 'tornitura', 'taglio', 'textile-polvere']);
  const columns = db.prepare('PRAGMA table_info(tasks)').all();
  for (const name of ['component1Code','component1Description','component2Code','component2Description','productCode','productDescription']) {
    const column = columns.find(item => item.name === name);
    assert.ok(column, name);
    assert.equal(column.notnull, 1);
    assert.equal(column.dflt_value, "''");
  }
  const fixtures = db.prepare("SELECT * FROM tasks WHERE id LIKE 'textile-demo-%' ORDER BY id").all();
  assert.equal(fixtures.length, 60);
  assert.equal(new Set(fixtures.map(item => item.id)).size, 60);
  assert.equal(new Set(fixtures.map(item => item.title)).size, 60);
  assert.deepEqual(fixtures.map(item => item.machineId).reduce((counts, id) => ({...counts, [id]:(counts[id] || 0) + 1}), {}), {'CNC-01':15,'TOR-02':15,'LAS-03':15,'ACC-04':15});
  for (const item of fixtures) {
    assert.equal(item.status, 'unplanned');
    assert.equal(item.position, null);
    assert.equal(item.start, null);
    assert.equal(item.end, null);
    assert.equal(item.segments, '[]');
    assert.ok(item.setupMinutes >= 0 && item.setupMinutes <= 60);
    assert.ok(item.runMinutes >= 90 && item.runMinutes <= 720);
    assert.match(item.notes, /^Dati dimostrativi:/);
    for (const field of ['component1Code','component1Description','component2Code','component2Description','productCode','productDescription']) assert.ok(item[field]);
    assert.ok(db.prepare('SELECT 1 FROM machines WHERE id=?').get(item.machineId));
    assert.ok(db.prepare('SELECT 1 FROM types WHERE id=?').get(item.typeId));
  }
  const converted = db.prepare("SELECT * FROM tasks WHERE id='sample-1'").get();
  assert.match(converted.title, /Rivestimento sedile automotive/);
  assert.equal(converted.setupMinutes, 30);
  assert.equal(converted.runMinutes, 180);
  assert.equal(converted.status, 'planned');
  assert.equal(converted.position, 0);
  assert.equal(converted.start, '2026-10-08T08:00');
  assert.equal(converted.end, '2026-10-08T11:30');
  assert.equal(converted.segments, '[{"start":"2026-10-08T08:00","end":"2026-10-08T11:30","kind":"run"}]');
  assert.equal(converted.notes, 'nota seed');
  const lockedAfter = db.prepare("SELECT id,title,typeId,machineId,setupMinutes,runMinutes,status,position,start,end,segments,notes FROM tasks WHERE id='sample-4'").get();
  assert.deepEqual(lockedAfter, lockedBefore);
  const custom = db.prepare("SELECT * FROM tasks WHERE id='custom-1'").get();
  assert.equal(custom.title, 'Attività personalizzata');
  assert.equal(custom.component1Code, '');
  assert.equal(custom.notes, 'non modificare');
  assert.ok(db.prepare("SELECT 1 FROM users WHERE id='user-1'").get());
  assert.ok(db.prepare("SELECT 1 FROM sessions WHERE token='session-1'").get());
  assert.equal(db.prepare("SELECT value FROM meta WHERE key='calendar'").get().value, '{"weekly":{},"exceptions":{},"machineExceptions":{}}');
  assert.equal(db.prepare("SELECT value FROM meta WHERE key='revision'").get().value, '8');
  assert.equal(db.prepare("SELECT value FROM meta WHERE key='textile-v1'").get().value, '1');
  db.close();
});

test('è idempotente e non ricrea una fixture eliminata dopo la prima migrazione', () => {
  const db = database();
  migrateTextile(db, anchor);
  db.prepare("DELETE FROM tasks WHERE id='textile-demo-001'").run();
  db.prepare("UPDATE tasks SET title='Titolo modificato' WHERE id='textile-demo-002'").run();
  const result = migrateTextile(db, anchor);
  assert.deepEqual(result, { migrated: false });
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE id LIKE 'textile-demo-%'").get().count, 59);
  assert.equal(db.prepare("SELECT title FROM tasks WHERE id='textile-demo-002'").get().title, 'Titolo modificato');
  assert.equal(db.prepare("SELECT value FROM meta WHERE key='revision'").get().value, '8');
  db.close();
});

test('usa entità tessili separate se gli ID storici sono personalizzati e riusa nomi tessili esistenti', () => {
  const db = database();
  db.prepare("UPDATE machines SET name='CNC personalizzata' WHERE id='CNC-01'").run();
  db.prepare("UPDATE types SET name='Tipo personale' WHERE id='fresatura'").run();
  db.prepare("INSERT INTO machines VALUES ('existing-film','ACC-02 · Calandra film/web','Esistente','2025-01-01T08:00')").run();
  db.prepare("INSERT INTO types VALUES ('existing-film-type','Accoppiatura termica film/web','#112233')").run();
  const result = migrateTextile(db, anchor);
  assert.equal(result.machineIds[0], 'ACC-01');
  assert.equal(result.machineIds[1], 'existing-film');
  assert.equal(result.typeIds[0], 'textile-hot-melt');
  assert.equal(result.typeIds[1], 'existing-film-type');
  assert.equal(db.prepare("SELECT name FROM machines WHERE id='CNC-01'").get().name, 'CNC personalizzata');
  assert.equal(db.prepare("SELECT name FROM types WHERE id='fresatura'").get().name, 'Tipo personale');
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE id LIKE 'textile-demo-%' AND machineId='CNC-01'").get().count, 0);
  const scheduled=db.prepare("SELECT machineId,title,status,start,end FROM tasks WHERE id='sample-1'").get();
  assert.equal(scheduled.machineId,'CNC-01','Non trasferire una attività pianificata da una macchina personalizzata');
  assert.equal(scheduled.title,'Staffa supporto · lotto 240');
  assert.equal(scheduled.status,'planned');
  assert.equal(scheduled.start,'2026-10-08T08:00');
  assert.equal(scheduled.end,'2026-10-08T11:30');
  db.close();
});

test('supporta tabelle macchine e tipologie vuote e risolve conflitti sugli ID preferiti', () => {
  const db = database({ empty: true });
  db.prepare("INSERT INTO machines VALUES ('ACC-01','Macchina custom','Non tessile','${anchor}')").run();
  db.prepare("INSERT INTO types VALUES ('textile-hot-melt','Tipo custom','#000000')").run();
  const result = migrateTextile(db, anchor);
  assert.equal(result.machineIds[0], 'textile-acc-01');
  assert.equal(result.typeIds[0], 'textile-textile-hot-melt');
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE id LIKE 'textile-demo-%'").get().count, 60);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM machines").get().count, 5);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM types").get().count, 5);
  db.close();
});
