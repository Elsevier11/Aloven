import { createHash } from 'node:crypto';
import { assessFinishPlausibility, qualityStatusWithPlausibility, validateFinishDeclaration } from './quality.mjs';
import { appendAuditIntegrity } from './audit-integrity.mjs';

const DISPOSITIONS = new Set(['pending', 'released', 'scrapped', 'rework']);

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function revision(db) {
  return Number(db.prepare("SELECT value FROM meta WHERE key='revision'").get()?.value);
}

function requiredText(value, label, maximum) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) {
    fail(`${label}: inserisci un valore valido (massimo ${maximum} caratteri).`);
  }
  return value.trim();
}

function optionalText(value, label, maximum) {
  if (value === undefined || value === null || value === '') return null;
  return requiredText(value, label, maximum);
}

function assertAdmin(user) {
  if (!user?.id || !user?.name) fail('Utente non valido.');
  if (user.role !== 'admin') fail('Operazione riservata agli amministratori.', 403);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  }
  return value;
}

function payloadHash(action, payload) {
  return createHash('sha256').update(JSON.stringify(stableValue({action, payload}))).digest('hex');
}

function operationReplay(db, operationId, action, payload, user) {
  const id = requiredText(operationId, 'Identificativo operazione', 200);
  const hash = payloadHash(action, payload);
  const existing = db.prepare('SELECT * FROM mesOperations WHERE operationId=?').get(id);
  if (!existing) return {id, hash};
  if (existing.userId !== user.id || existing.action !== action || existing.payloadHash !== hash) {
    fail('Identificativo operazione già utilizzato con dati diversi.', 409);
  }
  return {id, hash, replay: JSON.parse(existing.resultJson)};
}

function saveOperation(db, operation, action, user, result, now) {
  db.prepare('INSERT INTO mesOperations(operationId,action,userId,payloadHash,resultJson,createdAt) VALUES (?,?,?,?,?,?)')
    .run(operation.id, action, user.id, operation.hash, JSON.stringify(result), now);
}

function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(item => item.name === column);
}

/** Additive, idempotent migration. Existing executions remain unclassified and receive no invented output lot. */
export function migrateMesRecords(db) {
  if (!db || typeof db.exec !== 'function' || typeof db.prepare !== 'function') throw new TypeError('Database SQLite non valido.');
  db.exec('BEGIN IMMEDIATE');
  try {
    let changed = false;
    for (const [column, definition] of [
      ['outputLot', 'TEXT'],
      ['orderReference', 'TEXT'],
      ['erpReference', 'TEXT'],
      ['customer', 'TEXT'],
      ['dueDate', 'TEXT'],
    ]) {
      if (!hasColumn(db, 'tasks', column)) {
        db.exec(`ALTER TABLE tasks ADD COLUMN ${column} ${definition}`);
        changed = true;
      }
    }
    for (const [column, definition] of [
      ['outputLot', 'TEXT'],
      ['qualityDisposition', "TEXT CHECK(qualityDisposition IS NULL OR qualityDisposition IN ('pending','released','scrapped','rework'))"],
      ['plausibilityFlags', 'TEXT'],
      ['plausibilityReason', 'TEXT'],
    ]) {
      if (!hasColumn(db, 'execution', column)) {
        db.exec(`ALTER TABLE execution ADD COLUMN ${column} ${definition}`);
        changed = true;
      }
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS mesAuditLog(
        id TEXT PRIMARY KEY,
        entityType TEXT NOT NULL,
        entityId TEXT NOT NULL,
        action TEXT NOT NULL,
        at TEXT NOT NULL,
        userId TEXT NOT NULL,
        userName TEXT NOT NULL,
        reason TEXT NOT NULL,
        beforeJson TEXT,
        afterJson TEXT,
        operationId TEXT
      );
      CREATE INDEX IF NOT EXISTS mesAudit_entity ON mesAuditLog(entityType,entityId,at,id);
      CREATE TABLE IF NOT EXISTS qualityDecisions(
        id TEXT PRIMARY KEY,
        taskId TEXT NOT NULL,
        disposition TEXT NOT NULL CHECK(disposition IN ('released','scrapped','rework')),
        at TEXT NOT NULL,
        userId TEXT NOT NULL,
        userName TEXT NOT NULL,
        reason TEXT NOT NULL,
        operationId TEXT NOT NULL UNIQUE
      );
      CREATE INDEX IF NOT EXISTS qualityDecisions_task ON qualityDecisions(taskId,at,id);
      CREATE TABLE IF NOT EXISTS mesOperations(
        operationId TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        userId TEXT NOT NULL,
        payloadHash TEXT NOT NULL,
        resultJson TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );
      CREATE TRIGGER IF NOT EXISTS mesAuditLog_no_update BEFORE UPDATE ON mesAuditLog BEGIN
        SELECT RAISE(ABORT,'Il registro audit non può essere modificato.');
      END;
      CREATE TRIGGER IF NOT EXISTS mesAuditLog_no_delete BEFORE DELETE ON mesAuditLog BEGIN
        SELECT RAISE(ABORT,'Il registro audit non può essere eliminato.');
      END;
      CREATE TRIGGER IF NOT EXISTS qualityDecisions_no_update BEFORE UPDATE ON qualityDecisions BEGIN
        SELECT RAISE(ABORT,'Le decisioni qualità non possono essere modificate.');
      END;
      CREATE TRIGGER IF NOT EXISTS qualityDecisions_no_delete BEFORE DELETE ON qualityDecisions BEGIN
        SELECT RAISE(ABORT,'Le decisioni qualità non possono essere eliminate.');
      END;
    `);
    if (!db.prepare("SELECT 1 FROM meta WHERE key='mes-records-v1'").get()) {
      db.prepare("INSERT INTO meta(key,value) VALUES ('mes-records-v1','1')").run();
      changed = true;
    }
    if (changed) db.prepare("INSERT INTO meta(key,value) VALUES ('revision','1') ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1").run();
    db.exec('COMMIT');
    return {migrated: changed};
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function validateOutputLot(value, {required = false} = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) fail('Inserisci il lotto prodotto.');
    return null;
  }
  if (typeof value !== 'string') fail('Lotto prodotto non valido (massimo 80 caratteri).');
  const clean = value.trim();
  if ((!clean && required) || clean.length > 80 || /[\x00-\x1f\x7f]/.test(clean)) {
    fail('Lotto prodotto non valido (massimo 80 caratteri, senza caratteri di controllo).');
  }
  return clean || null;
}

/** Insert-only helper; it intentionally does not open or commit a transaction. */
export function recordMesAudit(db, {entityType, entityId, action, user, reason, before, after, operationId = null}, makeId, now = new Date().toISOString()) {
  if (typeof makeId !== 'function') throw new TypeError('Generatore identificativi non valido.');
  if (!user?.id || !user?.name) fail('Utente non valido.');
  const row = {
    id: makeId(),
    entityType: requiredText(entityType, 'Tipo entità', 80),
    entityId: requiredText(entityId, 'Identificativo entità', 200),
    action: requiredText(action, 'Azione audit', 80),
    at: now,
    userId: user.id,
    userName: user.name,
    reason: requiredText(reason, 'Motivazione', 1000),
    beforeJson: before === undefined ? null : JSON.stringify(before),
    afterJson: after === undefined ? null : JSON.stringify(after),
    operationId: optionalText(operationId, 'Identificativo operazione', 200),
  };
  db.prepare(`INSERT INTO mesAuditLog(id,entityType,entityId,action,at,userId,userName,reason,beforeJson,afterJson,operationId)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(...Object.values(row));
  appendAuditIntegrity(db, row);
  return row;
}

/** Called inside the parent finish_run transaction, after execution quantities/quality were stored. */
export function finalizeMesExecution(db, taskId, payload, user, makeId, now = new Date().toISOString()) {
  const execution = db.prepare('SELECT * FROM execution WHERE taskId=?').get(taskId);
  const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(taskId);
  if (!execution || execution.phase !== 'completed' || !task) fail('Consuntivo completato non trovato.', 404);
  const explicitlyProvided = Object.hasOwn(payload, 'outputLot') || task.outputLot != null;
  const candidate = Object.hasOwn(payload, 'outputLot') ? payload.outputLot : task.outputLot;
  // Existing clients did not collect output lots. New clients require the field before calling this helper.
  const outputLot = validateOutputLot(candidate, {required: explicitlyProvided && Number(execution.producedQuantity) > 0});
  const hasPlausibilityFlags = Boolean(execution.plausibilityFlags && JSON.parse(execution.plausibilityFlags).length);
  const qualityDisposition = execution.qualityStatus === 'conforming' && !hasPlausibilityFlags ? 'released' : 'pending';
  db.prepare('UPDATE execution SET outputLot=?,qualityDisposition=? WHERE taskId=?').run(outputLot, qualityDisposition, taskId);
  recordMesAudit(db, {
    entityType: 'execution', entityId: taskId, action: 'finish', user,
    reason: 'Completamento consuntivo', before: null,
    after: {outputLot, qualityDisposition}, operationId: payload.operationId ?? null,
  }, makeId, now);
  return {outputLot, qualityDisposition};
}

function executionSnapshot(db, taskId) {
  const execution = db.prepare('SELECT * FROM execution WHERE taskId=?').get(taskId);
  if (!execution) return null;
  const lots = db.prepare('SELECT component,articleCode,lot,quantity,unit,barcode FROM executionLots WHERE taskId=? ORDER BY rowid').all(taskId);
  return {...execution, qualityChecks: execution.qualityChecks ? JSON.parse(execution.qualityChecks) : null, lots};
}

export function decorateMesExecutions(db, executions) {
  if (!Array.isArray(executions)) throw new TypeError('Elenco consuntivi non valido.');
  const decisions = db.prepare('SELECT * FROM qualityDecisions ORDER BY at,id').all();
  const byTask = new Map();
  for (const decision of decisions) {
    if (!byTask.has(decision.taskId)) byTask.set(decision.taskId, []);
    byTask.get(decision.taskId).push(decision);
  }
  return executions.map(item => ({
    ...item,
    qualityDisposition: item.qualityDisposition ?? null,
    qualityClassification: item.qualityDisposition == null ? 'legacy_unclassified' : 'classified',
    qualityDecisions: byTask.get(item.taskId) || [],
  }));
}

export function correctFinishedExecution(db, payload, user, makeId, now = new Date().toISOString()) {
  assertAdmin(user);
  if (!payload || !Number.isInteger(payload.revision)) fail('Revisione non valida.');
  if (typeof makeId !== 'function') throw new TypeError('Generatore identificativi non valido.');
  const taskId = requiredText(payload.taskId, 'Attività', 200);
  const reason = requiredText(payload.reason, 'Motivazione', 1000);
  db.exec('BEGIN IMMEDIATE');
  try {
    const operation = operationReplay(db, payload.operationId, 'correct_execution', payload, user);
    if (operation.replay) {
      db.exec('COMMIT');
      return {...operation.replay, replay: true};
    }
    if (revision(db) !== payload.revision) fail('I dati sono cambiati. Aggiorna la pagina e riprova.', 409);
    const before = executionSnapshot(db, taskId);
    if (!before || !(before.phase === 'completed' || (before.interruptedAt && before.producedQuantity != null))) fail('Consuntivo chiuso non trovato.', 404);
    const declaration = validateFinishDeclaration(payload, before);
    const plausibilityFlags = assessFinishPlausibility(declaration, before, Number(before.runActiveSeconds || 0));
    const plausibilityReason = plausibilityFlags.length ? reason : null;
    const recordedQualityStatus = qualityStatusWithPlausibility(declaration.qualityStatus, plausibilityFlags);
    const recordedQualityNotes = plausibilityFlags.length ? (declaration.qualityNotes || reason) : declaration.qualityNotes;
    const outputLot = validateOutputLot(payload.outputLot, {required: declaration.goodQuantity > 0});
    const keepsHistoricalReason = declaration.scrapQuantity > 0 && declaration.scrapReasonId === before.scrapReasonId;
    const scrapReason = declaration.scrapQuantity > 0
      ? keepsHistoricalReason
        ? {id:before.scrapReasonId,code:before.scrapReasonCode,description:before.scrapReason}
        : db.prepare('SELECT id,code,description FROM scrapReasons WHERE id=? AND active=1').get(declaration.scrapReasonId)
      : null;
    if (declaration.scrapQuantity > 0 && !scrapReason) fail('Seleziona una causale di scarto attiva.');
    db.prepare('DELETE FROM executionLots WHERE taskId=?').run(taskId);
    const insertLot = db.prepare('INSERT INTO executionLots(id,taskId,component,articleCode,lot,quantity,unit,barcode) VALUES (?,?,?,?,?,?,?,?)');
    for (const lot of declaration.lots) {
      insertLot.run(makeId(), taskId, lot.component, before[`${lot.component}Code`], lot.lot, lot.quantity, before[`${lot.component}Unit`], lot.barcode);
    }
    db.prepare(`UPDATE execution SET producedQuantity=?,scrapQuantity=?,scrapReason=?,scrapReasonId=?,scrapReasonCode=?,
      qualityStatus=?,qualityNotes=?,qualityChecks=?,outputLot=?,qualityDisposition='pending',plausibilityFlags=?,plausibilityReason=? WHERE taskId=?`).run(
      declaration.goodQuantity, declaration.scrapQuantity, scrapReason?.description ?? null, scrapReason?.id ?? null,
      scrapReason?.code ?? null, recordedQualityStatus, recordedQualityNotes, JSON.stringify(declaration.qualityChecks), outputLot,
      JSON.stringify(plausibilityFlags), plausibilityReason, taskId,
    );
    const after = executionSnapshot(db, taskId);
    recordMesAudit(db, {entityType: 'execution', entityId: taskId, action: 'correction', user, reason, before, after, operationId: operation.id}, makeId, now);
    db.prepare("UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'").run();
    const result = {ok: true, taskId, revision: payload.revision + 1};
    saveOperation(db, operation, 'correct_execution', user, result, now);
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function decideQualityDisposition(db, payload, user, makeId, now = new Date().toISOString()) {
  assertAdmin(user);
  if (!payload || !Number.isInteger(payload.revision)) fail('Revisione non valida.');
  if (typeof makeId !== 'function') throw new TypeError('Generatore identificativi non valido.');
  const taskId = requiredText(payload.taskId, 'Attività', 200);
  const reason = requiredText(payload.reason, 'Motivazione', 1000);
  if (!DISPOSITIONS.has(payload.disposition) || payload.disposition === 'pending') fail('Decisione qualità non valida.');
  db.exec('BEGIN IMMEDIATE');
  try {
    const operation = operationReplay(db, payload.operationId, 'quality_disposition', payload, user);
    if (operation.replay) {
      db.exec('COMMIT');
      return {...operation.replay, replay: true};
    }
    if (revision(db) !== payload.revision) fail('I dati sono cambiati. Aggiorna la pagina e riprova.', 409);
    const execution = db.prepare('SELECT * FROM execution WHERE taskId=?').get(taskId);
    if (!execution || !(execution.phase === 'completed' || (execution.interruptedAt && execution.producedQuantity != null))) fail('Consuntivo chiuso non trovato.', 404);
    const before = {qualityDisposition: execution.qualityDisposition};
    db.prepare('UPDATE execution SET qualityDisposition=? WHERE taskId=?').run(payload.disposition, taskId);
    db.prepare('INSERT INTO qualityDecisions(id,taskId,disposition,at,userId,userName,reason,operationId) VALUES (?,?,?,?,?,?,?,?)')
      .run(makeId(), taskId, payload.disposition, now, user.id, user.name, reason, operation.id);
    recordMesAudit(db, {entityType: 'execution', entityId: taskId, action: 'quality_disposition', user, reason, before, after: {qualityDisposition: payload.disposition}, operationId: operation.id}, makeId, now);
    db.prepare("UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'").run();
    const result = {ok: true, taskId, disposition: payload.disposition, revision: payload.revision + 1};
    saveOperation(db, operation, 'quality_disposition', user, result, now);
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function traceLots(db, {lot, articleCode = null, direction = null} = {}) {
  const cleanLot = requiredText(lot, 'Lotto', 80);
  const cleanArticle = optionalText(articleCode, 'Codice articolo', 80);
  if (direction !== null && !['input', 'output'].includes(direction)) fail('Direzione tracciabilità non valida.');
  const inputMatches = direction === 'output' ? [] : db.prepare(`SELECT DISTINCT taskId FROM executionLots
    WHERE lot=? COLLATE NOCASE AND (? IS NULL OR articleCode=? COLLATE NOCASE)`).all(cleanLot, cleanArticle, cleanArticle);
  const outputMatches = direction === 'input' ? [] : db.prepare(`SELECT taskId FROM execution
    WHERE outputLot=? COLLATE NOCASE AND (? IS NULL OR productCode=? COLLATE NOCASE)`).all(cleanLot, cleanArticle, cleanArticle);
  const matches = new Map();
  for (const row of inputMatches) matches.set(row.taskId, new Set(['input']));
  for (const row of outputMatches) {
    if (!matches.has(row.taskId)) matches.set(row.taskId, new Set());
    matches.get(row.taskId).add('output');
  }
  const records = [];
  for (const [taskId, matched] of matches) {
    const execution = db.prepare(`SELECT taskId,taskTitle,machineId,productCode,productDescription,productUnit,outputLot,
      producedQuantity,scrapQuantity,runEndedAt,qualityStatus,qualityDisposition FROM execution WHERE taskId=?`).get(taskId);
    const inputs = db.prepare('SELECT component,articleCode,lot,quantity,unit,barcode FROM executionLots WHERE taskId=? ORDER BY rowid').all(taskId);
    records.push({...execution, matchedDirections: [...matched], inputLots: inputs});
  }
  records.sort((a, b) => String(b.runEndedAt || '').localeCompare(String(a.runEndedAt || '')) || a.taskId.localeCompare(b.taskId));
  return {lot: cleanLot, articleCode: cleanArticle, direction, records};
}

export function listMesAudit(db, {entityType = null, entityId = null, limit = 50, offset = 0} = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail('Limite audit non valido (da 1 a 100).');
  if (!Number.isInteger(offset) || offset < 0) fail('Offset audit non valido.');
  const type = optionalText(entityType, 'Tipo entità', 80);
  const id = optionalText(entityId, 'Identificativo entità', 200);
  const where = [], values = [];
  if (type) { where.push('entityType=?'); values.push(type); }
  if (id) { where.push('entityId=?'); values.push(id); }
  const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS count FROM mesAuditLog${clause}`).get(...values).count;
  const items = db.prepare(`SELECT * FROM mesAuditLog${clause} ORDER BY at DESC,id DESC LIMIT ? OFFSET ?`).all(...values, limit, offset)
    .map(row => ({...row, before: row.beforeJson === null ? null : JSON.parse(row.beforeJson), after: row.afterJson === null ? null : JSON.parse(row.afterJson)}));
  return {items, total, limit, offset};
}
