// Ricrea i dati dimostrativi: storico per le statistiche + stato «giovedì 22/10/2026, ore 9:30» da mostrare in demo.
//
// Costruisce una NUOVA copia del database in una cartella di lavoro e lascia intatto quello operativo, a meno di --apply.
//   node seed-demo.mjs                       costruisce in .demo-build/ partendo da data/
//   node seed-demo.mjs --apply               come sopra, poi sostituisce data/aloven.sqlite (server SPENTO; backup in data/backups)
//   --source <cartella>  --out <cartella>    percorsi diversi (prove su copie)
//
// Conserva: macchine, articoli, tipologie, causali, regole di attrezzaggio e impostazioni.
// Rifà: utenti (con credenziali note, anche in data/demo-accounts.json), calendario, attività, consuntivi, eventi, lotti,
// fermi, decisioni qualità, piano rilasciato e registro modifiche.
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync, writeFileSync, rmSync, existsSync, copyFileSync} from 'node:fs';
import path from 'node:path';
import {randomBytes, scryptSync} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {scheduleTask, scheduleMachine} from './scheduler.mjs';
import {validateFinishDeclaration, executionMetrics} from './quality.mjs';
import {releasePlanning, releasedPayload} from './planning-release.mjs';
import {recordMesAudit} from './mes-records.mjs';
import {addItalianHolidays, effectiveMachineCalendar} from './public/calendar.js';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const SOURCE = path.resolve(option('--source') || 'data');
const OUT = path.resolve(option('--out') || '.demo-build');
const APPLY = args.includes('--apply');

// ---- Tempo della demo (ora di Roma) -------------------------------------------------------------------------------
const FROM = '2025-11-03';                 // primo giorno dello storico (lunedì)
const DEMO_DAY = '2026-10-22';             // giovedì della demo
const NOW_LOCAL = `${DEMO_DAY}T09:30`;    // «adesso» nella demo
const RELEASE_LOCAL = '2026-10-21T16:20';  // rilascio del piano il giorno prima
const SHIFTS = [['07:30', '12:00'], ['12:30', '16:00']];
const FIRST_FREE = `${DEMO_DAY}T10:30`;    // le attività pianificate partono dopo questo orario

// ---- Utilità -----------------------------------------------------------------------------------------------------
let randomState = 20261022;
function random() { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState / 4294967296; }
const integer = (a, b) => a + Math.floor(random() * (b - a + 1));
const pick = list => list[integer(0, list.length - 1)];
const makeId = () => randomBytes(12).toString('hex');
const minutes = (a, b) => (Date.parse(`${b}Z`) - Date.parse(`${a}Z`)) / 60000;
const add = (iso, n) => new Date(Date.parse(`${iso}Z`) + n * 60000).toISOString().slice(0, 16);
const addDay = (day, n) => add(`${day}T12:00`, n * 1440).slice(0, 10);
const rome = new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'});
function timestamp(local) {
  const target = Date.parse(`${local.length === 16 ? local + ':00' : local}Z`);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(rome.formatToParts(new Date(guess)).map(x => [x.type, x.value]));
    guess += target - Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
  }
  return new Date(guess).toISOString();
}
const pad = (n, width = 2) => String(n).padStart(width, '0');
const passwordHash = password => { const salt = randomBytes(16).toString('hex'); return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`; };

// ---- Anagrafiche di fantasia per la demo -------------------------------------------------------------------------
// Settori dichiarati da Aloven (calzatura sportiva, ciclismo/outdoor, automotive, arredamento, boiler, medicale) con clienti di fantasia.
const SECTOR_CUSTOMERS = {
  calzatura: ['Calzaturificio Brenta', 'Calzaturificio Montello', 'Scarpe Piave Srl', 'Sport Shoes Veneto'],
  sport: ['Outdoor Italia', 'Sport Tech Veneto', 'Ciclo Wear Treviso', 'Moda Lario', 'Caschi Piave Srl'],
  automotive: ['Auto Interni SpA', 'Interni Veneta Auto'],
  arredamento: ['Arredo Design Srl', 'Divani & Co', 'Casa Luce Srl', 'Tappezzeria Fontana', 'Tessitura Moretti'],
  medicale: ['Medical Tex', 'Ortopedia Veneta'],
  boiler: ['Termica Livenza Srl', 'Boiler Systems Veneto'],
};
// Tre processi (fiamma, HotMelt®, colla) su quattro linee; la calzatura è il settore principale.
const PROFILES = {
  'CNC-01': {typeId: 'fresatura', name: 'ACC-01 · Accoppiatrice HotMelt® (linea 1)', description: 'Accoppiatura con adesivo poliuretanico reattivo HotMelt®',
    weights: {automotive: 45, sport: 30, arredamento: 10, boiler: 5, medicale: 10}},
  'TOR-02': {typeId: 'tornitura', name: 'ACC-02 · Accoppiatrice a colla', description: 'Accoppiatura con resina adesiva (a colla)',
    weights: {calzatura: 35, arredamento: 25, sport: 25, medicale: 10, boiler: 5}},
  'LAS-03': {typeId: 'taglio', name: 'ACC-03 · Accoppiatrice a fiamma', description: 'Accoppiatura a fiamma di tessuti sintetici e schiume',
    weights: {calzatura: 70, arredamento: 12, sport: 13, automotive: 5}},
  'ACC-04': {typeId: 'fresatura', name: 'ACC-04 · Accoppiatrice HotMelt® (linea 2)', description: 'Accoppiatura con adesivo poliuretanico reattivo HotMelt®, seconda linea',
    weights: {automotive: 35, calzatura: 25, sport: 20, medicale: 10, boiler: 10}},
};
const TYPE_NAMES = {fresatura: 'Accoppiatura HotMelt®', tornitura: 'Accoppiatura a colla', taglio: 'Accoppiatura a fiamma'};
const PRODUCT_RENAMES = {'Laminato isolante tecnico': 'Copertura isolante per boiler', 'Composito isolante flessibile': 'Isolante per accumulo acqua sanitaria',
  'Barriera termica tessile': 'Rivestimento isolante per pompe di calore'};
const sectorOf = description => {
  const d = String(description).toLowerCase();
  if (/nautic|filtr/.test(d)) return null;                                   // fuori dai settori di Aloven
  if (/boiler|isolante|pompe di calore|accumulo/.test(d)) return 'boiler';
  if (/tomaia|calzatura/.test(d)) return 'calzatura';
  if (/sanitar|medical|ortoped/.test(d)) return 'medicale';
  if (/casco/.test(d)) return 'sport';
  if (/sedile|pannello porta|cielo vettura|bagagliaio|auto|vettura|fonoassorb|acustic/.test(d)) return 'automotive';
  if (/arredo|velluto|ciniglia|imbott|tenda|contract|ignifug|jacquard/.test(d)) return 'arredamento';
  return 'sport';
};
const LOT_PREFIX = {'CNC-01': 'HM', 'TOR-02': 'FW', 'LAS-03': 'FL', 'ACC-04': 'PW'};
const ACCOUNTS = [
  {role: 'admin', roleLabel: 'Amministratore', id: makeId(), name: 'Amministratore', username: 'admin', password: 'Admin-Demo-2026'},
  {role: 'planner', roleLabel: 'Pianificatore', id: makeId(), name: 'Mario Rossi', username: 'mario', password: 'Pianifica-Demo-2026'},
  {role: 'operator', roleLabel: 'Operatore', id: makeId(), name: 'Luca Bianchi', username: 'operatore1', password: 'Operatore-Demo-2026'},
  {role: 'operator', roleLabel: 'Operatore', id: makeId(), name: 'Giulia Ferrari', username: 'operatore2', password: 'Operatore-Demo-2026'},
  {role: 'operator', roleLabel: 'Operatore', id: makeId(), name: 'Marco Conti', username: 'operatore3', password: 'Operatore-Demo-2026'},
];
const planner = ACCOUNTS[1], workers = ACCOUNTS.slice(2);

// ---- Base pulita: un database appena inizializzato dall'applicazione (schema, migrazioni, anagrafiche), senza registro modifiche ----
mkdirSync(OUT, {recursive: true});
for (const suffix of ['', '-wal', '-shm']) rmSync(path.join(OUT, `aloven.sqlite${suffix}`), {force: true});
{
  const server = spawn(process.execPath, ['server.mjs'], {env: {...process.env, DATA_DIR: OUT, PORT: '0', HOST: '127.0.0.1'}, stdio: ['ignore', 'pipe', 'pipe']});
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Inizializzazione del database scaduta.')), 20000);
    server.stdout.on('data', chunk => { if (String(chunk).includes('disponibile')) { clearTimeout(timer); resolve(); } });
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`Server terminato (${code}) durante l'inizializzazione.`)); });
  });
  server.removeAllListeners('exit'); const closed = once(server, 'exit'); server.kill(); await closed.catch(() => {});
}
const db = new DatabaseSync(path.join(OUT, 'aloven.sqlite'));
db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000');

const inserts = new Map();
function insert(table, value) {
  const fields = Object.keys(value), key = table + fields.join(',');
  if (!inserts.has(key)) inserts.set(key, db.prepare(`INSERT INTO ${table} (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`));
  inserts.get(key).run(...Object.values(value));
}
const meta = key => db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value;
const setMeta = (key, value) => db.prepare('INSERT INTO meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
const bumpRevision = () => db.prepare("UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'").run();

const machines = db.prepare('SELECT * FROM machines ORDER BY rowid').all();
const articles = new Map(db.prepare('SELECT * FROM articles').all().map(x => [x.id, x]));
const scraps = db.prepare('SELECT * FROM scrapReasons WHERE active=1').all();
const stopReasons = db.prepare('SELECT * FROM machineStopReasons WHERE active=1').all();
if (!machines.length || !scraps.length || !stopReasons.length) throw new Error('Servono macchine e causali attive.');
if (machines.some(m => !PROFILES[m.id])) throw new Error('Linea senza profilo: aggiorna PROFILES.');

// Modelli di lavorazione: una per combinazione macchina/componenti/prodotto già presente nel database di partenza.
const templates = [], sectorByProduct = new Map();
{
  const seen = new Set();
  for (const task of db.prepare('SELECT * FROM tasks ORDER BY rowid').all()) {
    const key = [task.component1ArticleId, task.component2ArticleId, task.productArticleId].join('|');
    if (seen.has(key) || ![task.component1ArticleId, task.component2ArticleId, task.productArticleId].every(id => articles.has(id))) continue;
    if (PRODUCT_RENAMES[task.productDescription]) task.productDescription = PRODUCT_RENAMES[task.productDescription];
    const sector = sectorOf(task.productDescription);
    if (!sector) continue;
    sectorByProduct.set(task.productArticleId, sector);
    seen.add(key); templates.push(task);
  }
}
const templatesBySector = sector => templates.filter(t => sectorByProduct.get(t.productArticleId) === sector);
const weightedPick = weights => { const entries = Object.entries(weights).filter(([sector]) => templatesBySector(sector).length); const total = entries.reduce((sum, [, w]) => sum + w, 0); let r = random() * total; for (const [sector, w] of entries) { r -= w; if (r < 0) return sector; } return entries.at(-1)[0]; };
/** Una lavorazione modello adatta alla linea: il settore è scelto con i pesi della linea, il processo è quello della linea. */
const pickModel = machine => { const profile = PROFILES[machine.id]; const sector = weightedPick(profile.weights); return {...pick(templatesBySector(sector)), machineId: machine.id, typeId: profile.typeId}; };
const customerFor = model => pick(SECTOR_CUSTOMERS[sectorByProduct.get(model.productArticleId)] || SECTOR_CUSTOMERS.arredamento);

// ---- Calendario: lunedì–venerdì 7:30–12:00 e 12:30–16:00, festività e chiusure aziendali --------------------------------
let calendar = JSON.parse(meta('calendar'));
calendar.weekly = {0: [], 1: SHIFTS, 2: SHIFTS, 3: SHIFTS, 4: SHIFTS, 5: SHIFTS, 6: []};
calendar.exceptions = {};
calendar.machineExceptions = {};
calendar.maintenanceBlocks = [];
for (const year of [2025, 2026, 2027]) calendar = addItalianHolidays(calendar, year);
for (const day of ['2025-12-29', '2025-12-30', '2025-12-31']) calendar.exceptions[day] = [];            // fine anno
for (let day = '2026-08-10'; day <= '2026-08-21'; day = addDay(day, 1)) calendar.exceptions[day] = []; // chiusura estiva
const MAINTENANCE = {id: makeId(), machineId: 'LAS-03', start: '2026-10-27T12:30', end: '2026-10-27T14:30', name: 'Manutenzione programmata'};
const calendarFor = machineId => ({weekly: calendar.weekly, exceptions: {...calendar.exceptions, ...(calendar.machineExceptions?.[machineId] || {})}});

// ---- Azzeramento dei dati operativi ------------------------------------------------------------------------------
db.exec('BEGIN IMMEDIATE');
try {
  for (const table of ['executionEvents', 'executionLots', 'executionInterruptionRequests', 'qualityDecisions', 'setupResumeEvents', 'execution',
    'machineStops', 'mesOperations', 'planningReleases', 'sessions', 'tasks', 'users']) db.exec(`DELETE FROM ${table}`);
  if (db.prepare('SELECT count(*) n FROM mesAuditLog').get().n) throw new Error('Il registro modifiche della base non è vuoto.');
  for (const key of ['sim10m-v1-loaded', 'demo-duration-20-percent-v1']) db.prepare('DELETE FROM meta WHERE key=?').run(key);
  setMeta('audit-integrity-head', '');
  setMeta('planningReleaseVersion', '0');
  setMeta('releasedMaintenanceBlocks', '[]');
  setMeta('calendar', JSON.stringify(calendar));
  db.exec(`UPDATE machines SET anchor='${FROM}T07:30'`);
  for (const [id, profile] of Object.entries(PROFILES)) db.prepare('UPDATE machines SET name=?, description=? WHERE id=?').run(profile.name, profile.description, id);
  for (const [id, name] of Object.entries(TYPE_NAMES)) db.prepare('UPDATE types SET name=? WHERE id=?').run(name, id);
  db.prepare("DELETE FROM types WHERE id='textile-polvere'").run();
  for (const [from, to] of Object.entries(PRODUCT_RENAMES)) db.prepare("UPDATE articles SET description=? WHERE kind='product' AND description=?").run(to, from);
  for (const account of ACCOUNTS) insert('users', {id: account.id, name: account.name, username: account.username, password: passwordHash(account.password), role: account.role});

  // ---- Generazione --------------------------------------------------------------------------------------------------
  const counts = {tasks: 0, completed: 0, execution: 0, executionEvents: 0, executionLots: 0, machineStops: 0};
  const positions = new Map(machines.map(m => [m.id, 0]));
  const dayLot = new Map();      // macchina+giorno → progressivo del lotto prodotto
  const lotPool = new Map();     // codice componente → {lot, remaining}
  let lotCounter = 0, orderCounter = 3100, orderShare = 0;

  function componentLot(code, day, forceNew = false) {
    let entry = lotPool.get(code);
    const stale = entry && (Date.parse(`${day}T12:00Z`) - Date.parse(`${entry.last}T12:00Z`)) / 864e5 > 21;
    if (!entry || entry.remaining <= 0 || forceNew || stale) {
      entry = {lot: `L${day.slice(2, 4)}${day.slice(5, 7)}-${code}-${pad(++lotCounter % 100)}`, remaining: integer(3, 7), last: day};
      lotPool.set(code, entry);
    }
    entry.remaining--; entry.last = day; return entry.lot;
  }
  const orderLabel = () => { orderCounter++; orderShare = random() < 0.3 ? 1 : 0; return `OC-26${pad(orderCounter - 3100, 4)}`; };
  let sharedOrder = null;
  const orderFor = () => { if (orderShare > 0 && sharedOrder) { orderShare--; return sharedOrder; } sharedOrder = orderLabel(); return sharedOrder; };

  /** Attività completata con consuntivo, eventi, lotti ed eventuale fermo. Restituisce il nuovo cursore, o null se non entra. */
  function createCompleted(machine, machineIndex, day, cursor, until, forced = {}) {
    const cal = calendarFor(machine.id);
    const model = forced.model || pickModel(machine);
    const seq = ++counts.tasks;
    const setup = forced.setup ?? integer(12, 35), run = forced.run ?? (seq % 47 === 0 ? integer(280, 370) : integer(52, 116));
    const planned = scheduleTask({setupMinutes: setup, runMinutes: run}, cursor, cal);
    if (planned.start.slice(0, 10) !== day || planned.end.slice(0, 10) >= until) { counts.tasks--; return null; }
    const setupActual = Math.max(5, Math.round(setup * (0.8 + random() * 0.5)));
    const runActual = Math.max(20, Math.round(run * (0.85 + random() * 0.35 + (machineIndex === 2 ? 0.06 : 0))));
    const stopDuration = forced.noStop ? 0 : random() < 0.17 ? integer(8, 28) : 0;
    const actual = scheduleTask({setupMinutes: setupActual, runMinutes: runActual + stopDuration}, cursor, cal);
    if (actual.end.slice(0, 10) >= until) { counts.tasks--; return null; }
    const end = actual.end > planned.end ? actual.end : planned.end;
    const product = articles.get(model.productArticleId);
    const quantity = Math.round(run * machine.speed * (0.8 + random() * 0.35));
    const loss = random() < 0.12 ? 0 : Math.round(quantity * (0.004 + random() * 0.032 + (machineIndex === 2 ? 0.006 : 0)));
    const good = Math.max(0, quantity - loss - integer(0, Math.max(1, Math.round(quantity * 0.015))));
    const scrap = loss ? pick(scraps) : null;
    const qc = random() < 0.045 ? 'nonconforming' : random() < 0.06 ? 'review' : 'conforming';
    const dayKey = `${machine.id}|${day}`, lotNumber = (dayLot.get(dayKey) || 0) + 1; dayLot.set(dayKey, lotNumber);
    const outputLot = `${LOT_PREFIX[machine.id] || 'PF'}-${day.slice(2, 4)}${day.slice(5, 7)}${day.slice(8, 10)}-${lotNumber}`;
    const title = `${model.productDescription} · lotto ${outputLot}`;
    const lateDays = random() < 0.09 ? -integer(1, 3) : integer(0, 6);
    const dueDate = addDay(actual.end.slice(0, 10), lateDays);
    const id = makeId();
    const task = {...model, id, title, setupMinutes: setup, runMinutes: run, status: 'completed', position: positions.get(machine.id),
      start: planned.start, end: planned.end, segments: JSON.stringify(planned.segments), notes: '', quantity, calculationMode: 'manual',
      effectiveSetupMinutes: setup, outputLot, orderReference: orderFor(), erpReference: random() < 0.5 ? `ERP-${integer(41000, 48999)}` : null,
      customer: customerFor(model), dueDate, compatibleMachineIds: JSON.stringify([machine.id]), preferredMachineId: null,
      releasedPayload: null, releasedVersion: null, fixedStart: null, setupOverrideMinutes: null};
    positions.set(machine.id, positions.get(machine.id) + 1);
    insert('tasks', task); counts.completed++;
    const setupSegment = actual.segments.find(x => x.kind === 'setup'), runs = actual.segments.filter(x => x.kind === 'run');
    const worker = workers[seq % workers.length];
    const execution = {taskId: id, phase: 'completed', setupStartedAt: timestamp(setupSegment.start), setupEndedAt: timestamp(setupSegment.end),
      runStartedAt: timestamp(runs[0].start), runEndedAt: timestamp(actual.end), runActiveSeconds: runActual * 60, lastRunStartedAt: null,
      producedQuantity: good, taskTitle: title, machineId: machine.id, productCode: model.productCode, productDescription: model.productDescription,
      productUnit: product.unit, scrapQuantity: loss, scrapReason: scrap?.description ?? null, scrapReasonId: scrap?.id ?? null, scrapReasonCode: scrap?.code ?? null,
      qualityStatus: qc,
      qualityNotes: qc === 'conforming' ? null : qc === 'nonconforming' ? 'Adesione insufficiente sul bordo: verificare il lotto di adesivo.' : 'Aspetto da verificare: lieve variazione di tonalità.',
      qualityChecks: JSON.stringify({appearance: qc === 'review' ? 'na' : 'pass', bonding: qc === 'nonconforming' ? 'fail' : qc === 'review' ? 'na' : 'pass'}),
      plannedSetupMinutes: setup, plannedRunMinutes: run, plannedQuantity: quantity, outputLot};
    for (const role of ['component1', 'component2']) {
      const article = articles.get(model[`${role}ArticleId`]);
      for (const suffix of ['Code', 'Description']) execution[role + suffix] = model[role + suffix];
      execution[role + 'Unit'] = article.unit;
    }
    const events = [];
    const event = (action, local, reason = null) => events.push({id: makeId(), taskId: id, action, at: timestamp(local), userId: worker.id, userName: worker.name, reason});
    event('start_setup', setupSegment.start); event('finish_setup', setupSegment.end); event('start_run', runs[0].start);
    let stopped = false;
    for (let k = 0; k < runs.length; k++) {
      const segment = runs[k];
      if (stopDuration && !stopped && minutes(segment.start, segment.end) >= stopDuration + 12) {
        const start = add(segment.start, 5), finish = add(start, stopDuration), reason = pick(stopReasons);
        event('pause_run', start, `Fermo macchina: ${reason.description}`); event('resume_run', finish);
        insert('machineStops', {id: makeId(), machineId: machine.id, startedAt: timestamp(start), endedAt: timestamp(finish), reason: reason.description,
          reasonId: reason.id, reasonCode: reason.code, userId: worker.id, userName: worker.name, endedByUserId: worker.id, endedByUserName: worker.name});
        counts.machineStops++; stopped = true;
      }
      if (k < runs.length - 1) { event('pause_run', segment.end, 'Fine fascia lavorativa'); event('resume_run', runs[k + 1].start); }
    }
    if (stopDuration && !stopped) throw new Error('Fermo senza intervallo disponibile');
    event('finish_run', actual.end);
    let activeAt = null, activeSeconds = 0;
    for (const e of events.sort((a, b) => a.at.localeCompare(b.at))) {
      if (['start_run', 'resume_run'].includes(e.action)) activeAt = Date.parse(e.at);
      if (['pause_run', 'finish_run'].includes(e.action)) { if (activeAt === null) throw new Error('Sequenza eventi non valida'); activeSeconds += (Date.parse(e.at) - activeAt) / 1000; activeAt = null; }
    }
    if (activeSeconds !== execution.runActiveSeconds) throw new Error('Eventi e tempo attivo non corrispondono');
    const lots = [];
    for (const role of ['component1', 'component2']) {
      const unit = execution[role + 'Unit'], code = execution[role + 'Code'];
      const total = Math.round((good + loss) * (unit === product.unit ? 1 : unit === 'kg' ? 0.18 : unit === 'm2' ? 1.5 : 1) * 1.015 * 100) / 100;
      const portions = random() < 0.3 ? [Math.round(total * 0.55 * 100) / 100] : [];
      portions.push(Math.round((total - (portions[0] || 0)) * 100) / 100);
      for (const [n, q] of portions.entries()) {
        const lot = componentLot(code, day, n > 0);
        lots.push({component: role, lot, quantity: q, barcode: `${code}|${lot}|${q}`});
        insert('executionLots', {id: makeId(), taskId: id, component: role, articleCode: code, lot, quantity: q, unit, barcode: `${code}|${lot}|${q}`}); counts.executionLots++;
      }
    }
    validateFinishDeclaration({producedQuantity: good, scrapQuantity: loss, scrapReasonId: scrap?.id ?? null, qualityStatus: qc, qualityNotes: execution.qualityNotes,
      qualityChecks: JSON.parse(execution.qualityChecks), lots}, execution);
    if (executionMetrics(execution).actualRunSeconds !== runActual * 60) throw new Error('Consuntivo incoerente');
    insert('execution', execution); counts.execution++;
    for (const e of events.sort((a, b) => a.at.localeCompare(b.at))) { insert('executionEvents', e); counts.executionEvents++; }
    return end;
  }

  // 1. Storico: dal FROM a ieri (mercoledì 21/10 compreso)
  const historyCursors = new Map();
  for (const [machineIndex, machine] of machines.entries()) {
    const cal = calendarFor(machine.id);
    let cursor = `${FROM}T00:00`;
    for (let day = FROM; day < DEMO_DAY; day = addDay(day, 1)) {
      if (cursor.slice(0, 10) > day) continue;
      const shifts = cal.exceptions[day] ?? cal.weekly[new Date(`${day}T12:00Z`).getUTCDay()] ?? [];
      if (!shifts.length) continue;
      cursor = cursor > `${day}T${shifts[0][0]}` ? cursor : `${day}T${shifts[0][0]}`;
      const jobs = integer(2, 4), month = Number(day.slice(5, 7));
      if (month === 8 && random() < 0.38) continue;
      for (let j = 0; j < jobs; j++) {
        const end = createCompleted(machine, machineIndex, day, cursor, DEMO_DAY);
        if (end === null) break;
        cursor = end;
      }
    }
    historyCursors.set(machine.id, cursor);
  }
  // Questa mattina una lavorazione è già conclusa su ACC-02 (TOR-02): il reparto ha già lavorato.
  {
    const machine = machines.find(m => m.id === 'TOR-02'), index = machines.indexOf(machine);
    const end = createCompleted(machine, index, DEMO_DAY, `${DEMO_DAY}T07:30`, '2026-10-23', {setup: 20, run: 55, noStop: true});
    if (end === null) throw new Error('Lavorazione di questa mattina non creata');
    historyCursors.set('TOR-02', end);
  }

  // Piano rilasciato 1 = storico acquisito
  db.prepare('INSERT INTO planningReleases(version,at,userId,userName,reason) VALUES (1,?,?,?,?)').run(timestamp(`${FROM}T07:00`), 'system', 'Sistema', 'Piano esistente acquisito come rilasciato');
  for (const row of db.prepare("SELECT * FROM tasks WHERE status='completed'").all()) {
    db.prepare('UPDATE tasks SET releasedPayload=?,releasedVersion=1 WHERE id=?').run(JSON.stringify(releasedPayload(row)), row.id);
  }
  setMeta('planningReleaseVersion', '1');

  // Decisioni qualità: quelle più vecchie sono già prese, le ultime restano da decidere
  const decided = {};
  {
    const decision = db.prepare("SELECT e.taskId,e.qualityStatus,e.runEndedAt FROM execution e WHERE e.qualityStatus IN ('review','nonconforming') AND e.phase='completed' ORDER BY e.runEndedAt").all();
    const recentLimit = timestamp(`${addDay(DEMO_DAY, -6)}T00:00`);
    for (const item of decision) {
      if (item.runEndedAt >= recentLimit) { db.prepare("UPDATE execution SET qualityDisposition='pending' WHERE taskId=?").run(item.taskId); decided.pending = (decided.pending || 0) + 1; continue; }
      const r = random();
      const disposition = item.qualityStatus === 'nonconforming' ? (r < 0.45 ? 'scrapped' : 'rework') : (r < 0.8 ? 'released' : r < 0.95 ? 'rework' : 'scrapped');
      const at = new Date(Date.parse(item.runEndedAt) + integer(40, 1100) * 60000).toISOString();
      const reason = {released: 'Verificato in laboratorio: entro tolleranza.', rework: 'Da rilavorare: ripassare in accoppiatura.', scrapped: 'Non recuperabile: scartato.'}[disposition];
      db.prepare('UPDATE execution SET qualityDisposition=? WHERE taskId=?').run(disposition, item.taskId);
      insert('qualityDecisions', {id: makeId(), taskId: item.taskId, disposition, at, userId: planner.id, userName: planner.name, reason, operationId: makeId()});
      recordMesAudit(db, {entityType: 'execution', entityId: item.taskId, action: 'quality_disposition', user: planner, reason, before: {qualityDisposition: 'pending'}, after: {qualityDisposition: disposition}}, makeId, at);
      decided[disposition] = (decided[disposition] || 0) + 1;
    }
  }

  // Storia per la demo: un lotto di componente usato da più clienti nelle ultime tre settimane; la sua ultima lavorazione è non conforme e da decidere
  let story = null;
  {
    const windowStart = timestamp(`${addDay(DEMO_DAY, -21)}T00:00`), recentStart = timestamp(`${addDay(DEMO_DAY, -5)}T00:00`);
    const hero = db.prepare(`SELECT l.lot, l.articleCode, count(DISTINCT l.taskId) uses, count(DISTINCT t.customer) customers, round(sum(l.quantity)) quantity,
        min(substr(e.runEndedAt,1,10)) fromDay, max(substr(e.runEndedAt,1,10)) toDay, max(e.runEndedAt) lastEnd
      FROM executionLots l JOIN execution e ON e.taskId = l.taskId JOIN tasks t ON t.id = l.taskId
      WHERE e.runEndedAt >= ? GROUP BY l.lot, l.articleCode HAVING uses >= 4 AND lastEnd >= ? ORDER BY customers DESC, uses DESC, l.lot LIMIT 1`).get(windowStart, recentStart);
    if (hero) {
      const last = db.prepare(`SELECT e.taskId, e.outputLot, e.taskTitle FROM executionLots l JOIN execution e ON e.taskId = l.taskId WHERE l.lot = ? AND e.runEndedAt >= ? ORDER BY e.runEndedAt DESC LIMIT 1`).get(hero.lot, recentStart);
      db.prepare("DELETE FROM qualityDecisions WHERE taskId = ?").run(last.taskId);
      db.prepare("UPDATE execution SET qualityStatus = 'nonconforming', qualityDisposition = 'pending', qualityNotes = ?, qualityChecks = ? WHERE taskId = ?")
        .run('Adesione insufficiente sul bordo: verificare il lotto di materiale.', JSON.stringify({appearance: 'pass', bonding: 'fail'}), last.taskId);
      const customers = db.prepare('SELECT DISTINCT t.customer FROM executionLots l JOIN tasks t ON t.id = l.taskId JOIN execution e ON e.taskId = l.taskId WHERE l.lot = ? ORDER BY t.customer').all(hero.lot).map(x => x.customer);
      story = {componentLot: hero.lot, articleCode: hero.articleCode, article: articles.get(db.prepare('SELECT id FROM articles WHERE code = ?').get(hero.articleCode)?.id)?.description ?? null,
        uses: hero.uses, customers: hero.customers, customerNames: customers, quantity: hero.quantity, fromDay: hero.fromDay, toDay: hero.toDay,
        nonconformingLot: last.outputLot, nonconformingTitle: last.taskTitle};
    }
  }

  // 2. Attività del 22/10: quattro in corso (una per macchina), un fermo aperto, pianificate e da assegnare
  const modelFor = machineId => pickModel(machines.find(m => m.id === machineId));
  let futureLot = 500;
  function newTask(machine, model, extra = {}) {
    const run = extra.run ?? integer(70, 200), setup = extra.setup ?? integer(12, 35);
    const lot = `TP-26-${pad(++futureLot, 4)}`;
    return {...model, id: makeId(), title: `${model.productDescription} · lotto ${lot}`, typeId: model.typeId, machineId: machine.id, setupMinutes: setup, runMinutes: run,
      status: 'unplanned', position: null, start: null, end: null, segments: '[]', notes: extra.notes ?? '',
      quantity: extra.quantity === undefined ? Math.round(run * machine.speed * (0.9 + random() * 0.2)) : extra.quantity, calculationMode: 'manual',
      effectiveSetupMinutes: null, outputLot: lot, orderReference: orderLabel(), erpReference: random() < 0.5 ? `ERP-${integer(41000, 48999)}` : null,
      customer: extra.customer ?? customerFor(model), dueDate: extra.dueDate === undefined ? addDay(DEMO_DAY, integer(4, 24)) : extra.dueDate,
      compatibleMachineIds: JSON.stringify(extra.compatible || [machine.id]), preferredMachineId: extra.preferred ?? null,
      releasedPayload: null, releasedVersion: null, fixedStart: null, setupOverrideMinutes: null, ...(extra.override || {})};
  }

  const live = {
    'CNC-01': {phase: 'run_running', setup: 25, run: 150, setupStart: '07:30', setupEnd: '07:52', runStart: '07:54', pauses: [['08:30', '08:40', 'Pausa']], worker: 0},
    'TOR-02': {phase: 'setup_running', setup: 25, run: 110, setupStart: '09:05', worker: 1},
    'LAS-03': {phase: 'run_paused', setup: 30, run: 120, setupStart: '07:30', setupEnd: '08:05', runStart: '08:08', pauses: [['09:12', null, 'Cambio rotolo componente']], worker: 2},
    'ACC-04': {phase: 'run_paused', setup: 15, run: 100, setupStart: '07:30', setupEnd: '07:48', runStart: '07:50', pauses: [['08:42', null, 'Fermo macchina: Guasto']], worker: 0, stop: true},
  };
  const inProgress = new Map();
  const plannedByMachine = new Map();
  for (const [machineIndex, machine] of machines.entries()) {
    const spec = live[machine.id], model = modelFor(machine.id, machineIndex);
    const cal = effectiveMachineCalendar(calendar, machine.id);
    const startCursor = machine.id === 'TOR-02' ? historyCursors.get('TOR-02') : `${DEMO_DAY}T07:30`;
    const current = newTask(machine, model, {setup: spec.setup, run: spec.run, dueDate: addDay(DEMO_DAY, integer(2, 6))});
    const currentPlan = scheduleTask({setupMinutes: spec.setup, runMinutes: spec.run}, startCursor, cal);
    Object.assign(current, {status: 'planned', position: positions.get(machine.id), start: currentPlan.start, end: currentPlan.end,
      segments: JSON.stringify(currentPlan.segments), effectiveSetupMinutes: spec.setup});
    positions.set(machine.id, positions.get(machine.id) + 1);
    inProgress.set(machine.id, current);
    insert('tasks', current); counts.tasks++;

    // Attività già pianificate dopo quella in corso
    const queue = [];
    const planCount = machine.id === 'ACC-04' ? 9 : 10;
    for (let n = 0; n < planCount; n++) {
      const long = n === 2 && machine.id === 'CNC-01';
      const task = newTask(machine, modelFor(machine.id, n + machineIndex), {run: long ? integer(380, 460) : integer(80, 220), notes: n === 1 && machine.id === 'LAS-03' ? 'Cliente in attesa: consegna prioritaria.' : ''});
      queue.push(task);
    }
    plannedByMachine.set(machine.id, queue);
  }

  // Sequenze: in corso (bloccata) + pianificate; l'attività a data fissata su ACC-02
  for (const machine of machines) {
    const cal = effectiveMachineCalendar(calendar, machine.id);
    const current = inProgress.get(machine.id), queue = plannedByMachine.get(machine.id);
    const prelim = scheduleMachine([{...current, status: 'in_progress'}, ...queue.map(t => ({...t, position: null}))].map(t => ({id: t.id, setupMinutes: t.setupMinutes, runMinutes: t.runMinutes, status: t.status === 'unplanned' ? 'planned' : t.status, start: t.start, end: t.end, segments: JSON.parse(t.segments || '[]'), fixedStart: null})),
      `${FROM}T07:30`, cal, {minimumStarts: {[queue[0].id]: FIRST_FREE}});
    let pinned = null;
    if (machine.id === 'TOR-02') { // una consegna urgente con data fissata: il giorno dopo l'attività precedente alle 7:30
      const before = prelim[2];
      pinned = {id: queue[2].id, fixedStart: `${addDay(before.end.slice(0, 10), 1)}T07:30`};
      for (let guard = 0; guard < 10; guard++) { const dow = new Date(`${pinned.fixedStart.slice(0, 10)}T12:00Z`).getUTCDay(); if (dow !== 0 && dow !== 6 && !Object.hasOwn(calendar.exceptions, pinned.fixedStart.slice(0, 10))) break; pinned.fixedStart = `${addDay(pinned.fixedStart.slice(0, 10), 1)}T07:30`; }
    }
    const sequence = [{...current, status: 'in_progress'}, ...queue.map(t => ({...t, status: 'planned', fixedStart: pinned?.id === t.id ? pinned.fixedStart : null}))]
      .map(t => ({id: t.id, setupMinutes: t.setupMinutes, runMinutes: t.runMinutes, status: t.status, start: t.start, end: t.end, segments: JSON.parse(t.segments || '[]'), fixedStart: t.fixedStart ?? null}));
    const scheduled = scheduleMachine(sequence, `${FROM}T07:30`, cal, {minimumStarts: {[queue[0].id]: FIRST_FREE}});
    for (const [index, result] of scheduled.entries()) {
      if (index === 0) continue;
      const task = queue[index - 1];
      Object.assign(task, {status: 'planned', position: positions.get(machine.id), start: result.start, end: result.end, segments: JSON.stringify(result.segments),
        effectiveSetupMinutes: task.setupMinutes, fixedStart: sequence[index].fixedStart});
      positions.set(machine.id, positions.get(machine.id) + 1);
      insert('tasks', task); counts.tasks++;
    }
  }

  // Attività da assegnare (30), con qualche caso utile per la demo
  const unplanned = [];
  const families = {'CNC-01': ['ACC-04'], 'ACC-04': ['CNC-01'], 'TOR-02': ['LAS-03'], 'LAS-03': ['TOR-02']};
  const order = ['CNC-01', 'TOR-02', 'LAS-03', 'ACC-04'];
  for (let n = 0; n < 30; n++) {
    const machine = machines.find(m => m.id === order[n % 4]);
    const both = n % 4 === 1 || n % 7 === 0;
    const task = newTask(machine, modelFor(machine.id, n), {compatible: both ? [machine.id, families[machine.id][0]] : [machine.id], preferred: both ? machine.id : null});
    unplanned.push(task);
  }
  unplanned[3].dueDate = addDay(DEMO_DAY, 2);   // consegna ravvicinata
  unplanned[8].dueDate = addDay(DEMO_DAY, 3);
  unplanned[5].quantity = null; unplanned[5].dueDate = '';  // mancano quantità e consegna: l'app avvisa
  { const t = unplanned[12]; t.component2ArticleId = t.component1ArticleId; t.component2Code = t.component1Code; t.component2Description = t.component1Description; } // componenti uguali
  unplanned[17].dueDate = addDay(DEMO_DAY, -1); // consegna nel passato
  unplanned[20].notes = 'Campione per nuovo cliente: controllare l’adesione prima di proseguire.';
  for (const task of unplanned) { insert('tasks', task); counts.tasks++; }

  // Manutenzione programmata e rilascio del piano di ieri
  calendar.maintenanceBlocks = [MAINTENANCE];
  setMeta('calendar', JSON.stringify(calendar));
  db.exec('COMMIT');
  const release = releasePlanning(db, {revision: Number(meta('revision')), reason: 'Piano settimanale 22–29 ottobre'}, planner, makeId, timestamp(RELEASE_LOCAL));
  db.exec('BEGIN IMMEDIATE');

  // 3. Avvio in reparto delle quattro attività «in corso»
  for (const machine of machines) {
    const spec = live[machine.id], task = inProgress.get(machine.id), worker = workers[spec.worker];
    db.prepare("UPDATE tasks SET status='in_progress' WHERE id=?").run(task.id);
    const at = hhmm => `${DEMO_DAY}T${hhmm}`;
    const events = [], event = (action, hhmm, reason = null) => events.push({id: makeId(), taskId: task.id, action, at: timestamp(at(hhmm)), userId: worker.id, userName: worker.name, reason});
    const product = articles.get(task.productArticleId);
    const execution = {taskId: task.id, phase: spec.phase, setupStartedAt: timestamp(at(spec.setupStart)), setupEndedAt: spec.setupEnd ? timestamp(at(spec.setupEnd)) : null,
      runStartedAt: spec.runStart ? timestamp(at(spec.runStart)) : null, runEndedAt: null, runActiveSeconds: 0, lastRunStartedAt: null, producedQuantity: null,
      taskTitle: task.title, machineId: machine.id, productCode: task.productCode, productDescription: task.productDescription, productUnit: product.unit,
      scrapQuantity: null, scrapReason: null, qualityStatus: null, qualityNotes: null, qualityChecks: null, plannedSetupMinutes: task.setupMinutes,
      plannedRunMinutes: task.runMinutes, plannedQuantity: task.quantity, scrapReasonId: null, scrapReasonCode: null, setupPausedAt: null, setupPausedSeconds: 0, outputLot: task.outputLot};
    for (const role of ['component1', 'component2']) {
      const article = articles.get(task[`${role}ArticleId`]);
      execution[role + 'Code'] = task[role + 'Code']; execution[role + 'Description'] = task[role + 'Description']; execution[role + 'Unit'] = article.unit;
    }
    event('start_setup', spec.setupStart);
    if (spec.setupEnd) event('finish_setup', spec.setupEnd);
    if (spec.runStart) {
      event('start_run', spec.runStart);
      let active = 0, since = spec.runStart;
      const minutesOf = hhmm => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
      for (const [from, to, reason] of spec.pauses || []) {
        event('pause_run', from, reason); active += minutesOf(from) - minutesOf(since);
        if (to) { event('resume_run', to); since = to; } else since = null;
      }
      if (since) { execution.lastRunStartedAt = timestamp(at(since)); }
      execution.runActiveSeconds = active * 60;
    }
    insert('execution', execution); counts.execution++;
    for (const e of events) { insert('executionEvents', e); counts.executionEvents++; }
    if (spec.stop) {
      insert('machineStops', {id: makeId(), machineId: machine.id, startedAt: timestamp(at('08:42')), endedAt: null, reason: 'Guasto', reasonId: 'machine-stop-breakdown',
        reasonCode: 'breakdown', userId: worker.id, userName: worker.name, endedByUserId: null, endedByUserName: null}); counts.machineStops++;
    }
  }

  bumpRevision();
  if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Relazioni non valide');
  setMeta('demo-data-2026-10', JSON.stringify({generatedAt: new Date().toISOString(), history: {from: FROM, through: addDay(DEMO_DAY, -1)}, demoDay: DEMO_DAY, clock: NOW_LOCAL, simulated: true}));
  db.exec('COMMIT');

  // ---- Riepilogo e credenziali ---------------------------------------------------------------------------------------
  const summary = {
    counts: Object.fromEntries(['tasks', 'execution', 'executionEvents', 'executionLots', 'machineStops', 'qualityDecisions'].map(t => [t, db.prepare(`SELECT count(*) n FROM ${t}`).get().n])),
    byStatus: db.prepare('SELECT status, count(*) n FROM tasks GROUP BY status').all(),
    monthly: db.prepare("SELECT substr(runEndedAt,1,7) month, count(*) completed FROM execution WHERE phase='completed' GROUP BY month ORDER BY month").all(),
    quality: {decisions: decided}, release, released: db.prepare('SELECT version, userName FROM planningReleases ORDER BY version').all(),
  };
  const recentFrom = timestamp(`${addDay(DEMO_DAY, -45)}T00:00`);
  const sharedLot = db.prepare(`SELECT l.lot, l.articleCode, count(DISTINCT l.taskId) uses FROM executionLots l JOIN execution e ON e.taskId = l.taskId
    WHERE e.runEndedAt >= ? GROUP BY l.lot, l.articleCode HAVING uses >= 4 ORDER BY uses DESC, l.lot LIMIT 3`).all(recentFrom);
  const finishedLot = db.prepare("SELECT outputLot, taskTitle FROM execution WHERE phase='completed' AND outputLot IS NOT NULL ORDER BY runEndedAt DESC LIMIT 3").all();
  summary.demoExamples = {traceability: {story, componentLots: sharedLot, finishedLots: finishedLot}};
  writeFileSync(path.join(OUT, 'demo-accounts.json'), JSON.stringify(ACCOUNTS.map(({roleLabel, name, username, password}) => ({role: roleLabel, name, username, password})), null, 2));
  writeFileSync(path.join(OUT, 'demo-seed-report.json'), JSON.stringify({simulated: true, ...summary}, null, 2));
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  try { db.exec('ROLLBACK'); } catch { /* già annullato */ }
  throw error;
} finally {
  db.close();
}

// ---- Applicazione al database operativo (server spento) ----------------------------------------------------------
if (APPLY) {
  const target = path.join(SOURCE, 'aloven.sqlite');
  const port = process.env.PORT || '3000';
  const running = await fetch(`http://127.0.0.1:${port}/api/session`, {signal: AbortSignal.timeout(1500)}).then(() => true, () => false);
  if (running) throw new Error(`Aloven è acceso sulla porta ${port}: chiudi la finestra del server e riprova.`);
  const live = new DatabaseSync(target);
  try { live.exec('BEGIN IMMEDIATE'); live.exec('ROLLBACK'); } catch { throw new Error('Il database è in uso: spegni Aloven (chiudi la finestra del server) e riprova.'); }
  mkdirSync(path.join(SOURCE, 'backups'), {recursive: true});
  const backup = path.join(SOURCE, 'backups', `aloven-before-demo-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
  live.prepare('VACUUM INTO ?').run(backup);
  live.close();
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${target}${suffix}`, {force: true});
  copyFileSync(path.join(OUT, 'aloven.sqlite'), target);
  copyFileSync(path.join(OUT, 'demo-accounts.json'), path.join(SOURCE, 'demo-accounts.json'));
  copyFileSync(path.join(OUT, 'demo-seed-report.json'), path.join(SOURCE, 'demo-seed-report.json'));
  console.log(JSON.stringify({applied: true, backup}, null, 2));
}
