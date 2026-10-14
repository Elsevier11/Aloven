import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {TEST_NOW} from './test-clock.mjs';

const planningFields = ['machineId', 'setupMinutes', 'runMinutes', 'status', 'position', 'start', 'end', 'segments', 'effectiveSetupMinutes', 'fixedStart', 'setupOverrideMinutes'];
const projection = tasks => Object.fromEntries(tasks.map(task => [task.id, Object.fromEntries(planningFields.map(field => [field, structuredClone(task[field] ?? null)]))]));

test('proposta del periodo: anteprima con posizionamenti, commit annullabile (compreso l’ancoraggio), annullo invalidato dal rilascio', async () => {
  const data = mkdtempSync(path.join(tmpdir(), 'aloven-proposal-'));
  let child, base, cookie = '';
  const start = () => new Promise((resolve, reject) => {
    child = spawn(process.execPath, ['server.mjs'], {env: {...process.env, ALOVEN_NOW: TEST_NOW, PORT: '0', DATA_DIR: data, BACKUP_DIR: path.join(data, 'backups')}, stdio: ['ignore', 'pipe', 'pipe']});
    let output = '', errors = '';
    const timer = setTimeout(() => reject(new Error(errors || output || 'Server non avviato')), 15000);
    child.stdout.on('data', chunk => { output += chunk; const match = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timer); resolve(match[0]); } });
    child.stderr.on('data', chunk => errors += chunk);
    child.on('exit', () => { clearTimeout(timer); reject(new Error(output + errors)); });
  });
  const stop = async () => { const done = once(child, 'exit'); child.kill(); await done; };
  async function request(endpoint, payload, expected = 200) {
    const response = await fetch(`${base}/api/${endpoint}`, {method: payload === undefined ? 'GET' : 'POST', headers: {...(payload === undefined ? {} : {'Content-Type': 'application/json', 'X-Aloven-Request': '1'}), ...(cookie ? {Cookie: cookie} : {})}, body: payload === undefined ? undefined : JSON.stringify(payload)});
    const json = await response.json();
    assert.equal(response.status, expected, JSON.stringify(json));
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return json;
  }
  try {
    base = await start();
    await request('setup', {name: 'Admin', username: 'admin', password: 'PasswordTest123!'});
    const initial = await request('state');
    const machineId = 'CNC-01', taskIds = initial.tasks.filter(task => task.machineId === machineId && task.status === 'unplanned').map(task => task.id);
    assert.ok(taskIds.length >= 2);
    const action = {kind: 'periodProposal', from: '2026-10-12', to: '2026-10-16', machineIds: [machineId], taskIds};
    const baseline = projection(initial.tasks), anchorBefore = initial.machines.find(machine => machine.id === machineId).anchor;

    // Anteprima: i posizionamenti sono le sole attività incluse, con i segmenti; nessuna scrittura
    const preview = await request('preview', {revision: initial.revision, action});
    assert.ok(Array.isArray(preview.placements) && preview.placements.length > 0, 'l’anteprima espone i posizionamenti per il Gantt');
    assert.deepEqual(preview.placements.map(task => task.id).sort(), [...preview.proposal.included].sort(), 'solo le attività incluse');
    assert.ok(preview.placements.every(task => task.segments.length > 0 && task.machineId === machineId));
    assert.equal((await request('state')).revision, initial.revision, 'l’anteprima non scrive');
    assert.deepEqual(projection((await request('state')).tasks), baseline);

    // Commit: restituisce un token di annullamento
    const committed = await request('commit', {token: preview.token});
    assert.ok(committed.undo?.token, 'la proposta è annullabile');
    assert.equal(committed.undo.label, 'Proposta del periodo');
    let state = await request('state');
    assert.ok(state.tasks.filter(task => preview.proposal.included.includes(task.id)).every(task => task.status === 'planned'));
    const anchorAfter = state.machines.find(machine => machine.id === machineId).anchor;
    assert.notEqual(anchorAfter, anchorBefore, 'la proposta ha spostato l’ancoraggio: serve per provare il ripristino');

    // Annulla: attività e ancoraggio tornano esattamente come prima
    const undone = await request('planning/undo', {token: committed.undo.token, revision: committed.undo.revision});
    assert.ok(undone.planningState.revision > committed.undo.revision);
    state = await request('state');
    assert.deepEqual(projection(state.tasks), baseline, 'tutti i campi di pianificazione sono ripristinati');
    assert.equal(state.machines.find(machine => machine.id === machineId).anchor, anchorBefore, 'anche l’ancoraggio della macchina');
    await request('planning/undo', {token: committed.undo.token, revision: committed.undo.revision}, 409);

    // Di nuovo: dopo un rilascio l'annullamento non è più possibile
    const again = await request('preview', {revision: state.revision, action});
    const second = await request('commit', {token: again.token});
    state = await request('state');
    await request('planning/release', {revision: state.revision, reason: 'Rilascio dopo proposta'});
    await request('planning/undo', {token: second.undo.token, revision: second.undo.revision}, 409);

    // Modalità sconosciuta rifiutata
    await request('preview', {revision: (await request('state')).revision, action: {...action, mode: 'sconosciuta'}}, 400);
  } finally {
    if (child && child.exitCode === null) await stop();
    rmSync(data, {recursive: true, force: true});
  }
});
