import test from 'node:test';
import assert from 'node:assert/strict';
import * as sqlite from 'node:sqlite';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  assertSupportedNodeRuntime,
  backupConfig,
  createConsistentBackup,
  restoreBackup,
  startBackupSchedule,
  testRestore,
  verifyDatabase,
} from './backup.mjs';
import { runBackupCli } from './backup-cli.mjs';

const { DatabaseSync } = sqlite;

function temporaryDirectory(name) {
  return mkdtempSync(path.join(tmpdir(), name));
}

function openFixture(file) {
  const database = new DatabaseSync(file);
  database.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE parents(id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE children(id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parents(id), value TEXT NOT NULL);
    INSERT INTO parents VALUES (1, 'origine');
    INSERT INTO children VALUES (1, 1, 'prima');`);
  return database;
}

test('configurazione e runtime hanno default sicuri e validazione esplicita', () => {
  assert.doesNotThrow(() => assertSupportedNodeRuntime('22.13.0'));
  assert.throws(() => assertSupportedNodeRuntime('22.12.0'), />=22\.13/);
  const config = backupConfig({}, { dataDir: path.join('area', 'dati') });
  assert.equal(config.intervalHours, 24);
  assert.equal(config.retention, 14);
  assert.equal(config.backupDir, path.resolve('area', 'dati', 'backups'));
  assert.throws(() => backupConfig({ BACKUP_INTERVAL_HOURS: 'zero' }), /maggiore di zero/);
  assert.throws(() => backupConfig({ BACKUP_RETENTION: '1.5' }), /intero positivo/);
});

test('snapshot consistente con database WAL live conserva le modifiche operative', async t => {
  const root = temporaryDirectory('aloven-backup-live-');
  const sourceFile = path.join(root, 'source.sqlite');
  const db = openFixture(sourceFile);
  const writer = new DatabaseSync(sourceFile);
  writer.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON');
  let copy;
  t.after(() => { copy?.close(); writer.close(); db.close(); rmSync(root, { recursive: true, force: true }); });
  for (let index = 2; index <= 2_000; index += 1) db.prepare('INSERT INTO children VALUES (?, 1, ?)').run(index, `riga-${index}-${'x'.repeat(500)}`);
  let wroteDuringBackup = false;
  const result = await createConsistentBackup(db, {
    backupDir: path.join(root, 'backups'),
    sqliteBackup: (source, destination) => sqlite.backup(source, destination, {
      rate: 1,
      progress() {
        if (!wroteDuringBackup) {
          writer.prepare('INSERT INTO children VALUES (?, 1, ?)').run(3_000, 'scritta durante il backup');
          wroteDuringBackup = true;
        }
      },
    }),
  });
  assert.equal(wroteDuringBackup, true);
  assert.equal(db.prepare('SELECT value FROM children WHERE id=3000').get().value, 'scritta durante il backup');
  assert.equal(verifyDatabase(result.file).integrity, 'ok');
  copy = new DatabaseSync(result.file, { readOnly: true });
  const count = copy.prepare('SELECT count(*) AS count FROM children').get().count;
  assert.ok(count === 2_000 || count === 2_001, `snapshot inatteso: ${count} righe`);
  assert.equal(copy.prepare('SELECT name FROM parents WHERE id=1').get().name, 'origine');
});

test('verifica rifiuta file corrotti e violazioni delle chiavi esterne', t => {
  const root = temporaryDirectory('aloven-backup-invalid-');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const corrupt = path.join(root, 'corrupt.sqlite');
  writeFileSync(corrupt, Buffer.from('non è sqlite'));
  assert.throws(() => verifyDatabase(corrupt), /non valido/);

  const broken = path.join(root, 'broken.sqlite');
  const db = new DatabaseSync(broken);
  db.exec('PRAGMA foreign_keys=OFF; CREATE TABLE p(id INTEGER PRIMARY KEY); CREATE TABLE c(pid INTEGER REFERENCES p(id)); INSERT INTO c VALUES (99);');
  db.close();
  assert.throws(() => verifyDatabase(broken), /chiavi esterne/);
});

test('ripristino crea una nuova directory, non sovrascrive e conserva esattamente le righe', async t => {
  const root = temporaryDirectory('aloven-backup-restore-');
  const db = openFixture(path.join(root, 'source.sqlite'));
  t.after(() => { db.close(); rmSync(root, { recursive: true, force: true }); });
  db.exec("INSERT INTO children VALUES (2, 1, 'seconda')");
  const backup = await createConsistentBackup(db, { backupDir: path.join(root, 'backups') });
  assert.throws(() => restoreBackup(backup.file), /--stopped/);
  const targetDir = path.join(root, 'nuovo-ripristino');
  const restored = restoreBackup(backup.file, { stopped: true, targetDir });
  const copy = new DatabaseSync(restored.target, { readOnly: true });
  assert.deepEqual(copy.prepare('SELECT * FROM children ORDER BY id').all(), db.prepare('SELECT * FROM children ORDER BY id').all());
  copy.close();
  assert.throws(() => restoreBackup(backup.file, { stopped: true, targetDir }), /esiste già/);
  assert.equal(runBackupCli(['verify', backup.file]).integrity, 'ok');
  assert.throws(() => runBackupCli(['restore', backup.file]), /--stopped/);
});

test('prova di ripristino usa una directory temporanea dedicata e la rimuove', async t => {
  const root = temporaryDirectory('aloven-backup-restore-test-');
  const db = openFixture(path.join(root, 'source.sqlite'));
  t.after(() => { db.close(); rmSync(root, { recursive: true, force: true }); });
  const backupDir = path.join(root, 'backups');
  const backup = await createConsistentBackup(db, { backupDir });
  const result = testRestore(backup.file, { tempRoot: backupDir });
  assert.equal(result.integrity, 'ok');
  assert.equal(result.cleaned, true);
  assert.equal(existsSync(result.temporaryDirectory), false);
});

test('retention elimina solo backup riconosciuti e preserva file estranei', async t => {
  const root = temporaryDirectory('aloven-backup-retention-');
  const db = openFixture(path.join(root, 'source.sqlite'));
  t.after(() => { db.close(); rmSync(root, { recursive: true, force: true }); });
  const backupDir = path.join(root, 'backups');
  await createConsistentBackup(db, { backupDir, retention: 2, now: new Date('2026-10-08T10:00:00.000Z') });
  writeFileSync(path.join(backupDir, 'note-importanti.txt'), 'conservare');
  writeFileSync(path.join(backupDir, 'aloven-before-history-123.sqlite'), 'conservare');
  await createConsistentBackup(db, { backupDir, retention: 2, now: new Date('2026-10-09T10:00:00.000Z') });
  await createConsistentBackup(db, { backupDir, retention: 2, now: new Date('2026-10-10T10:00:00.000Z') });
  const files = readdirSync(backupDir).sort();
  assert.equal(files.filter(name => /^aloven-backup-/.test(name)).length, 2);
  assert.equal(readFileSync(path.join(backupDir, 'note-importanti.txt'), 'utf8'), 'conservare');
  assert.equal(readFileSync(path.join(backupDir, 'aloven-before-history-123.sqlite'), 'utf8'), 'conservare');
});

test('scheduler espone il fallimento, scrive su stderr logico e ritenta senza tenere vivo il processo', async t => {
  const root = temporaryDirectory('aloven-backup-schedule-');
  const db = openFixture(path.join(root, 'source.sqlite'));
  const errors = [];
  let attempts = 0;
  const scheduler = startBackupSchedule(db, {
    backupDir: path.join(root, 'backups'),
    intervalHours: 1,
    retryDelayMs: 10,
    restoreTest: false,
    logger: { error: (...values) => errors.push(values) },
    createBackup: async () => {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error('disco non disponibile'), { code: 'EIO' });
      return { file: path.join(root, 'backups', 'success.sqlite'), createdAt: '2026-10-11T10:00:00.000Z' };
    },
  });
  t.after(() => { scheduler.stop(); db.close(); rmSync(root, { recursive: true, force: true }); });
  await assert.rejects(scheduler.runNow(), /disco non disponibile/);
  const failed = scheduler.getStatus();
  assert.equal(failed.lastError.code, 'EIO');
  assert.match(failed.lastError.message, /disco/);
  assert.ok(failed.lastFailureAt);
  assert.ok(failed.nextAt);
  assert.equal(errors.length, 1);
  await new Promise(resolve => setTimeout(resolve, 40));
  const recovered = scheduler.getStatus();
  assert.ok(attempts >= 2);
  assert.equal(recovered.lastError, null);
  assert.equal(recovered.lastSuccessAt, '2026-10-11T10:00:00.000Z');
  assert.equal(recovered.targetDirectory, path.resolve(root, 'backups'));
});
