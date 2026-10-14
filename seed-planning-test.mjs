// Prepara un database di prova per la pianificazione: 24 attività da pianificare di qualche ora ciascuna,
// per verificare il posizionamento di più attività nello stesso giorno.
//
// Cancella dal database operativo le attività NON completate (da pianificare, pianificate, in corso) e il piano
// rilasciato che le riguarda, poi inserisce le attività di prova. Conserva utenti, macchine, tipologie,
// articoli, calendario, storico delle attività completate e statistiche.
// Prima di scrivere crea una copia di sicurezza consistente in data/backups. Il server deve essere spento.
//
// Uso: node seed-planning-test.mjs        (database in data/, oppure DATA_DIR=...)
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync, existsSync} from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve(process.env.DATA_DIR || 'data');
const dbFile = path.join(dataDir, 'aloven.sqlite');
if (!existsSync(dbFile)) throw new Error(`Database non trovato: ${dbFile}`);
const db = new DatabaseSync(dbFile);
db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=2000;');

try { db.exec('BEGIN IMMEDIATE'); db.exec('ROLLBACK'); }
catch { throw new Error('Il database è in uso: spegni Aloven (chiudi la finestra del server) e riprova.'); }

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = process.env.BACKUP_DIR ? path.resolve(process.env.BACKUP_DIR) : path.join(dataDir, 'backups');
mkdirSync(backupDir, {recursive: true});
const backupFile = path.join(backupDir, `aloven-before-planning-test-${stamp}.sqlite`);
db.exec(`VACUUM INTO '${backupFile.replace(/'/g, "''")}'`);

const rome = new Intl.DateTimeFormat('en-CA', {timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit'});
const addDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const today = rome.format(new Date());

const machines = db.prepare('SELECT id,speed FROM machines ORDER BY rowid').all();
const typeByMachine = {'CNC-01': 'fresatura', 'TOR-02': 'tornitura', 'LAS-03': 'taglio', 'ACC-04': 'textile-polvere'};
const alternatives = {'CNC-01': 'TOR-02', 'TOR-02': 'CNC-01', 'LAS-03': 'ACC-04', 'ACC-04': 'LAS-03'};
const customers = ['Arredo Design Srl', 'Tessitura Moretti', 'Auto Interni SpA', 'Outdoor Italia', 'Casa Luce Srl', 'Nautica Adriatica'];
// [setup, run] in minuti: da circa 1h45 a 5h, più un'attività lunga (oltre un turno) per macchina
const shapes = [[30, 120], [20, 150], [45, 210], [25, 90], [30, 180], [40, 270]];
const longRun = {'LAS-03': 420, 'ACC-04': 540};

const triplesByType = new Map();
for (const row of db.prepare(`SELECT DISTINCT typeId,component1ArticleId c1,component1Code k1,component1Description d1,
    component2ArticleId c2,component2Code k2,component2Description d2,productArticleId p,productCode pk,productDescription pd
  FROM tasks WHERE component1ArticleId IS NOT NULL AND component2ArticleId IS NOT NULL AND productArticleId IS NOT NULL ORDER BY typeId,productCode`).all()) {
  if (!triplesByType.has(row.typeId)) triplesByType.set(row.typeId, []);
  triplesByType.get(row.typeId).push(row);
}

db.exec('BEGIN IMMEDIATE');
try {
  const removable = db.prepare("SELECT id FROM tasks WHERE status<>'completed'").all().map(r => r.id);
  for (const id of removable) {
    for (const table of ['executionEvents', 'executionLots', 'execution', 'executionInterruptionRequests', 'qualityDecisions', 'setupResumeEvents'])
      try { db.prepare(`DELETE FROM ${table} WHERE taskId=?`).run(id); } catch { /* tabella senza taskId */ }
    db.prepare('DELETE FROM tasks WHERE id=?').run(id);
  }
  db.prepare("UPDATE meta SET value='[]' WHERE key='releasedMaintenanceBlocks'").run();

  const insert = db.prepare(`INSERT INTO tasks(id,title,typeId,machineId,setupMinutes,runMinutes,status,notes,
    component1Code,component1Description,component2Code,component2Description,productCode,productDescription,quantity,calculationMode,
    component1ArticleId,component2ArticleId,productArticleId,outputLot,orderReference,customer,dueDate,compatibleMachineIds)
    VALUES (?,?,?,?,?,?,'unplanned',?,?,?,?,?,?,?,?,'manual',?,?,?,?,?,?,?,?)`);
  let n = 0;
  for (const machine of machines) {
    const typeId = typeByMachine[machine.id], triples = triplesByType.get(typeId) || [];
    if (!triples.length) throw new Error(`Nessun articolo di esempio per la macchina ${machine.id}`);
    shapes.forEach(([setup, run], i) => {
      n++;
      const t = triples[(i * 7 + n) % triples.length], runMinutes = i === 5 && longRun[machine.id] ? longRun[machine.id] : run;
      const num = String(n).padStart(2, '0');
      const compatible = i < 2 || (i === 2 && ['LAS-03', 'ACC-04'].includes(machine.id)) ? [machine.id, alternatives[machine.id]] : [machine.id];
      insert.run(`prova-${num}`, `PROVA ${num} · ${t.pd} · lotto TP-${num}`, typeId, machine.id, setup, runMinutes,
        'Dati di prova per la pianificazione: tempi illustrativi.', t.k1, t.d1, t.k2, t.d2, t.pk, t.pd, runMinutes * machine.speed,
        t.c1, t.c2, t.p, `TP-${num}`, `OC-T${num}`, customers[n % customers.length], n % 2 ? addDays(today, 1 + (n % 7)) : null,
        JSON.stringify(compatible));
    });
  }
  db.prepare("UPDATE meta SET value=CAST(CAST(value AS INTEGER)+1 AS TEXT) WHERE key='revision'").run();
  const violations = db.prepare('PRAGMA foreign_key_check').all();
  if (violations.length) throw new Error(`Relazioni non valide: ${JSON.stringify(violations.slice(0, 3))}`);
  db.exec('COMMIT');
  console.log(`Tolte ${removable.length} attività non completate; inserite ${n} attività di prova.`);
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}
const check = db.prepare('PRAGMA integrity_check').get();
console.log(`Copia di sicurezza: ${backupFile}\nIntegrità database: ${Object.values(check)[0]}`);
db.close();
