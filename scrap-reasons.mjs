const CATALOGS = {
  scrap: {
    table: 'scrapReasons',
    usageTable: 'execution',
    usageColumn: 'scrapReasonId',
    label: 'causale di scarto',
  },
  machineStop: {
    table: 'machineStopReasons',
    usageTable: 'machineStops',
    usageColumn: 'reasonId',
    label: 'causale di fermo macchina',
  },
};

const SCRAP_SEEDS = [
  ['scrap-setup','setup','Attrezzaggio','Setup'],
  ['scrap-adhesion','adhesion','Adesione','Adhesion'],
  ['scrap-folds','folds','Pieghe','Folds'],
  ['scrap-fabric-defect','fabric-defect','Difetto tessuto','Fabric defect'],
  ['scrap-cutting','cutting','Taglio','Cutting'],
  ['scrap-other','other','Altro','Other'],
];

const MACHINE_STOP_SEEDS = [
  ['machine-stop-breakdown','breakdown','Guasto','Breakdown'],
  ['machine-stop-maintenance','maintenance','Manutenzione','Maintenance'],
  ['machine-stop-materials','materials','Materiali','Materials'],
  ['machine-stop-roll-change','roll-change','Cambio bobina','Roll change'],
  ['machine-stop-shift-end','shift-end','Fine turno','End of shift'],
  ['machine-stop-other','other','Altro','Other'],
];

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function cleanText(value, label, maximum, required = true) {
  if (value === undefined || value === null || value === '') {
    if (required) fail(`${label}: inserisci un valore valido (massimo ${maximum} caratteri).`);
    return null;
  }
  if (typeof value !== 'string') fail(`${label}: inserisci un valore valido (massimo ${maximum} caratteri).`);
  const clean = value.trim();
  if ((!clean && required) || clean.length > maximum) fail(`${label}: inserisci un valore valido (massimo ${maximum} caratteri).`);
  return clean || null;
}

/** Creates both reason catalogs and the immutable execution/stop snapshot columns atomically. */
export function migrateReasonCatalogs(db) {
  if (!db || typeof db.exec !== 'function' || typeof db.prepare !== 'function') throw new TypeError('Database SQLite non valido.');
  db.exec('BEGIN IMMEDIATE');
  try {
    if (db.prepare("SELECT 1 FROM meta WHERE key='reason-catalogs-v1'").get()) {
      db.exec('COMMIT');
      return {migrated:false};
    }
    db.exec(`
      CREATE TABLE scrapReasons(
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL COLLATE NOCASE UNIQUE,
        description TEXT NOT NULL,
        descriptionEn TEXT NOT NULL,
        active INTEGER NOT NULL CHECK(active IN (0,1))
      );
      CREATE TABLE machineStopReasons(
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL COLLATE NOCASE UNIQUE,
        description TEXT NOT NULL,
        descriptionEn TEXT NOT NULL,
        active INTEGER NOT NULL CHECK(active IN (0,1))
      );
      ALTER TABLE execution ADD COLUMN scrapReasonId TEXT;
      ALTER TABLE execution ADD COLUMN scrapReasonCode TEXT;
      ALTER TABLE machineStops ADD COLUMN reasonId TEXT;
      ALTER TABLE machineStops ADD COLUMN reasonCode TEXT;
    `);
    const scrapInsert = db.prepare('INSERT INTO scrapReasons(id,code,description,descriptionEn,active) VALUES (?,?,?,?,1)');
    for (const seed of SCRAP_SEEDS) scrapInsert.run(...seed);
    const stopInsert = db.prepare('INSERT INTO machineStopReasons(id,code,description,descriptionEn,active) VALUES (?,?,?,?,1)');
    for (const seed of MACHINE_STOP_SEEDS) stopInsert.run(...seed);
    db.prepare("INSERT INTO meta(key,value) VALUES ('reason-catalogs-v1','1')").run();
    db.prepare("INSERT INTO meta(key,value) VALUES ('revision','1') ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1").run();
    db.exec('COMMIT');
    return {migrated:true};
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function reasonCatalog(db, kind) {
  const config = CATALOGS[kind];
  if (!config) throw new TypeError('Catalogo causali non valido.');
  return db.prepare(`SELECT id,code,description,descriptionEn,active FROM ${config.table} ORDER BY description COLLATE NOCASE`)
    .all().map(row => ({...row, active:Boolean(row.active)}));
}

/** Performs an admin catalog mutation with optimistic revision control. */
export function updateReasonCatalog(db, kind, payload, makeId) {
  const config = CATALOGS[kind];
  if (!config) throw new TypeError('Catalogo causali non valido.');
  if (!payload || !Number.isInteger(payload.revision)) fail('Revisione non valida.');
  if (typeof makeId !== 'function') throw new TypeError('Generatore identificativi non valido.');
  db.exec('BEGIN IMMEDIATE');
  try {
    const currentRevision = Number(db.prepare("SELECT value FROM meta WHERE key='revision'").get()?.value);
    if (currentRevision !== payload.revision) fail('I dati sono cambiati. Aggiorna la pagina e riprova.',409);
    const existing = payload.id ? db.prepare(`SELECT * FROM ${config.table} WHERE id=?`).get(payload.id) : null;
    if (payload.id && !existing) fail('Causale non trovata.',404);
    if (payload.remove) {
      if (!existing) fail('Causale non trovata.',404);
      if (db.prepare(`SELECT 1 FROM ${config.usageTable} WHERE ${config.usageColumn}=? LIMIT 1`).get(existing.id)) {
        fail(`La ${config.label} è già utilizzata. Disattivala invece di eliminarla.`);
      }
      db.prepare(`DELETE FROM ${config.table} WHERE id=?`).run(existing.id);
    } else {
      const code = cleanText(payload.code, 'Codice', 40);
      const description = cleanText(payload.description, 'Descrizione', 200);
      const descriptionEn = cleanText(payload.descriptionEn, 'Descrizione inglese', 200, false) ?? description;
      if (typeof payload.active !== 'boolean') fail('Stato della causale non valido.');
      if (db.prepare(`SELECT id FROM ${config.table} WHERE code=? COLLATE NOCASE AND id<>?`).get(code,existing?.id ?? '')) {
        fail('Esiste già una causale con questo codice.');
      }
      if (existing) {
        db.prepare(`UPDATE ${config.table} SET code=?,description=?,descriptionEn=?,active=? WHERE id=?`)
          .run(code,description,descriptionEn,payload.active ? 1 : 0,existing.id);
      } else {
        db.prepare(`INSERT INTO ${config.table}(id,code,description,descriptionEn,active) VALUES (?,?,?,?,?)`)
          .run(makeId(),code,description,descriptionEn,payload.active ? 1 : 0);
      }
    }
    db.prepare("UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'").run();
    db.exec('COMMIT');
    return {ok:true};
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
