import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {TEST_NOW} from './test-clock.mjs';

test('suggerimento di attrezzaggio: endpoint riservato a chi pianifica, mediana dallo storico', async () => {
  const data = mkdtempSync(path.join(tmpdir(), 'aloven-setup-suggestion-'));
  let child, base, db;
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
  try {
    base = await new Promise((resolve, reject) => {
      child = spawn(process.execPath, ['server.mjs'], {env: {...process.env, ALOVEN_NOW: TEST_NOW, PORT: '0', DATA_DIR: data, BACKUP_DIR: path.join(data, 'backups')}, stdio: ['ignore', 'pipe', 'pipe']});
      let output = '';
      const timer = setTimeout(() => reject(new Error(output || 'Server non avviato')), 15000);
      child.stdout.on('data', chunk => { output += chunk; const match = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timer); resolve(match[0]); } });
      child.on('exit', () => { clearTimeout(timer); reject(new Error(output)); });
    });
    assert.equal((await call('admin', 'setup', {name: 'Admin', username: 'admin', password: 'PasswordTest123!'})).status, 200);
    assert.equal((await call('admin', 'users', {name: 'Operatore', username: 'op', password: 'PasswordTest123!', role: 'operator'})).status, 200);
    assert.equal((await call('op', 'login', {username: 'op', password: 'PasswordTest123!'})).status, 200);
    const state = (await call('admin', 'state')).body;
    const machine = state.machines[0], article = state.articles.find(item => item.kind === 'product' || item.kind === 'both');
    const query = `setup-suggestion?machineId=${encodeURIComponent(machine.id)}&productArticleId=${encodeURIComponent(article.id)}`;

    assert.equal((await call('op', query)).status, 403, 'l\'operatore non pianifica');
    assert.deepEqual((await call('admin', query)).body, {suggestion: null}, 'nessuno storico: nessun suggerimento');

    // tre attrezzaggi reali dello stesso articolo sulla stessa macchina: 20, 30 e 100 minuti → mediana 30
    db = new DatabaseSync(path.join(data, 'aloven.sqlite'));
    db.exec('PRAGMA busy_timeout=5000');
    const columns = db.prepare('PRAGMA table_info(execution)').all().map(column => column.name);
    assert.ok(['setupStartedAt', 'setupEndedAt', 'machineId', 'productCode'].every(name => columns.includes(name)));
    const insert = db.prepare('INSERT INTO execution(taskId,phase,taskTitle,machineId,productCode,productDescription,productUnit,component1Code,component1Description,component1Unit,component2Code,component2Description,component2Unit,setupStartedAt,setupEndedAt,runEndedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    [20, 30, 100].forEach((minutes, index) => {
      const start = Date.parse('2026-09-01T08:00:00Z') + index * 86400000;
      insert.run(`hist-${index}`, 'completed', 'Storico di prova', machine.id, article.code, article.description, article.unit, 'C1', 'Componente 1', 'm', 'C2', 'Componente 2', 'm', new Date(start).toISOString(), new Date(start + minutes * 60000).toISOString(), new Date(start + 7200000).toISOString());
    });
    db.close();
    db = null;
    const result = (await call('admin', query)).body;
    assert.deepEqual(result.suggestion, {minutes: 30, basis: 'article', count: 3});
    assert.deepEqual((await call('admin', `setup-suggestion?machineId=${machine.id}&productArticleId=inesistente`)).body, {suggestion: null}, 'articolo sconosciuto: ripiega sul solo storico di macchina, che qui è insufficiente');
  } finally {
    db?.close();
    if (child && child.exitCode === null) { const done = once(child, 'exit'); child.kill(); await done.catch(() => {}); }
    rmSync(data, {recursive: true, force: true, maxRetries: 20, retryDelay: 250});
  }
});
