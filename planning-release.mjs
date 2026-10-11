import { validateFinishDeclaration } from './quality.mjs';
import { recordMesAudit, validateOutputLot } from './mes-records.mjs';

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(item => item.name === column);
}

function revision(db) {
  return Number(db.prepare("SELECT value FROM meta WHERE key='revision'").get()?.value);
}

function requiredText(value, label, maximum = 1000) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) {
    fail(`${label}: inserisci un valore valido (massimo ${maximum} caratteri).`);
  }
  return value.trim();
}

function releasedPayload(task) {
  const value = {...task};
  for (const key of ['releasedPayload', 'releasedVersion', 'planningState', 'releasedMachineId', 'releasedPosition', 'releasedStart', 'releasedEnd', 'releasedSegments', 'releasedEffectiveSetupMinutes']) delete value[key];
  if (typeof value.segments === 'string') value.segments = JSON.parse(value.segments || '[]');
  if (typeof value.compatibleMachineIds === 'string') value.compatibleMachineIds = JSON.parse(value.compatibleMachineIds || '[]');
  return value;
}

function parseReleased(task) {
  if (!task.releasedPayload || task.releasedVersion == null) return null;
  try { return JSON.parse(task.releasedPayload); } catch { return null; }
}

function comparable(task) {
  if (!task) return null;
  const value = releasedPayload(task);
  delete value.status;
  return value;
}

function planningState(task) {
  if (task.status === 'in_progress') return 'in_progress';
  if (task.status === 'completed') return 'completed';
  const released = parseReleased(task);
  if (!released) return task.position == null ? 'unreleased' : 'unreleased';
  if (task.position == null || task.status === 'cancelled') return 'pending_removal';
  return JSON.stringify(comparable(task)) === JSON.stringify(comparable(released)) ? 'released' : 'modified';
}

function validateDraftQueue(tasks) {
  const message='Un’attività è stata avviata dal reparto mentre il piano era in modifica. Verifica e riordina la coda prima del rilascio.';
  const byMachine=new Map();
  for(const task of tasks.filter(item=>item.position!=null&&item.status!=='cancelled')){
    if(!byMachine.has(task.machineId))byMachine.set(task.machineId,[]);
    byMachine.get(task.machineId).push(task);
  }
  for(const queue of byMachine.values()){
    const positions=new Set();
    for(const task of queue){if(positions.has(task.position))fail(message,409);positions.add(task.position);}
    const intervals=[];
    for(const task of queue)for(const segment of (typeof task.segments==='string'?JSON.parse(task.segments||'[]'):task.segments||[])){
      const start=Date.parse(`${segment.start}Z`),end=Date.parse(`${segment.end}Z`);
      if(Number.isFinite(start)&&Number.isFinite(end)&&end>start)intervals.push({start,end,taskId:task.id});
    }
    intervals.sort((a,b)=>a.start-b.start||a.end-b.end);
    for(let index=1;index<intervals.length;index++)if(intervals[index].taskId!==intervals[index-1].taskId&&intervals[index].start<intervals[index-1].end)fail(message,409);
  }
}

export function decoratePlanningTasks(tasks) {
  return tasks.map(task => {
    const released = parseReleased(task);
    return {
      ...task,
      planningState: planningState(task),
      releasedMachineId: released?.machineId ?? null,
      releasedPosition: released?.position ?? null,
      releasedStart: released?.start ?? null,
      releasedEnd: released?.end ?? null,
      releasedSegments: released?.segments ?? [],
      releasedEffectiveSetupMinutes: released?.effectiveSetupMinutes ?? null,
    };
  });
}

/** Returns the published task view consumed by shop-floor clients. */
export function releasedTasks(tasks) {
  return tasks.map(task => {
    const released = parseReleased(task);
    if (!released) return {...task, position:null, start:null, end:null, segments:[], effectiveSetupMinutes:null, planningState:'unreleased'};
    const operationalStatus = ['in_progress','completed'].includes(task.status) ? task.status : released.status;
    return {
      ...task,
      ...released,
      status: operationalStatus,
      releasedPayload: task.releasedPayload,
      releasedVersion: task.releasedVersion,
      planningState: planningState(task),
      releasedMachineId: released.machineId ?? null,
      releasedPosition: released.position ?? null,
      releasedStart: released.start ?? null,
      releasedEnd: released.end ?? null,
      releasedSegments: released.segments ?? [],
      releasedEffectiveSetupMinutes: released.effectiveSetupMinutes ?? null,
    };
  });
}

export function planningInfo(db, tasks) {
  const version = Number(db.prepare("SELECT value FROM meta WHERE key='planningReleaseVersion'").get()?.value || 0);
  const release = version ? db.prepare('SELECT * FROM planningReleases WHERE version=?').get(version) : null;
  const decorated = decoratePlanningTasks(tasks);
  const changedTaskIds = decorated.filter(task => ['unreleased','modified','pending_removal'].includes(task.planningState) && (task.position != null || task.releasedVersion != null)).map(task => task.id);
  return {
    version,
    releasedAt: release?.at ?? null,
    releasedByName: release?.userName ?? null,
    hasDraftChanges: changedTaskIds.length > 0,
    changedTaskIds,
    releasedItems: decorated.filter(task => task.releasedVersion != null).map(task => ({
      taskId:task.id, version:task.releasedVersion, machineId:task.releasedMachineId,
      position:task.releasedPosition, start:task.releasedStart, end:task.releasedEnd,
    })),
  };
}

export function interruptionRequests(db) {
  return db.prepare('SELECT * FROM executionInterruptionRequests ORDER BY requestedAt DESC,id DESC').all();
}

/** Existing scheduled work becomes release 1, preserving the behavior before this feature. */
export function migratePlanningRelease(db, makeId = () => `migration-${Date.now()}`, now = new Date().toISOString()) {
  if (!db || typeof db.exec !== 'function' || typeof db.prepare !== 'function') throw new TypeError('Database SQLite non valido.');
  db.exec('BEGIN IMMEDIATE');
  try {
    if (db.prepare("SELECT 1 FROM meta WHERE key='planning-release-v1'").get()) {
      db.exec('COMMIT');
      return {migrated:false};
    }
    if (!hasColumn(db, 'tasks', 'releasedPayload')) db.exec('ALTER TABLE tasks ADD COLUMN releasedPayload TEXT');
    if (!hasColumn(db, 'tasks', 'releasedVersion')) db.exec('ALTER TABLE tasks ADD COLUMN releasedVersion INTEGER');
    for (const [column, definition] of [
      ['interruptedAt','TEXT'], ['interruptionReason','TEXT'], ['interruptionRequestId','TEXT'],
      ['interruptedByUserId','TEXT'], ['interruptedByUserName','TEXT'],
    ]) if (!hasColumn(db, 'execution', column)) db.exec(`ALTER TABLE execution ADD COLUMN ${column} ${definition}`);
    db.exec(`
      CREATE TABLE IF NOT EXISTS planningReleases(
        version INTEGER PRIMARY KEY, at TEXT NOT NULL, userId TEXT NOT NULL,
        userName TEXT NOT NULL, reason TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS executionInterruptionRequests(
        id TEXT PRIMARY KEY, taskId TEXT NOT NULL, status TEXT NOT NULL
          CHECK(status IN ('requested','confirmed','rejected','cancelled')),
        requestedAt TEXT NOT NULL, requestedByUserId TEXT NOT NULL,
        requestedByUserName TEXT NOT NULL, reason TEXT NOT NULL,
        respondedAt TEXT, respondedByUserId TEXT, respondedByUserName TEXT,
        responseReason TEXT
      );
      CREATE INDEX IF NOT EXISTS interruptionRequests_task ON executionInterruptionRequests(taskId,requestedAt,id);
    `);
    const rows = db.prepare('SELECT * FROM tasks ORDER BY rowid').all();
    const scheduled = rows.filter(task => task.position != null && ['planned','in_progress','completed'].includes(task.status));
    if (scheduled.length) {
      db.prepare('INSERT INTO planningReleases(version,at,userId,userName,reason) VALUES (1,?,?,?,?)')
        .run(now, 'system', 'Sistema', 'Piano esistente acquisito come rilasciato');
      const update = db.prepare('UPDATE tasks SET releasedPayload=?,releasedVersion=1 WHERE id=?');
      for (const task of scheduled) update.run(JSON.stringify(releasedPayload(task)), task.id);
      db.prepare("INSERT INTO meta(key,value) VALUES ('planningReleaseVersion','1')").run();
    } else db.prepare("INSERT INTO meta(key,value) VALUES ('planningReleaseVersion','0')").run();
    db.prepare("INSERT INTO meta(key,value) VALUES ('planning-release-v1','1')").run();
    db.prepare("UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'").run();
    db.exec('COMMIT');
    return {migrated:true, released:scheduled.length};
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function releasePlanning(db, payload, user, makeId, now = new Date().toISOString()) {
  if (user?.role !== 'admin') fail('Operazione riservata agli amministratori.', 403);
  if (!Number.isInteger(payload?.revision)) fail('Revisione non valida.');
  const reason = typeof payload.reason === 'string' && payload.reason.trim() ? requiredText(payload.reason, 'Motivazione') : 'Rilascio del piano di produzione';
  db.exec('BEGIN IMMEDIATE');
  try {
    if (revision(db) !== payload.revision) fail('I dati sono cambiati. Aggiorna la pagina e riprova.', 409);
    const tasks = db.prepare('SELECT * FROM tasks ORDER BY rowid').all();
    const before = planningInfo(db, tasks);
    if (!before.hasDraftChanges) fail('Il piano non contiene modifiche da rilasciare.');
    for (const task of tasks.filter(item => item.releasedVersion != null && ['in_progress','completed'].includes(item.status))) {
      const released = parseReleased(task);
      if (!released || JSON.stringify(comparable(task)) !== JSON.stringify(comparable(released))) {
        fail('Le attività iniziate o completate non possono essere modificate nel piano.', 409);
      }
    }
    validateDraftQueue(tasks);
    const version = before.version + 1;
    const publish = db.prepare('UPDATE tasks SET releasedPayload=?,releasedVersion=? WHERE id=?');
    const withdraw = db.prepare('UPDATE tasks SET releasedPayload=NULL,releasedVersion=NULL WHERE id=?');
    for (const task of tasks) {
      if (['in_progress','completed'].includes(task.status)) continue;
      if (task.status === 'planned' && task.position != null) publish.run(JSON.stringify(releasedPayload(task)), version, task.id);
      else withdraw.run(task.id);
    }
    db.prepare('INSERT INTO planningReleases(version,at,userId,userName,reason) VALUES (?,?,?,?,?)').run(version, now, user.id, user.name, reason);
    db.prepare("UPDATE meta SET value=? WHERE key='planningReleaseVersion'").run(String(version));
    db.prepare("UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'").run();
    const after = planningInfo(db, db.prepare('SELECT * FROM tasks ORDER BY rowid').all());
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='mesAuditLog'").get()) {
      recordMesAudit(db, {entityType:'planning', entityId:String(version), action:'release', user, reason, before, after}, makeId, now);
    }
    db.exec('COMMIT');
    return {ok:true, revision:payload.revision + 1, version, releasedAt:now, changedTaskIds:before.changedTaskIds};
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function requestExecutionInterruption(db, payload, user, makeId, now = new Date().toISOString()) {
  if (user?.role !== 'admin') fail('Operazione riservata agli amministratori.', 403);
  if (!Number.isInteger(payload?.revision)) fail('Revisione non valida.');
  const taskId = requiredText(payload.taskId, 'Attività', 200), reason = requiredText(payload.reason, 'Motivazione');
  db.exec('BEGIN IMMEDIATE');
  try {
    if (revision(db) !== payload.revision) fail('I dati sono cambiati. Aggiorna la pagina e riprova.', 409);
    const execution = db.prepare('SELECT * FROM execution WHERE taskId=?').get(taskId);
    if (!execution || !['setup_running','setup_done','run_running','run_paused'].includes(execution.phase) || execution.interruptedAt) fail('La lavorazione non è più interrompibile.', 409);
    if (db.prepare("SELECT 1 FROM executionInterruptionRequests WHERE taskId=? AND status='requested'").get(taskId)) fail('Esiste già una richiesta di interruzione per questa lavorazione.', 409);
    const id = makeId();
    db.prepare(`INSERT INTO executionInterruptionRequests(id,taskId,status,requestedAt,requestedByUserId,requestedByUserName,reason)
      VALUES (?,?,'requested',?,?,?,?)`).run(id, taskId, now, user.id, user.name, reason);
    db.prepare("UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'").run();
    const request = db.prepare('SELECT * FROM executionInterruptionRequests WHERE id=?').get(id);
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='mesAuditLog'").get()) recordMesAudit(db, {entityType:'execution',entityId:taskId,action:'interruption_requested',user,reason,before:{phase:execution.phase},after:{requestId:id,status:'requested'}}, makeId, now);
    db.exec('COMMIT');
    return {ok:true,revision:payload.revision+1,request};
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

function elapsedSeconds(from, to) {
  if (!from) return 0;
  const start = Date.parse(from), end = Date.parse(to);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? (end - start) / 1000 : 0;
}

export function respondExecutionInterruption(db, payload, user, makeId, now = new Date().toISOString()) {
  if (!user?.id || !user?.name) fail('Utente non valido.');
  if (!Number.isInteger(payload?.revision)) fail('Revisione non valida.');
  if (!['confirm','reject'].includes(payload.action)) fail('Risposta alla richiesta non valida.');
  const requestId = requiredText(payload.requestId, 'Richiesta', 200);
  db.exec('BEGIN IMMEDIATE');
  try {
    if (revision(db) !== payload.revision) fail('I dati sono cambiati. Aggiorna la pagina e riprova.', 409);
    const request = db.prepare('SELECT * FROM executionInterruptionRequests WHERE id=?').get(requestId);
    if (!request || request.status !== 'requested') fail('La richiesta di interruzione non è più attiva.', 409);
    const execution = db.prepare('SELECT * FROM execution WHERE taskId=?').get(request.taskId);
    const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(request.taskId);
    if (!execution || !task || !['setup_running','setup_done','run_running','run_paused'].includes(execution.phase) || execution.interruptedAt) fail('La lavorazione non è più interrompibile.', 409);
    if (payload.action === 'reject') {
      const reason = requiredText(payload.reason, 'Motivazione');
      db.prepare(`UPDATE executionInterruptionRequests SET status='rejected',respondedAt=?,respondedByUserId=?,respondedByUserName=?,responseReason=? WHERE id=?`)
        .run(now,user.id,user.name,reason,requestId);
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='mesAuditLog'").get()) recordMesAudit(db,{entityType:'execution',entityId:task.id,action:'interruption_rejected',user,reason,before:{requestId,status:'requested'},after:{requestId,status:'rejected'}},makeId,now);
    } else {
      let declaration = null, outputLot = null, total = execution.runActiveSeconds || 0;
      if (execution.phase === 'setup_running') {
        const paused = (execution.setupPausedSeconds || 0) + (execution.setupPausedAt ? elapsedSeconds(execution.setupPausedAt,now) : 0);
        db.prepare('UPDATE execution SET setupEndedAt=?,setupPausedAt=NULL,setupPausedSeconds=? WHERE taskId=?').run(now,paused,task.id);
      }
      if (['run_running','run_paused'].includes(execution.phase)) {
        declaration = validateFinishDeclaration({...payload,producedQuantity:payload.producedQuantity??payload.goodQuantity}, execution);
        outputLot = validateOutputLot(payload.outputLot,{required:declaration.goodQuantity>0});
        const scrapReason = declaration.scrapQuantity > 0 ? db.prepare('SELECT id,code,description FROM scrapReasons WHERE id=? AND active=1').get(declaration.scrapReasonId) : null;
        if (declaration.scrapQuantity > 0 && !scrapReason) fail('Seleziona una causale di scarto attiva.');
        total += execution.phase === 'run_running' ? elapsedSeconds(execution.lastRunStartedAt,now) : 0;
        const insert = db.prepare('INSERT INTO executionLots(id,taskId,component,articleCode,lot,quantity,unit,barcode) VALUES (?,?,?,?,?,?,?,?)');
        for (const lot of declaration.lots) insert.run(makeId(),task.id,lot.component,execution[`${lot.component}Code`],lot.lot,lot.quantity,execution[`${lot.component}Unit`],lot.barcode);
        db.prepare(`UPDATE execution SET runEndedAt=?,runActiveSeconds=?,lastRunStartedAt=NULL,producedQuantity=?,scrapQuantity=?,scrapReason=?,scrapReasonId=?,scrapReasonCode=?,qualityStatus=?,qualityNotes=?,qualityChecks=?,outputLot=?,qualityDisposition='pending' WHERE taskId=?`).run(
          now,total,declaration.goodQuantity,declaration.scrapQuantity,scrapReason?.description??null,scrapReason?.id??null,scrapReason?.code??null,declaration.qualityStatus,declaration.qualityNotes,JSON.stringify(declaration.qualityChecks),outputLot,task.id);
      }
      db.prepare(`UPDATE execution SET interruptedAt=?,interruptionReason=?,interruptionRequestId=?,interruptedByUserId=?,interruptedByUserName=? WHERE taskId=?`)
        .run(now,request.reason,requestId,user.id,user.name,task.id);
      db.prepare("UPDATE tasks SET status='cancelled',position=NULL,start=NULL,end=NULL,segments='[]',effectiveSetupMinutes=NULL,releasedPayload=NULL,releasedVersion=NULL WHERE id=?").run(task.id);
      db.prepare(`UPDATE executionInterruptionRequests SET status='confirmed',respondedAt=?,respondedByUserId=?,respondedByUserName=?,responseReason=? WHERE id=?`)
        .run(now,user.id,user.name,typeof payload.reason==='string'?payload.reason.trim().slice(0,1000):null,requestId);
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='mesAuditLog'").get()) recordMesAudit(db,{entityType:'execution',entityId:task.id,action:'interruption_confirmed',user,reason:request.reason,before:{phase:execution.phase,requestId},after:{phase:'cancelled',requestId,producedQuantity:declaration?.goodQuantity??null,scrapQuantity:declaration?.scrapQuantity??null,outputLot}},makeId,now);
    }
    db.prepare("UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'").run();
    const updated = db.prepare('SELECT * FROM executionInterruptionRequests WHERE id=?').get(requestId);
    db.exec('COMMIT');
    return {ok:true,revision:payload.revision+1,request:updated};
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
