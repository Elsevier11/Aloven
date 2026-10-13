import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import {TEST_NOW} from './test-clock.mjs';

test('API MES: ordine, consuntivo, tracciabilità, rettifiche, qualità, audit, backup e riavvio', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'aloven-mes-http-'));
  let child;
  let base;
  let cookie = '';

  async function start() {
    child = spawn(process.execPath, ['server.mjs'], {
      env: {...process.env, ALOVEN_NOW: TEST_NOW, PORT: '0', DATA_DIR: dataDir, BACKUP_DIR: path.join(dataDir, 'backups'), BACKUP_INTERVAL_HOURS: '24'},
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error(`Server non avviato: ${output}`)), 15_000);
      child.stdout.on('data', chunk => {
        output += chunk;
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) { clearTimeout(timer); resolve(match[0]); }
      });
      child.stderr.on('data', chunk => { output += chunk; });
      child.on('exit', code => { clearTimeout(timer); reject(new Error(`Server terminato (${code}): ${output}`)); });
    });
  }

  async function stop() {
    if (child?.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
  }

  async function request(endpoint, data, expected = 200, session = cookie) {
    const response = await fetch(`${base}/api/${endpoint}`, {
      method: data === undefined ? 'GET' : 'POST',
      headers: {
        ...(data === undefined ? {} : {'Content-Type': 'application/json', 'X-Aloven-Request': '1'}),
        ...(session ? {Cookie: session} : {}),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const json = await response.json();
    assert.equal(response.status, expected, `${endpoint}: ${JSON.stringify(json)}`);
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return json;
  }

  async function change(action, session = cookie) {
    const state = await request('state', undefined, 200, session);
    const preview = await request('preview', {revision: state.revision, action}, 200, session);
    await request('commit', {token: preview.token}, 200, session);
    if(action.kind==='plan'){const next=await request('state',undefined,200,session);await request('planning/release',{revision:next.revision},200,session);}
    return request('state', undefined, 200, session);
  }

  async function shopfloor(taskId, action, values = {}, session = cookie) {
    const state = await request('state', undefined, 200, session);
    await request('shopfloor/action', {revision: state.revision, taskId, action, ...(action === 'finish_run' ? {plausibilityReason:'Chiusura istantanea della prova automatica'} : {}), ...values}, 200, session);
    return request('state', undefined, 200, session);
  }

  async function login(username) {
    await request('login', {username, password: 'PasswordTest123!'});
    return cookie;
  }

  const noPasswordKeys = value => {
    if (!value || typeof value !== 'object') return true;
    return Object.entries(value).every(([key, childValue]) => key.toLowerCase() !== 'password' && noPasswordKeys(childValue));
  };

  try {
    base = await start();
    await request('setup', {name: 'Amministratore MES', username: 'admin', password: 'PasswordTest123!'});
    const adminCookie = cookie;
    await request('users', {name: 'Operatore MES', username: 'operator', password: 'PasswordTest123!', role: 'operator'});

    let state = await request('state');
    assert.ok(state.tasks.some(task => task.orderReference === null && task.erpReference === null && task.outputLot === null), 'la migrazione non inventa riferimenti o lotti sui dati esistenti');
    const template = state.tasks.find(task => task.status === 'unplanned');
    assert.ok(template?.component1ArticleId && template?.component2ArticleId && template?.productArticleId);
    const values = {
      title: 'Ordine MES HTTP', machineId: template.machineId, typeId: template.typeId,
      setupMinutes: 0, runMinutes: 30, quantity: 20, calculationMode: 'manual', notes: 'Creazione ordine MES per prova HTTP',
      component1ArticleId: template.component1ArticleId, component2ArticleId: template.component2ArticleId, productArticleId: template.productArticleId,
      orderReference: 'ORD-HTTP-001', erpReference: 'ARCA-7788', customer: 'Cliente prova', dueDate: '2026-12-18', outputLot: 'LOT-OUT-001',
    };
    await request('preview', {revision: state.revision, action: {kind: 'task', values: {...values, dueDate: '2026-02-30'}}}, 400);
    await request('preview', {revision: state.revision, action: {kind: 'task', values: {...values, outputLot: 'lot\nnon-valido'}}}, 400);
    state = await change({kind: 'task', values});
    const task = state.tasks.find(item => item.orderReference === values.orderReference);
    assert.ok(task);
    assert.deepEqual(
      {erpReference: task.erpReference, customer: task.customer, dueDate: task.dueDate, outputLot: task.outputLot},
      {erpReference: values.erpReference, customer: values.customer, dueDate: values.dueDate, outputLot: values.outputLot},
    );
    state = await change({kind: 'plan', id: task.id});
    assert.equal(state.tasks.find(item => item.id === task.id).status, 'planned');

    const operatorCookie = await login('operator');
    await request('backups', undefined, 403, operatorCookie);
    await request('backups/run', {}, 403, operatorCookie);
    state = await shopfloor(task.id, 'start_run', {}, operatorCookie);
    const execution = state.executions.find(item => item.taskId === task.id);
    assert.ok(execution);
    const finish = {
      producedQuantity: 18, scrapQuantity: 2, scrapReasonId: state.scrapReasons.find(item => item.active)?.id,
      qualityStatus: 'nonconforming', qualityNotes: 'Verificare adesione', qualityChecks: {appearance: 'pass', bonding: 'fail'},
      outputLot: 'LOT-OUT-001', operationId: 'finish-http-1',
      lots: [
        {component: 'component1', lot: 'LOT-IN-A', quantity: 12},
        {component: 'component2', lot: 'LOT-IN-B', quantity: 10},
      ],
    };
    state = await shopfloor(task.id, 'finish_run', finish, operatorCookie);
    let completed = state.executions.find(item => item.taskId === task.id);
    assert.deepEqual(
      {phase: completed.phase, outputLot: completed.outputLot, qualityDisposition: completed.qualityDisposition},
      {phase: 'completed', outputLot: 'LOT-OUT-001', qualityDisposition: 'pending'},
    );

    const inputTrace = await request('mes/trace?lot=lot-in-a&direction=input', undefined, 200, operatorCookie);
    assert.equal(inputTrace.records.length, 1);
    assert.deepEqual(inputTrace.records[0].matchedDirections, ['input']);
    assert.equal(inputTrace.records[0].outputLot, 'LOT-OUT-001');
    const outputTrace = await request(`mes/trace?lot=lot-out-001&direction=output&articleCode=${encodeURIComponent(completed.productCode)}`, undefined, 200, operatorCookie);
    assert.equal(outputTrace.records.length, 1);
    assert.deepEqual(outputTrace.records[0].inputLots.map(item => item.lot).sort(), ['LOT-IN-A', 'LOT-IN-B']);
    assert.equal((await request('mes/trace?lot=lot-out-001&direction=input', undefined, 200, operatorCookie)).records.length, 0);
    assert.equal((await request('mes/trace?lot=lot-out-001&direction=output&articleCode=ALTRO', undefined, 200, operatorCookie)).records.length, 0);

    const correctionBase = {
      taskId: task.id, operationId: 'correction-http-1', reason: 'Rettifica dopo controllo documentale',
      producedQuantity: 19, scrapQuantity: 1, scrapReasonId: finish.scrapReasonId,
      qualityStatus: 'conforming', qualityNotes: '', qualityChecks: {appearance: 'pass', bonding: 'pass'}, outputLot: 'LOT-OUT-001-R',
      lots: [
        {component: 'component1', lot: 'LOT-IN-A-R', quantity: 13},
        {component: 'component2', lot: 'LOT-IN-B-R', quantity: 11},
      ],
    };
    await request('mes/correction', {...correctionBase, revision: state.revision}, 403, operatorCookie);
    cookie = adminCookie;
    state = await request('state');
    await request('mes/correction', {...correctionBase, revision: state.revision - 1, operationId: 'correction-stale'}, 409);
    const corrected = await request('mes/correction', {...correctionBase, revision: state.revision});
    assert.equal(corrected.revision, state.revision + 1);
    assert.equal((await request('mes/correction', {...correctionBase, revision: state.revision})).replay, true);
    state = await request('state');
    completed = state.executions.find(item => item.taskId === task.id);
    assert.deepEqual(
      {producedQuantity: completed.producedQuantity, scrapQuantity: completed.scrapQuantity, outputLot: completed.outputLot, qualityDisposition: completed.qualityDisposition},
      {producedQuantity: 19, scrapQuantity: 1, outputLot: 'LOT-OUT-001-R', qualityDisposition: 'pending'},
    );

    await request('mes/quality', {taskId: task.id, revision: state.revision, operationId: 'quality-pending', disposition: 'pending', reason: 'Non è una decisione finale'}, 400);
    await request('mes/quality', {taskId: task.id, revision: state.revision, operationId: 'quality-operator', disposition: 'released', reason: 'Prova permessi'}, 403, operatorCookie);
    const quantities = {producedQuantity: completed.producedQuantity, scrapQuantity: completed.scrapQuantity};
    for (const disposition of ['released', 'scrapped', 'rework']) {
      state = await request('state');
      const decision = {taskId: task.id, revision: state.revision, operationId: `quality-${disposition}`, disposition, reason: `Decisione ${disposition} verificata`};
      await request('mes/quality', decision);
      assert.equal((await request('mes/quality', decision)).replay, true);
      completed = (await request('state')).executions.find(item => item.taskId === task.id);
      assert.equal(completed.qualityDisposition, disposition);
      assert.deepEqual({producedQuantity: completed.producedQuantity, scrapQuantity: completed.scrapQuantity}, quantities, 'la classificazione non modifica le quantità');
    }

    state = await request('state');
    await request('preview', {revision: state.revision, action: {kind: 'plan', id: task.id, unplan: true}}, 400);
    await request('preview', {revision: state.revision, action: {kind: 'task', id: task.id, values: {...values, title: 'Modifica vietata'}}}, 400);

    await request(`mes/audit?taskId=${encodeURIComponent(task.id)}`, undefined, 403, operatorCookie);
    const audit = await request(`mes/audit?taskId=${encodeURIComponent(task.id)}&limit=100`);
    assert.ok(audit.total >= 6);
    assert.equal(noPasswordKeys(audit), true);
    assert.equal(JSON.stringify(audit).includes('PasswordTest123!'), false);
    const planningAudit = audit.items.find(item => item.action === 'commit' && item.after?.tasks?.some(row => row.id === task.id && row.status === 'planned'));
    assert.ok(planningAudit, 'audit della pianificazione non trovato');
    assert.deepEqual(Object.keys(planningAudit.before), ['tasks']);
    assert.deepEqual(Object.keys(planningAudit.after), ['tasks']);
    assert.ok(planningAudit.before.tasks.every(row => row.id === task.id));
    assert.ok(planningAudit.after.tasks.every(row => row.id === task.id));

    const backupBefore = await request('backups');
    assert.equal(backupBefore.targetDirectory, path.resolve(dataDir, 'backups'));
    const backupAfter = await request('backups/run', {});
    assert.ok(backupAfter.lastSuccessAt);
    assert.equal(backupAfter.lastError, null);

    const beforeRestart = await request('state');
    const durableExecution = beforeRestart.executions.find(item => item.taskId === task.id);
    await stop();
    base = await start();
    cookie = adminCookie;
    const afterRestart = await request('state');
    const restoredTask = afterRestart.tasks.find(item => item.id === task.id);
    const restoredExecution = afterRestart.executions.find(item => item.taskId === task.id);
    assert.deepEqual(
      {orderReference: restoredTask.orderReference, erpReference: restoredTask.erpReference, customer: restoredTask.customer, dueDate: restoredTask.dueDate, outputLot: restoredTask.outputLot},
      {orderReference: values.orderReference, erpReference: values.erpReference, customer: values.customer, dueDate: values.dueDate, outputLot: values.outputLot},
    );
    assert.deepEqual(
      {producedQuantity: restoredExecution.producedQuantity, scrapQuantity: restoredExecution.scrapQuantity, outputLot: restoredExecution.outputLot, qualityDisposition: restoredExecution.qualityDisposition},
      {producedQuantity: durableExecution.producedQuantity, scrapQuantity: durableExecution.scrapQuantity, outputLot: durableExecution.outputLot, qualityDisposition: durableExecution.qualityDisposition},
    );
    assert.ok(afterRestart.tasks.filter(item => item.id !== task.id).some(item => item.outputLot === null && item.orderReference === null), 'il riavvio/migrazione non inventa dati legacy');
  } finally {
    await stop();
    rmSync(dataDir, {recursive: true, force: true});
  }
});
