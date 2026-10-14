import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {TEST_NOW} from './test-clock.mjs';

test('permessi per ruolo: operatore solo bordo macchina, pianificatore pianifica e rilascia, anagrafiche e amministrazione solo admin', async () => {
  const data = mkdtempSync(path.join(tmpdir(), 'aloven-roles-'));
  let child, base;
  const start = () => new Promise((resolve, reject) => {
    child = spawn(process.execPath, ['server.mjs'], {env: {...process.env, ALOVEN_NOW: TEST_NOW, PORT: '0', DATA_DIR: data, BACKUP_DIR: path.join(data, 'backups')}, stdio: ['ignore', 'pipe', 'pipe']});
    let output = '', errors = '';
    const timer = setTimeout(() => reject(new Error(errors || output || 'Server non avviato')), 15000);
    child.stdout.on('data', chunk => { output += chunk; const match = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timer); resolve(match[0]); } });
    child.stderr.on('data', chunk => errors += chunk);
    child.on('exit', () => { clearTimeout(timer); reject(new Error(output + errors)); });
  });
  const stop = async () => { const done = once(child, 'exit'); child.kill(); await done; };
  // Ogni ruolo ha la sua sessione; call() restituisce stato e corpo senza lanciare.
  const sessions = {};
  const call = async (who, endpoint, payload) => {
    const response = await fetch(`${base}/api/${endpoint}`, {
      method: payload === undefined ? 'GET' : 'POST',
      headers: {...(payload === undefined ? {} : {'Content-Type': 'application/json', 'X-Aloven-Request': '1'}), ...(sessions[who] ? {Cookie: sessions[who]} : {})},
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (response.headers.get('set-cookie')) sessions[who] = response.headers.get('set-cookie').split(';')[0];
    return {status: response.status, body};
  };
  const ok = async (who, endpoint, payload) => { const r = await call(who, endpoint, payload); assert.equal(r.status, 200, `${who} ${endpoint}: ${JSON.stringify(r.body)}`); return r.body; };
  const denied = async (who, endpoint, payload) => { const r = await call(who, endpoint, payload); assert.equal(r.status, 403, `${who} ${endpoint} doveva dare 403, ha dato ${r.status}: ${JSON.stringify(r.body)}`); };
  const reachesLogic = async (who, endpoint, payload) => { const r = await call(who, endpoint, payload); assert.ok(![401, 403].includes(r.status), `${who} ${endpoint} non deve essere bloccato per ruolo (${r.status}: ${JSON.stringify(r.body)})`); };
  try {
    base = await start();
    await ok('admin', 'setup', {name: 'Admin', username: 'admin', password: 'PasswordTest123!'});
    for (const [role, name] of [['planner', 'Pianificatore'], ['operator', 'Operatore']]) await ok('admin', 'users', {name, username: role, password: 'PasswordTest123!', role});
    await ok('planner', 'login', {username: 'planner', password: 'PasswordTest123!'});
    await ok('operator', 'login', {username: 'operator', password: 'PasswordTest123!'});
    const invalidRole = await call('admin', 'users', {name: 'Ruolo falso', username: 'falso', password: 'PasswordTest123!', role: 'superuser'});
    assert.equal(invalidRole.status, 400, 'un ruolo inesistente è rifiutato come non valido');

    // --- Operatore: solo bordo macchina
    const shopfloor = await ok('operator', 'state?view=shopfloor');
    assert.deepEqual(shopfloor.users, []);
    await denied('operator', 'state');
    await denied('operator', 'state?view=planning');
    for (const kind of ['plan', 'task', 'status', 'setupOverride', 'realign', 'calendar', 'maintenance', 'periodProposal', 'machine', 'type', 'article', 'setupRule'])
      await denied('operator', 'preview', {revision: shopfloor.revision, action: {kind}});
    await denied('operator', 'planning/release', {revision: shopfloor.revision});
    await denied('operator', 'planning/undo', {token: 'x', revision: shopfloor.revision});
    await denied('operator', 'planning/interruption-request', {revision: shopfloor.revision, taskId: 'x', reason: 'prova'});
    for (const endpoint of ['statistics', 'statistics/export', 'mes/trace?lot=x', 'mes/audit', 'backups']) await denied('operator', endpoint);
    await denied('operator', 'users', {name: 'X', username: 'x', password: 'PasswordTest123!', role: 'operator'});
    await denied('operator', 'scrap-reasons', {revision: shopfloor.revision, code: 'x', description: 'X', active: true});
    await reachesLogic('operator', 'shopfloor/action', {revision: shopfloor.revision, taskId: 'inesistente', action: 'start_setup'});
    await reachesLogic('operator', 'machine-stop', {revision: shopfloor.revision, machineId: 'CNC-01', action: 'stop', reasonId: 'inesistente'});
    await ok('operator', 'logout', {});

    // --- Pianificatore: pianifica, rilascia, calendario, causali, statistiche
    let state = await ok('planner', 'state');
    assert.deepEqual(state.users, [], 'solo l’amministratore vede l’elenco utenti');
    const task = state.tasks.find(item => item.status === 'unplanned');
    const preview = await ok('planner', 'preview', {revision: state.revision, action: {kind: 'plan', id: task.id}});
    await ok('planner', 'commit', {token: preview.token});
    state = await ok('planner', 'state');
    const released = await ok('planner', 'planning/release', {revision: state.revision, reason: 'Rilascio del pianificatore'});
    assert.equal(released.version, 1);
    const calendar = structuredClone(state.calendar);
    await ok('planner', 'preview', {revision: (await ok('planner', 'state')).revision, action: {kind: 'calendar', values: calendar}});
    await ok('planner', 'statistics');
    await ok('planner', 'mes/trace?lot=nessuno');
    await ok('planner', 'scrap-reasons', {revision: (await ok('planner', 'state')).revision, code: 'pian', description: 'Causale del pianificatore', active: true});
    await reachesLogic('planner', 'planning/interruption-request', {revision: (await ok('planner', 'state')).revision, taskId: task.id, reason: 'prova'});
    // Cosa il pianificatore non può fare
    const revision = (await ok('planner', 'state')).revision;
    for (const kind of ['machine', 'type', 'article', 'setupRule']) await denied('planner', 'preview', {revision, action: {kind}});
    await denied('planner', 'users', {name: 'X', username: 'x2', password: 'PasswordTest123!', role: 'operator'});
    for (const endpoint of ['backups', 'mes/audit']) await denied('planner', endpoint);
    await denied('planner', 'backups/run', {});
    await denied('planner', 'mes/correction', {revision, taskId: task.id, reason: 'prova'});
    await denied('planner', 'mes/quality', {revision, taskId: task.id, disposition: 'released', reason: 'prova'});

    // --- Amministratore: anagrafiche e amministrazione
    await ok('admin', 'backups');
    await ok('admin', 'mes/audit');
    assert.ok((await ok('admin', 'state')).users.length >= 3);
    await reachesLogic('admin', 'preview', {revision: (await ok('admin', 'state')).revision, action: {kind: 'machine', id: 'inesistente', remove: true}});
  } finally {
    if (child && child.exitCode === null) await stop();
    rmSync(data, {recursive: true, force: true});
  }
});
