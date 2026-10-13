const QUALITY_STATUSES = new Set(['conforming','nonconforming','review']);
const CHECK_RESULTS = new Set(['pass','fail','na']);
const COMPONENTS = new Set(['component1','component2']);

function positiveEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function plausibilityThresholds() {
  return {
    quantityMinRatio: positiveEnv('PLAUSIBILITY_QUANTITY_MIN_RATIO', 0.25),
    quantityMaxRatio: positiveEnv('PLAUSIBILITY_QUANTITY_MAX_RATIO', 2),
    runTimeMinRatio: positiveEnv('PLAUSIBILITY_RUN_TIME_MIN_RATIO', 0.1),
    runTimeMaxRatio: positiveEnv('PLAUSIBILITY_RUN_TIME_MAX_RATIO', 5),
    speedMaxRatio: positiveEnv('PLAUSIBILITY_SPEED_MAX_RATIO', 3),
    consumptionMinRatio: positiveEnv('PLAUSIBILITY_CONSUMPTION_MIN_RATIO', 0.25),
    consumptionMaxRatio: positiveEnv('PLAUSIBILITY_CONSUMPTION_MAX_RATIO', 4),
  };
}

function fail(message) {
  const error = new Error(message);
  error.status = 400;
  throw error;
}

function nullableText(value, label, maximum, required = false) {
  if (value === undefined || value === null || value === '') {
    if (required) fail(`Inserisci ${label}.`);
    return null;
  }
  if (typeof value !== 'string') fail(`${label}: valore non valido (massimo ${maximum} caratteri).`);
  const clean = value.trim();
  if (!clean) {
    if (required) fail(`Inserisci ${label}.`);
    return null;
  }
  if (clean.length > maximum) fail(`${label}: valore non valido (massimo ${maximum} caratteri).`);
  return clean;
}

function finiteQuantity(value, label, allowZero = true) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < (allowZero ? 0 : Number.MIN_VALUE) || value > 1e9) {
    fail(`${label} non valida (da ${allowZero ? '0' : 'oltre 0'} a 1000000000).`);
  }
  return value;
}

function cleanBarcode(value, lot, quantity, articleCode) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') fail('Codice a barre non valido (massimo 240 caratteri).');
  const barcode = value.trim();
  if (!barcode) return null;
  if (barcode.length > 240 || /[\x00-\x1f\x7f]/.test(barcode)) fail('Codice a barre non valido (massimo 240 caratteri, senza caratteri di controllo).');
  const parts = barcode.split('|');
  if (parts.length === 1) {
    if (barcode.toLocaleLowerCase('it') !== lot.toLocaleLowerCase('it')) fail('Il codice a barre non corrisponde al lotto inserito.');
    return barcode;
  }
  if (parts.length !== 2 && parts.length !== 3) fail('Formato del codice a barre non valido. Usa ARTICOLO|LOTTO o ARTICOLO|LOTTO|QUANTITÀ.');
  const [barcodeArticle, barcodeLot, barcodeQuantity] = parts;
  if (!barcodeArticle || !barcodeLot || barcodeArticle.toLocaleLowerCase('it') !== articleCode.toLocaleLowerCase('it')) fail('L’articolo del codice a barre non corrisponde al componente.');
  if (barcodeLot.toLocaleLowerCase('it') !== lot.toLocaleLowerCase('it')) fail('Il lotto del codice a barre non corrisponde al lotto inserito.');
  if (parts.length === 3) {
    if (!barcodeQuantity) fail('La quantità del codice a barre non è valida.');
    const parsed = Number(barcodeQuantity);
    finiteQuantity(parsed, 'Quantità del codice a barre', false);
    if (parsed !== quantity) fail('La quantità del codice a barre non corrisponde alla quantità del lotto.');
  }
  return barcode;
}

export function validateFinishDeclaration(payload, execution) {
  const goodQuantity = finiteQuantity(payload.producedQuantity, 'Quantità prodotta');
  const scrapQuantity = finiteQuantity(payload.scrapQuantity, 'Quantità scartata');
  if (goodQuantity + scrapQuantity > 1e9) fail('La somma tra quantità buona e scartata supera 1000000000.');
  const scrapReasonId = scrapQuantity > 0 ? nullableText(payload.scrapReasonId, 'una causale di scarto', 200, true) : null;

  if (!QUALITY_STATUSES.has(payload.qualityStatus)) fail('Esito qualità non valido.');
  const qualityStatus = payload.qualityStatus;
  const qualityNotes = nullableText(payload.qualityNotes, 'le note qualità', 1000, qualityStatus !== 'conforming');
  const checks = payload.qualityChecks;
  if (!checks || typeof checks !== 'object' || Array.isArray(checks) || Object.keys(checks).length !== 2 ||
      !Object.hasOwn(checks,'appearance') || !Object.hasOwn(checks,'bonding') ||
      !CHECK_RESULTS.has(checks.appearance) || !CHECK_RESULTS.has(checks.bonding)) {
    fail('Controlli qualità non validi. Compila aspetto e incollaggio.');
  }
  if (qualityStatus === 'conforming' && (checks.appearance === 'fail' || checks.bonding === 'fail' || (checks.appearance === 'na' && checks.bonding === 'na'))) {
    fail('Un prodotto conforme non può avere controlli falliti o entrambi non applicabili.');
  }

  if (!Array.isArray(payload.lots) || payload.lots.length < 1 || payload.lots.length > 50) fail('Inserisci da 1 a 50 lotti consumati.');
  const roles = new Set(), duplicates = new Set(), lots = [];
  for (const item of payload.lots) {
    if (!item || !COMPONENTS.has(item.component)) fail('Componente del lotto non valido.');
    if (typeof item.lot !== 'string') fail('Lotto non valido (massimo 80 caratteri).');
    const lot = item.lot.trim();
    if (!lot || lot.length > 80) fail('Lotto non valido (massimo 80 caratteri).');
    const quantity = finiteQuantity(item.quantity, 'Quantità consumata', false);
    const key = `${item.component}\0${lot.toLocaleLowerCase('it')}`;
    if (duplicates.has(key)) fail('Non inserire due volte lo stesso lotto per lo stesso componente.');
    duplicates.add(key);
    roles.add(item.component);
    const articleCode = execution?.[`${item.component}Code`];
    if (typeof articleCode !== 'string' || !articleCode) fail('Snapshot componente non valido.');
    lots.push({component:item.component,lot,quantity,barcode:cleanBarcode(item.barcode,lot,quantity,articleCode)});
  }
  if (![...COMPONENTS].every(component => roles.has(component))) fail('Inserisci almeno un lotto per entrambi i componenti.');
  return {goodQuantity,scrapQuantity,scrapReasonId,qualityStatus,qualityNotes,qualityChecks:{appearance:checks.appearance,bonding:checks.bonding},lots};
}

export function assessFinishPlausibility(declaration, execution, actualRunSeconds, thresholds = plausibilityThresholds()) {
  const flags = [];
  const actualQuantity = declaration.goodQuantity + declaration.scrapQuantity;
  const plannedQuantity = Number(execution?.plannedQuantity);
  const plannedRunSeconds = Number(execution?.plannedRunMinutes) * 60;
  const actualSeconds = Number(actualRunSeconds);
  const add = (code, message, values) => flags.push({code,message,...values});
  if (plannedQuantity > 0) {
    const ratio = actualQuantity / plannedQuantity;
    if (ratio < thresholds.quantityMinRatio || ratio > thresholds.quantityMaxRatio) {
      add('quantity_vs_planned', `Quantità totale ${actualQuantity} rispetto alla prevista ${plannedQuantity}.`, {actual:actualQuantity,planned:plannedQuantity,ratio});
    }
  }
  if (plannedRunSeconds > 0 && actualSeconds >= 0) {
    const ratio = actualSeconds / plannedRunSeconds;
    if (ratio < thresholds.runTimeMinRatio || ratio > thresholds.runTimeMaxRatio) {
      add('run_time_vs_planned', `Tempo attivo ${Math.round(actualSeconds)} s rispetto ai ${Math.round(plannedRunSeconds)} s previsti.`, {actual:actualSeconds,planned:plannedRunSeconds,ratio});
    }
    if (plannedQuantity > 0 && actualSeconds > 0) {
      const speedRatio = (actualQuantity / actualSeconds) / (plannedQuantity / plannedRunSeconds);
      if (speedRatio > thresholds.speedMaxRatio) add('output_vs_time', `Produzione per tempo ${speedRatio.toFixed(2)} volte lo standard pianificato.`, {ratio:speedRatio});
    } else if (actualQuantity > 0 && actualSeconds === 0) {
      add('output_without_time', 'Quantità dichiarata con tempo attivo pari a zero.', {actualQuantity,actualRunSeconds:actualSeconds});
    }
  }
  if (actualQuantity > 0) {
    for (const component of COMPONENTS) {
      if (execution?.[`${component}Unit`] !== execution?.productUnit) continue;
      const consumed = declaration.lots.filter(lot => lot.component === component).reduce((sum,lot) => sum + lot.quantity,0);
      const ratio = consumed / actualQuantity;
      if (ratio < thresholds.consumptionMinRatio || ratio > thresholds.consumptionMaxRatio) {
        add('consumption_vs_output', `Consumo ${execution[`${component}Code`]} ${consumed} ${execution.productUnit} rispetto all’uscita ${actualQuantity} ${execution.productUnit}.`, {component,consumed,output:actualQuantity,unit:execution.productUnit,ratio});
      }
    }
  }
  return flags;
}

export function requirePlausibilityReason(payload, flags) {
  if (!flags.length) return null;
  const detail = flags.map(flag => flag.message).join(' ');
  if (typeof payload.plausibilityReason !== 'string' || !payload.plausibilityReason.trim()) {
    fail(`Valori fuori soglia: ${detail} Inserisci una motivazione per continuare; il consuntivo resterà da verificare.`);
  }
  if (payload.plausibilityReason.trim().length > 1000) fail('Motivazione dei valori fuori soglia non valida (massimo 1000 caratteri).');
  return payload.plausibilityReason.trim();
}

export function qualityStatusWithPlausibility(declaredStatus, flags) {
  return flags.length && declaredStatus === 'conforming' ? 'review' : declaredStatus;
}

function elapsedSeconds(from, to) {
  if (!from) return 0;
  const start = Date.parse(from), end = Date.parse(to);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? (end - start) / 1000 : 0;
}

export function executionMetrics(execution, at = new Date().toISOString()) {
  const setupUntil = execution.setupEndedAt || (execution.phase === 'setup_running' ? at : null);
  const directRun = !execution.setupStartedAt && ['run_running','run_paused','completed'].includes(execution.phase);
  const setupKnown = Boolean(execution.setupEndedAt) || directRun;
  const openSetupPauseSeconds = execution.setupPausedAt ? elapsedSeconds(execution.setupPausedAt, at) : 0;
  const actualSetupSeconds = directRun ? 0 : Math.max(0,elapsedSeconds(execution.setupStartedAt, setupUntil) - (execution.setupPausedSeconds || 0) - openSetupPauseSeconds);
  const actualRunSeconds = execution.runActiveSeconds + (execution.phase === 'run_running' ? elapsedSeconds(execution.lastRunStartedAt, at) : 0);
  const plannedSetupSeconds = execution.plannedSetupMinutes == null ? null : execution.plannedSetupMinutes * 60;
  const plannedRunSeconds = execution.plannedRunMinutes == null ? null : execution.plannedRunMinutes * 60;
  const goodQuantity = execution.producedQuantity ?? null;
  const scrapQuantity = execution.scrapQuantity ?? null;
  const totalQuantity = goodQuantity === null || scrapQuantity === null ? null : goodQuantity + scrapQuantity;
  return {
    plannedSetupSeconds,
    actualSetupSeconds,
    setupDeltaSeconds: setupKnown && plannedSetupSeconds !== null ? actualSetupSeconds - plannedSetupSeconds : null,
    plannedRunSeconds,
    actualRunSeconds,
    runDeltaSeconds: execution.phase === 'completed' && plannedRunSeconds !== null ? actualRunSeconds - plannedRunSeconds : null,
    plannedQuantity: execution.plannedQuantity ?? null,
    goodQuantity,
    scrapQuantity,
    totalQuantity,
    scrapPercent: totalQuantity === null || totalQuantity === 0 ? null : scrapQuantity / totalQuantity * 100,
  };
}

/** Adds quality, scrap, barcode and planning snapshots once in one transaction. */
export function migrateQuality(db) {
  if (!db || typeof db.exec !== 'function' || typeof db.prepare !== 'function') throw new TypeError('Database SQLite non valido.');
  db.exec('BEGIN IMMEDIATE');
  try {
    let changed = false;
    if (!db.prepare("SELECT 1 FROM meta WHERE key='shopfloor-v2'").get()) {
      db.exec(`
      ALTER TABLE execution ADD COLUMN scrapQuantity REAL CHECK(scrapQuantity IS NULL OR (scrapQuantity >= 0 AND scrapQuantity <= 1000000000));
      ALTER TABLE execution ADD COLUMN scrapReason TEXT;
      ALTER TABLE execution ADD COLUMN qualityStatus TEXT CHECK(qualityStatus IS NULL OR qualityStatus IN ('conforming','nonconforming','review'));
      ALTER TABLE execution ADD COLUMN qualityNotes TEXT;
      ALTER TABLE execution ADD COLUMN qualityChecks TEXT;
      ALTER TABLE execution ADD COLUMN plannedSetupMinutes REAL;
      ALTER TABLE execution ADD COLUMN plannedRunMinutes REAL;
      ALTER TABLE execution ADD COLUMN plannedQuantity REAL;
      ALTER TABLE executionLots ADD COLUMN barcode TEXT;
      `);
      db.exec(`
      UPDATE execution
      SET plannedSetupMinutes=(SELECT COALESCE(tasks.effectiveSetupMinutes,tasks.setupMinutes) FROM tasks WHERE tasks.id=execution.taskId),
          plannedRunMinutes=(SELECT tasks.runMinutes FROM tasks WHERE tasks.id=execution.taskId),
          plannedQuantity=(SELECT tasks.quantity FROM tasks WHERE tasks.id=execution.taskId)
      WHERE EXISTS (SELECT 1 FROM tasks WHERE tasks.id=execution.taskId);
      `);
      db.prepare("INSERT INTO meta(key,value) VALUES ('shopfloor-v2','1')").run();
      changed = true;
    }
    if (!db.prepare("SELECT 1 FROM meta WHERE key='plausibility-v1'").get()) {
      const columns = new Set(db.prepare('PRAGMA table_info(execution)').all().map(column => column.name));
      if (!columns.has('plausibilityFlags')) db.exec('ALTER TABLE execution ADD COLUMN plausibilityFlags TEXT');
      if (!columns.has('plausibilityReason')) db.exec('ALTER TABLE execution ADD COLUMN plausibilityReason TEXT');
      db.prepare("INSERT INTO meta(key,value) VALUES ('plausibility-v1','1')").run();
      changed = true;
    }
    if (changed) db.prepare("INSERT INTO meta(key,value) VALUES ('revision','1') ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1").run();
    db.exec('COMMIT');
    return {migrated:changed};
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
