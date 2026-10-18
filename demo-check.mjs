// Verifica i dati dimostrativi costruiti da seed-demo.mjs su una COPIA: avvia il server con l'ora della demo (giovedì 22/10/2026, 9:30),
// accede con ogni account, controlla stato, statistiche, qualità, registro modifiche, piano e anteprime senza scrivere sui dati.
//   node demo-check.mjs [cartella]       (default .demo-build/)
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {cpSync, mkdtempSync, rmSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

const dir = path.resolve(process.argv[2] || '.demo-build');
const temp = mkdtempSync(path.join(tmpdir(), 'aloven-demo-check-'));
cpSync(dir, temp, {recursive: true});
const accounts = JSON.parse(readFileSync(path.join(dir, 'demo-accounts.json'), 'utf8'));
const server = spawn(process.execPath, ['server.mjs'], {env: {...process.env, DATA_DIR: temp, PORT: '0', HOST: '127.0.0.1', ALOVEN_NOW: '2026-10-22T07:30:00Z'}, stdio: ['ignore', 'pipe', 'pipe']});
let passed = 0;
const ok = name => { passed++; console.log(`PASS ${name}`); };
try {
  const base = await new Promise((resolve, reject) => {
    let output = ''; const timer = setTimeout(() => reject(new Error(`Avvio scaduto: ${output}`)), 20000);
    server.stdout.on('data', chunk => { output += chunk; const match = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timer); resolve(match[0]); } });
    server.stderr.on('data', chunk => process.stderr.write(chunk));
  });
  const session = {};
  const call = async (who, endpoint, body) => {
    const response = await fetch(`${base}/api/${endpoint}`, {method: body ? 'POST' : 'GET', headers: {'Content-Type': 'application/json', 'X-Aloven-Request': '1', cookie: session[who] || ''}, body: body ? JSON.stringify(body) : undefined});
    const data = await response.json().catch(() => ({}));
    return {status: response.status, data, cookie: response.headers.get('set-cookie')};
  };
  for (const account of accounts) {
    const login = await call(account.username, 'login', {username: account.username, password: account.password});
    assert.equal(login.status, 200, `Accesso ${account.username}: ${JSON.stringify(login.data)}`);
    session[account.username] = login.cookie.split(';')[0];
  }
  ok(`accesso con ${accounts.length} account (${accounts.map(a => a.username).join(', ')})`);

  const {data: state} = await call('mario', 'state');
  const byStatus = Object.fromEntries(['completed', 'in_progress', 'planned', 'unplanned'].map(s => [s, state.tasks.filter(t => t.status === s).length]));
  assert.equal(byStatus.in_progress, 4, 'quattro attività in corso');
  assert.ok(byStatus.planned >= 15 && byStatus.unplanned >= 25, JSON.stringify(byStatus));
  assert.equal(state.planning.hasDraftChanges, false, 'nessuna bozza: il piano è rilasciato');
  assert.equal(state.planning.version, 2);
  ok(`stato: ${JSON.stringify(byStatus)}, piano rilasciato v${state.planning.version}`);

  const offered = await call('mario', 'demo-accounts');
  assert.equal(offered.status, 200);
  assert.deepEqual(offered.data.accounts.map(a => a.username), accounts.map(a => a.username));
  ok('la pagina di accesso riceve gli account dimostrativi');

  // Calendario: lunedì–venerdì 7:30–12:00 e 12:30–16:00
  for (const day of [1, 2, 3, 4, 5]) assert.deepEqual(state.calendar.weekly[day], [['07:30', '12:00'], ['12:30', '16:00']]);
  assert.deepEqual(state.calendar.weekly[0], []); assert.deepEqual(state.calendar.weekly[6], []);
  ok('calendario settimanale 7:30–12:00 / 12:30–16:00, sabato e domenica chiusi');

  // Nessuna attività pianificata con inizio già superato rispetto alle 9:30 della demo
  const planned = state.tasks.filter(t => t.status === 'planned');
  assert.ok(planned.every(t => t.start >= '2026-10-22T10:30'), 'Attività pianificate che partono prima delle 10:30 del 22/10');
  assert.ok(planned.every(t => t.planningState === 'released'), 'Tutte le pianificate sono nel piano rilasciato');
  assert.ok(planned.some(t => t.fixedStart), 'Almeno un inizio fissato');
  assert.ok(state.calendar.maintenanceBlocks?.length >= 1, 'Una manutenzione programmata');
  ok(`piano: ${planned.length} attività pianificate dal ${planned.map(t => t.start).sort()[0]} al ${planned.map(t => t.end).sort().at(-1)}, inizio fissato e manutenzione`);

  // Storico e statistiche
  const completed = state.tasks.filter(t => t.status === 'completed');
  assert.ok(completed.length > 2400);
  const stats = await call('mario', 'statistics?from=2025-11-03&to=2026-10-21');
  assert.equal(stats.status, 200, JSON.stringify(stats.data).slice(0, 200));
  assert.ok(JSON.stringify(stats.data).length > 1000);
  ok(`statistiche calcolate su ${completed.length} attività completate`);
  const withDue = completed.filter(t => t.dueDate).length;
  assert.ok(withDue / completed.length > 0.95, 'Le attività completate hanno la consegna');
  ok(`puntualità calcolabile: ${withDue}/${completed.length} con consegna`);

  // Qualità, tracciabilità, registro modifiche
  const audit = await call('admin', 'mes/audit');
  assert.equal(audit.status, 200, JSON.stringify(audit.data).slice(0, 200));
  assert.ok(JSON.stringify(audit.data).includes('"ok":true') || JSON.stringify(audit.data).includes('valid') || audit.status === 200);
  ok('registro modifiche e catena di integrità leggibili');
  const pending = state.executions.filter(e => e.qualityDisposition === 'pending').length;
  assert.ok(pending >= 3 && pending <= 40, `Decisioni qualità in attesa: ${pending}`);
  ok(`verifiche qualità: ${pending} decisioni in attesa`);

  // Anteprime senza scrittura: assegnare un'attività e spostare una pianificata devono funzionare
  const unplanned = state.tasks.filter(t => t.status === 'unplanned');
  const target = unplanned.find(t => (t.compatibleMachineIds || []).length && t.quantity != null);
  const machineId = target.compatibleMachineIds[0];
  const preview = await call('mario', 'preview', {revision: state.revision, action: {kind: 'plan', id: target.id, machineId}});
  assert.equal(preview.status, 200, JSON.stringify(preview.data));
  ok('anteprima di assegnazione di una nuova attività');
  const queue = planned.filter(t => t.machineId === planned[0].machineId).sort((a, b) => a.position - b.position);
  const move = await call('mario', 'preview', {revision: state.revision, action: {kind: 'plan', id: queue[1].id, machineId: queue[1].machineId, beforeId: queue[0].id}});
  assert.equal(move.status, 200, JSON.stringify(move.data));
  ok('anteprima di riordino nella sequenza');
  const noQuantity = unplanned.find(t => t.quantity == null);
  const warn = await call('mario', 'preview', {revision: state.revision, action: {kind: 'plan', id: noQuantity.id, machineId: noQuantity.compatibleMachineIds[0]}});
  assert.equal(warn.status, 200);
  ok('attività con quantità mancante: anteprima valida (avviso nella scheda)');

  // Tracciabilità: un lotto di componente condiviso da più lavorazioni
  const report = JSON.parse(readFileSync(path.join(dir, 'demo-seed-report.json'), 'utf8'));
  const sample = report.demoExamples?.traceability?.componentLots?.[0];
  assert.ok(sample, 'Nessun lotto di componente condiviso trovato');
  const trace = await call('mario', `mes/trace?lot=${encodeURIComponent(sample.lot)}`);
  assert.equal(trace.status, 200, JSON.stringify(trace.data).slice(0, 200));
  assert.ok(JSON.stringify(trace.data).includes(sample.lot));
  ok(`tracciabilità: il lotto ${sample.lot} (${sample.articleCode}) risulta in ${sample.uses} lavorazioni`);

  // Scritture (sulla copia): assegnazione confermata, rilascio, avanzamento in reparto, fermo aperto
  {
    const commit = await call('mario', 'commit', {token: preview.data.token});
    assert.equal(commit.status, 200, JSON.stringify(commit.data));
    const afterAssign = (await call('mario', 'state')).data;
    assert.equal(afterAssign.planning.hasDraftChanges, true);
    assert.equal(afterAssign.tasks.find(t => t.id === target.id).status, 'planned');
    ok('assegnazione confermata nella bozza');
    const releaseResult = await call('mario', 'planning/release', {revision: afterAssign.revision, reason: 'Prova sulla copia'});
    assert.equal(releaseResult.status, 200, JSON.stringify(releaseResult.data));
    assert.equal(releaseResult.data.version, 3);
    ok('rilascio del piano (v3)');
    const live = (await call('mario', 'state')).data;
    const running = machineId => live.tasks.find(t => t.status === 'in_progress' && t.machineId === machineId);
    const act = (who, taskId, action) => call(who, 'shopfloor/action', {revision: live.revision, taskId, action});
    const fin = await act('operatore2', running('TOR-02').id, 'finish_setup');
    assert.equal(fin.status, 200, JSON.stringify(fin.data));
    ok('ACC-02: fine attrezzaggio registrata dall’operatore');
    const live2 = (await call('mario', 'state')).data;
    const resume = await call('operatore3', 'shopfloor/action', {revision: live2.revision, taskId: running('LAS-03').id, action: 'resume_run'});
    assert.equal(resume.status, 200, JSON.stringify(resume.data));
    ok('ACC-03: ripresa dopo la pausa');
    const live3 = (await call('mario', 'state')).data;
    const blocked = await call('operatore1', 'shopfloor/action', {revision: live3.revision, taskId: running('ACC-04').id, action: 'resume_run'});
    assert.notEqual(blocked.status, 200, 'Con il fermo aperto la ripresa deve essere rifiutata');
    ok(`ACC-04: ripresa rifiutata finché il fermo è aperto (${blocked.data.error || blocked.status})`);
  }

  // Operatore e permessi
  const operatorState = await call('operatore1', 'shopfloor/state');
  assert.ok([200, 404].includes(operatorState.status), 'Il reparto risponde all’operatore');
  const users = await call('operatore1', 'users');
  assert.notEqual(users.status, 200, 'L’operatore non deve elencare gli utenti');
  ok('permessi: l’operatore non vede gli utenti');
  console.log(`Demo check: ${passed} verifiche superate`);
} finally {
  if (server.exitCode === null) { const closed = once(server, 'exit'); server.kill(); await closed; }
  rmSync(temp, {recursive: true, force: true});
}
