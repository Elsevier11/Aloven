import { executionMetrics, validateFinishDeclaration } from './quality.mjs';

const ACTIONS = ['start_setup','finish_setup','start_run','pause_run','resume_run','finish_run'];

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function revision(db) {
  return Number(db.prepare("SELECT value FROM meta WHERE key='revision'").get()?.value);
}

function elapsedSeconds(from, to) {
  if (!from) return 0;
  const start = Date.parse(from), end = Date.parse(to);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? (end - start) / 1000 : 0;
}

function cleanReason(value, required = false) {
  if (value === undefined || value === null || value === '') {
    if (required) fail('Inserisci una motivazione.');
    return null;
  }
  if (typeof value !== 'string' || !value.trim() || value.length > 500) fail('Motivazione non valida (massimo 500 caratteri).');
  return value.trim();
}

function snapshotForTask(db, task) {
  const article = db.prepare('SELECT id,unit FROM articles WHERE id=?');
  const component1 = task.component1ArticleId ? article.get(task.component1ArticleId) : null;
  const component2 = task.component2ArticleId ? article.get(task.component2ArticleId) : null;
  const product = task.productArticleId ? article.get(task.productArticleId) : null;
  if (!component1 || !component2 || !product) fail('L’attività deve avere due componenti e un prodotto con unità valide.');
  return {
    taskTitle: task.title,
    machineId: task.machineId,
    component1Code: task.component1Code,
    component1Description: task.component1Description,
    component1Unit: component1.unit,
    component2Code: task.component2Code,
    component2Description: task.component2Description,
    component2Unit: component2.unit,
    productCode: task.productCode,
    productDescription: task.productDescription,
    productUnit: product.unit,
  };
}

function ensureCanLockTask(db, task) {
  if (db.prepare('SELECT 1 FROM machineStops WHERE machineId=? AND endedAt IS NULL').get(task.machineId)) {
    fail('La macchina è ferma. Registra la ripresa della macchina prima di avviare l’attività.',409);
  }
  if (task.position === null) fail('L’attività deve essere pianificata prima di iniziare.');
  const earlier = db.prepare("SELECT 1 FROM tasks WHERE machineId=? AND position IS NOT NULL AND position<? AND status<>'completed' LIMIT 1").get(task.machineId, task.position);
  if (earlier) fail('Completa prima le attività precedenti della macchina.');
  const active = db.prepare("SELECT id FROM tasks WHERE machineId=? AND status='in_progress' AND id<>? LIMIT 1").get(task.machineId, task.id);
  if (active) fail('La macchina ha già un’attività in corso.');
  if (!['planned','in_progress'].includes(task.status)) fail('Questa attività non può essere avviata.');
}

function createExecution(db, task, phase, now) {
  const value = snapshotForTask(db, task);
  db.prepare(`INSERT INTO execution(
    taskId,phase,setupStartedAt,setupEndedAt,runStartedAt,runEndedAt,runActiveSeconds,lastRunStartedAt,producedQuantity,
    taskTitle,machineId,component1Code,component1Description,component1Unit,component2Code,component2Description,component2Unit,productCode,productDescription,productUnit,
    plannedSetupMinutes,plannedRunMinutes,plannedQuantity
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    task.id, phase,
    phase === 'setup_running' ? now : null, null,
    phase === 'run_running' ? now : null, null, 0,
    phase === 'run_running' ? now : null, null,
    value.taskTitle, value.machineId,
    value.component1Code, value.component1Description, value.component1Unit,
    value.component2Code, value.component2Description, value.component2Unit,
    value.productCode, value.productDescription, value.productUnit,
    task.effectiveSetupMinutes ?? task.setupMinutes, task.runMinutes, task.quantity ?? null,
  );
  db.prepare("UPDATE tasks SET status='in_progress' WHERE id=?").run(task.id);
  return db.prepare('SELECT * FROM execution WHERE taskId=?').get(task.id);
}

/** Creates the machine execution schema once. The marker and revision update are atomic. */
export function migrateShopfloor(db) {
  if (!db || typeof db.exec !== 'function' || typeof db.prepare !== 'function') throw new TypeError('Database SQLite non valido.');
  db.exec('BEGIN IMMEDIATE');
  try {
    if (db.prepare("SELECT 1 FROM meta WHERE key='shopfloor-v1'").get()) {
      db.exec('COMMIT');
      return {migrated:false};
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS execution(
        taskId TEXT PRIMARY KEY,
        phase TEXT NOT NULL CHECK(phase IN ('setup_running','setup_done','run_running','run_paused','completed')),
        setupStartedAt TEXT, setupEndedAt TEXT, runStartedAt TEXT, runEndedAt TEXT,
        runActiveSeconds REAL NOT NULL DEFAULT 0 CHECK(runActiveSeconds >= 0),
        lastRunStartedAt TEXT, producedQuantity REAL,
        taskTitle TEXT NOT NULL, machineId TEXT NOT NULL,
        component1Code TEXT NOT NULL, component1Description TEXT NOT NULL, component1Unit TEXT NOT NULL,
        component2Code TEXT NOT NULL, component2Description TEXT NOT NULL, component2Unit TEXT NOT NULL,
        productCode TEXT NOT NULL, productDescription TEXT NOT NULL, productUnit TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS executionEvents(
        id TEXT PRIMARY KEY, taskId TEXT NOT NULL,
        action TEXT NOT NULL CHECK(action IN ('start_setup','finish_setup','start_run','pause_run','resume_run','finish_run')),
        at TEXT NOT NULL, userId TEXT NOT NULL, userName TEXT NOT NULL, reason TEXT
      );
      CREATE INDEX IF NOT EXISTS executionEvents_task_at ON executionEvents(taskId,at,id);
      CREATE TABLE IF NOT EXISTS executionLots(
        id TEXT PRIMARY KEY, taskId TEXT NOT NULL,
        component TEXT NOT NULL CHECK(component IN ('component1','component2')),
        articleCode TEXT NOT NULL, lot TEXT NOT NULL COLLATE NOCASE,
        quantity REAL NOT NULL CHECK(quantity > 0), unit TEXT NOT NULL,
        UNIQUE(taskId,component,lot)
      );
      CREATE INDEX IF NOT EXISTS executionLots_task ON executionLots(taskId,id);
    `);
    db.prepare("INSERT INTO meta(key,value) VALUES ('shopfloor-v1','1')").run();
    db.prepare("INSERT INTO meta(key,value) VALUES ('revision','1') ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1").run();
    db.exec('COMMIT');
    return {migrated:true};
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function shopfloorExecutions(db, at = new Date().toISOString()) {
  const events = db.prepare('SELECT * FROM executionEvents ORDER BY rowid').all();
  const lots = db.prepare('SELECT * FROM executionLots ORDER BY rowid').all();
  const byTask = (rows, taskId) => rows.filter(row => row.taskId === taskId);
  return db.prepare('SELECT * FROM execution ORDER BY taskId').all().map(execution => {
    const metrics = executionMetrics(execution, at);
    return {
      ...execution,
      qualityChecks: execution.qualityChecks === null ? null : JSON.parse(execution.qualityChecks),
      setupActualSeconds: metrics.actualSetupSeconds,
      runActualSeconds: metrics.actualRunSeconds,
      metrics,
      events: byTask(events, execution.taskId),
      lots: byTask(lots, execution.taskId),
    };
  });
}

export function performShopfloorAction(db, payload, user, makeId, now = new Date().toISOString()) {
  if (!payload || !ACTIONS.includes(payload.action)) fail('Azione di reparto non valida.');
  if (typeof payload.taskId !== 'string' || !payload.taskId) fail('Attività non valida.');
  if (!Number.isInteger(payload.revision)) fail('Revisione non valida.');
  if (!user?.id || !user?.name) fail('Utente non valido.');
  if (typeof makeId !== 'function') throw new TypeError('Generatore identificativi non valido.');

  db.exec('BEGIN IMMEDIATE');
  try {
    if (revision(db) !== payload.revision) fail('I dati sono cambiati. Aggiorna la pagina e riprova.',409);
    const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(payload.taskId);
    if (!task) fail('Attività non trovata.');
    let execution = db.prepare('SELECT * FROM execution WHERE taskId=?').get(task.id);
    let reason = cleanReason(payload.reason);
    const machineStopped = db.prepare('SELECT 1 FROM machineStops WHERE machineId=? AND endedAt IS NULL').get(task.machineId);

    if (machineStopped && ['start_setup','start_run','resume_run'].includes(payload.action)) {
      fail('La macchina è ferma. Registra la ripresa della macchina prima di continuare.',409);
    }

    if (payload.action === 'start_setup') {
      if (execution) fail('L’attrezzaggio è già stato avviato.',409);
      ensureCanLockTask(db, task);
      execution = createExecution(db, task, 'setup_running', now);
    } else if (payload.action === 'finish_setup') {
      if (!execution || execution.phase !== 'setup_running') fail('L’attrezzaggio non è in corso.',409);
      db.prepare("UPDATE execution SET phase='setup_done',setupEndedAt=? WHERE taskId=?").run(now,task.id);
    } else if (payload.action === 'start_run') {
      if (!execution) {
        ensureCanLockTask(db, task);
        if ((task.effectiveSetupMinutes ?? task.setupMinutes) !== 0) fail('Completa prima l’attrezzaggio.');
        execution = createExecution(db, task, 'run_running', now);
      } else {
        if (execution.phase !== 'setup_done') fail('L’esecuzione non può essere avviata in questo stato.',409);
        db.prepare("UPDATE execution SET phase='run_running',runStartedAt=?,lastRunStartedAt=? WHERE taskId=?").run(now,now,task.id);
      }
    } else if (payload.action === 'pause_run') {
      reason = cleanReason(payload.reason,true);
      if (!execution || execution.phase !== 'run_running') fail('L’esecuzione non è in corso.',409);
      const total = execution.runActiveSeconds + elapsedSeconds(execution.lastRunStartedAt,now);
      db.prepare("UPDATE execution SET phase='run_paused',runActiveSeconds=?,lastRunStartedAt=NULL WHERE taskId=?").run(total,task.id);
    } else if (payload.action === 'resume_run') {
      if (!execution || execution.phase !== 'run_paused') fail('L’esecuzione non è in pausa.',409);
      db.prepare("UPDATE execution SET phase='run_running',lastRunStartedAt=? WHERE taskId=?").run(now,task.id);
    } else {
      if (!execution || !['run_running','run_paused'].includes(execution.phase)) fail('L’esecuzione non può essere completata in questo stato.',409);
      const declaration = validateFinishDeclaration(payload,execution); reason = cleanReason(payload.reason,declaration.goodQuantity === 0);
      const scrapReason = declaration.scrapQuantity > 0
        ? db.prepare('SELECT id,code,description FROM scrapReasons WHERE id=? AND active=1').get(declaration.scrapReasonId)
        : null;
      if (declaration.scrapQuantity > 0 && !scrapReason) fail('Seleziona una causale di scarto attiva.');
      const total = execution.runActiveSeconds + (execution.phase === 'run_running' ? elapsedSeconds(execution.lastRunStartedAt,now) : 0);
      const insert = db.prepare('INSERT INTO executionLots(id,taskId,component,articleCode,lot,quantity,unit,barcode) VALUES (?,?,?,?,?,?,?,?)');
      for (const lot of declaration.lots) {
        const prefix = lot.component;
        insert.run(makeId(),task.id,lot.component,execution[`${prefix}Code`],lot.lot,lot.quantity,execution[`${prefix}Unit`],lot.barcode);
      }
      db.prepare("UPDATE execution SET phase='completed',runEndedAt=?,runActiveSeconds=?,lastRunStartedAt=NULL,producedQuantity=?,scrapQuantity=?,scrapReason=?,scrapReasonId=?,scrapReasonCode=?,qualityStatus=?,qualityNotes=?,qualityChecks=? WHERE taskId=?").run(now,total,declaration.goodQuantity,declaration.scrapQuantity,scrapReason?.description??null,scrapReason?.id??null,scrapReason?.code??null,declaration.qualityStatus,declaration.qualityNotes,JSON.stringify(declaration.qualityChecks),task.id);
      db.prepare("UPDATE tasks SET status='completed' WHERE id=?").run(task.id);
    }

    db.prepare('INSERT INTO executionEvents(id,taskId,action,at,userId,userName,reason) VALUES (?,?,?,?,?,?,?)').run(makeId(),task.id,payload.action,now,user.id,user.name,reason);
    db.prepare("UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'").run();
    db.exec('COMMIT');
    return {ok:true};
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
