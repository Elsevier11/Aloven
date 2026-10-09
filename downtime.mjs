const ACTIONS = ['stop', 'resume'];

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function revision(db) {
  return Number(db.prepare("SELECT value FROM meta WHERE key='revision'").get()?.value);
}

/** Creates the unexpected machine-stop schema once, without physical references to rewritten planning tables. */
export function migrateDowntime(db) {
  if (!db || typeof db.exec !== 'function' || typeof db.prepare !== 'function') throw new TypeError('Database SQLite non valido.');
  db.exec('BEGIN IMMEDIATE');
  try {
    if (db.prepare("SELECT 1 FROM meta WHERE key='downtime-v1'").get()) {
      db.exec('COMMIT');
      return {migrated:false};
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS machineStops(
        id TEXT PRIMARY KEY,
        machineId TEXT NOT NULL,
        startedAt TEXT NOT NULL,
        endedAt TEXT,
        reason TEXT NOT NULL,
        userId TEXT NOT NULL,
        userName TEXT NOT NULL,
        endedByUserId TEXT,
        endedByUserName TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS machineStops_one_active_per_machine
        ON machineStops(machineId) WHERE endedAt IS NULL;
      CREATE INDEX IF NOT EXISTS machineStops_machine_started
        ON machineStops(machineId,startedAt,id);
    `);
    db.prepare("INSERT INTO meta(key,value) VALUES ('downtime-v1','1')").run();
    db.prepare("INSERT INTO meta(key,value) VALUES ('revision','1') ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1").run();
    db.exec('COMMIT');
    return {migrated:true};
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function machineStops(db) {
  return db.prepare('SELECT * FROM machineStops ORDER BY startedAt DESC,rowid DESC').all();
}

export function performMachineStopAction(db, payload, user, makeId, now = new Date().toISOString()) {
  if (!payload || !ACTIONS.includes(payload.action)) fail('Azione fermo macchina non valida.');
  if (typeof payload.machineId !== 'string' || !payload.machineId) fail('Macchina non valida.');
  if (!Number.isInteger(payload.revision)) fail('Revisione non valida.');
  if (!user?.id || !user?.name) fail('Utente non valido.');
  if (typeof makeId !== 'function') throw new TypeError('Generatore identificativi non valido.');

  db.exec('BEGIN IMMEDIATE');
  try {
    if (revision(db) !== payload.revision) fail('I dati sono cambiati. Aggiorna la pagina e riprova.',409);
    if (!db.prepare('SELECT 1 FROM machines WHERE id=?').get(payload.machineId)) fail('Macchina non trovata.',404);
    const activeStop = db.prepare('SELECT * FROM machineStops WHERE machineId=? AND endedAt IS NULL').get(payload.machineId);

    if (payload.action === 'stop') {
      if (typeof payload.reasonId !== 'string' || !payload.reasonId) fail('Seleziona una causale di fermo macchina attiva.');
      const selectedReason = db.prepare('SELECT id,code,description FROM machineStopReasons WHERE id=? AND active=1').get(payload.reasonId);
      if (!selectedReason) fail('Seleziona una causale di fermo macchina attiva.');
      const reason = selectedReason.description;
      if (activeStop) fail('La macchina è già ferma.',409);
      const execution = db.prepare("SELECT * FROM execution WHERE machineId=? AND phase IN ('setup_running','run_running') LIMIT 1").get(payload.machineId);
      if (execution?.phase === 'setup_running') {
        fail('Termina prima l’attrezzaggio in corso: l’attrezzaggio non può essere interrotto.');
      }
      if (execution?.phase === 'run_running') {
        const start = Date.parse(execution.lastRunStartedAt), end = Date.parse(now);
        const elapsed = Number.isFinite(start) && Number.isFinite(end) && end >= start ? (end - start) / 1000 : 0;
        db.prepare("UPDATE execution SET phase='run_paused',runActiveSeconds=runActiveSeconds+?,lastRunStartedAt=NULL WHERE taskId=?").run(elapsed,execution.taskId);
        db.prepare('INSERT INTO executionEvents(id,taskId,action,at,userId,userName,reason) VALUES (?,?,?,?,?,?,?)')
          .run(makeId(),execution.taskId,'pause_run',now,user.id,user.name,`Fermo macchina: ${reason}`);
      }
      db.prepare('INSERT INTO machineStops(id,machineId,startedAt,endedAt,reason,userId,userName,endedByUserId,endedByUserName,reasonId,reasonCode) VALUES (?,?,?,NULL,?,?,?,?,NULL,?,?)')
        .run(makeId(),payload.machineId,now,reason,user.id,user.name,null,selectedReason.id,selectedReason.code);
    } else {
      if (!activeStop) fail('La macchina non risulta ferma.',409);
      db.prepare('UPDATE machineStops SET endedAt=?,endedByUserId=?,endedByUserName=? WHERE id=?')
        .run(now,user.id,user.name,activeStop.id);
    }

    db.prepare("UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'").run();
    db.exec('COMMIT');
    return {ok:true};
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
