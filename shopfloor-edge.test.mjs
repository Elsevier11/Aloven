import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

test('bordo macchina gestisce concorrenza, pause ripetute e rifiuti atomici; la quantita parziale conclude', async () => {
  const data = mkdtempSync(path.join(tmpdir(), 'aloven-shopfloor-edge-'));
  let child;
  let base;
  let cookie = '';

  async function start() {
    child = spawn(process.execPath, ['server.mjs'], {
      env: {...process.env, PORT: '0', DATA_DIR: data},
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error(`Server non avviato: ${output}`)), 10000);
      child.stdout.on('data', chunk => {
        output += chunk;
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) {
          clearTimeout(timer);
          resolve(match[0]);
        }
      });
      child.stderr.on('data', chunk => { output += chunk; });
      child.on('exit', () => {
        clearTimeout(timer);
        reject(new Error(`Server terminato: ${output}`));
      });
    });
  }

  async function response(endpoint, options = {}) {
    const result = await fetch(`${base}/api/${endpoint}`, {
      ...options,
      headers: {
        ...(options.body ? {'Content-Type': 'application/json', 'X-Aloven-Request': '1'} : {}),
        ...(cookie ? {Cookie: cookie} : {}),
        ...options.headers,
      },
    });
    const json = await result.json();
    if (result.headers.get('set-cookie')) cookie = result.headers.get('set-cookie').split(';')[0];
    return {status: result.status, json};
  }

  async function request(endpoint, data, expected = 200) {
    const result = await response(endpoint, {
      method: data ? 'POST' : 'GET',
      body: data ? JSON.stringify(data) : undefined,
    });
    assert.equal(result.status, expected, JSON.stringify(result.json));
    return result.json;
  }

  async function change(action) {
    const state = await request('state');
    const preview = await request('preview', {revision: state.revision, action});
    await request('commit', {token: preview.token});
    return request('state');
  }

  async function action(taskId, name, values = {}, expected = 200, revision) {
    const state = revision === undefined ? await request('state') : null;
    return request('shopfloor/action', {
      revision: revision ?? state.revision,
      taskId,
      action: name,
      ...values,
    }, expected);
  }

  async function login(username) {
    await request('login', {username, password: 'PasswordTest123!'});
    return cookie;
  }

  async function stop() {
    if (child?.exitCode === null) {
      const done = once(child, 'exit');
      child.kill();
      await done;
    }
  }

  function persistedExecution(state, taskId) {
    const execution = state.executions.find(item => item.taskId === taskId);
    const task = state.tasks.find(item => item.id === taskId);
    return {
      revision: state.revision,
      taskStatus: task.status,
      phase: execution.phase,
      runActiveSeconds: execution.runActiveSeconds,
      lastRunStartedAt: execution.lastRunStartedAt,
      producedQuantity: execution.producedQuantity,
      scrapQuantity: execution.scrapQuantity,
      qualityStatus: execution.qualityStatus,
      events: execution.events,
      lots: execution.lots,
    };
  }

  async function rejectUnchanged(taskId, values, expected = 400) {
    const before = await request('state');
    await action(taskId, 'finish_run', values, expected, before.revision);
    const after = await request('state');
    assert.deepEqual(persistedExecution(after, taskId), persistedExecution(before, taskId));
  }

  try {
    base = await start();
    await request('setup', {name: 'Amministratore', username: 'admin', password: 'PasswordTest123!'});
    await request('users', {name: 'Operatore Edge', username: 'edge', password: 'PasswordTest123!', role: 'operator'});
    const adminCookie = cookie;

    let state = await request('state');
    const source = state.tasks.find(item => item.status === 'unplanned');
    const machine = state.machines.find(item => item.id === source.machineId);
    assert.ok(source && machine);
    state = await change({kind: 'task', values: {
      title: 'Edge bordo macchina',
      machineId: machine.id,
      typeId: source.typeId,
      setupMinutes: 0,
      runMinutes: 20,
      quantity: 10,
      calculationMode: 'manual',
      notes: '',
      component1ArticleId: source.component1ArticleId,
      component2ArticleId: source.component2ArticleId,
      productArticleId: source.productArticleId,
    }});
    const task = state.tasks.find(item => item.title === 'Edge bordo macchina');
    state = await change({kind: 'plan', id: task.id});

    await login('edge');
    await action(task.id, 'start_run');

    let before = await request('state');
    const pausePayload = {
      revision: before.revision,
      taskId: task.id,
      action: 'pause_run',
      reason: 'Pausa concorrente',
    };
    let results = await Promise.all([
      response('shopfloor/action', {method: 'POST', body: JSON.stringify(pausePayload)}),
      response('shopfloor/action', {method: 'POST', body: JSON.stringify(pausePayload)}),
    ]);
    assert.deepEqual(results.map(item => item.status).sort(), [200, 409]);
    state = await request('state');
    let execution = state.executions.find(item => item.taskId === task.id);
    assert.equal(execution.phase, 'run_paused');
    assert.equal(execution.events.filter(item => item.action === 'pause_run').length, 1);

    const resumePayload = {revision: state.revision, taskId: task.id, action: 'resume_run'};
    results = await Promise.all([
      response('shopfloor/action', {method: 'POST', body: JSON.stringify(resumePayload)}),
      response('shopfloor/action', {method: 'POST', body: JSON.stringify(resumePayload)}),
    ]);
    assert.deepEqual(results.map(item => item.status).sort(), [200, 409]);
    state = await request('state');
    execution = state.executions.find(item => item.taskId === task.id);
    assert.equal(execution.phase, 'run_running');
    assert.equal(execution.events.filter(item => item.action === 'resume_run').length, 1);

    for (let index = 0; index < 3; index += 1) {
      await action(task.id, 'pause_run', {reason: `Pausa ${index + 1}`});
      await action(task.id, 'resume_run');
    }
    state = await request('state');
    execution = state.executions.find(item => item.taskId === task.id);
    assert.equal(execution.phase, 'run_running');
    assert.equal(execution.events.filter(item => item.action === 'pause_run').length, 4);
    assert.equal(execution.events.filter(item => item.action === 'resume_run').length, 4);

    before = await request('state');
    await action(task.id, 'resume_run', {}, 409, before.revision);
    assert.deepEqual(persistedExecution(await request('state'), task.id), persistedExecution(before, task.id));

    const lots = [
      {component: 'component1', lot: 'EDGE-C1', quantity: 1},
      {component: 'component2', lot: 'EDGE-C2', quantity: 1},
    ];
    const valid = {
      producedQuantity: 4,
      scrapQuantity: 0,
      qualityStatus: 'conforming',
      qualityNotes: '',
      qualityChecks: {appearance: 'pass', bonding: 'pass'},
      lots,
    };

    await rejectUnchanged(task.id, {...valid, producedQuantity: -1});
    await rejectUnchanged(task.id, {...valid, producedQuantity: null});
    await rejectUnchanged(task.id, {...valid, producedQuantity: 1_000_000_000, scrapQuantity: 1});
    await rejectUnchanged(task.id, {...valid, scrapQuantity: -1});
    await rejectUnchanged(task.id, {...valid, scrapQuantity: null});
    await rejectUnchanged(task.id, {...valid, lots: lots.map((lot, index) => index ? lot : {...lot, quantity: 0})});
    await rejectUnchanged(task.id, {...valid, lots: lots.map((lot, index) => index ? lot : {...lot, quantity: -1})});
    await rejectUnchanged(task.id, {...valid, lots: lots.map((lot, index) => index ? lot : {...lot, quantity: null})});
    await rejectUnchanged(task.id, {...valid, lots: lots.map((lot, index) => index ? lot : {...lot, quantity: 1_000_000_001})});
    await rejectUnchanged(task.id, {...valid, lots: []});
    await rejectUnchanged(task.id, {...valid, lots: Array.from({length: 51}, (_, index) => ({
      component: index % 2 ? 'component1' : 'component2',
      lot: `LOT-${index}`,
      quantity: 1,
    }))});
    await rejectUnchanged(task.id, {...valid, producedQuantity: 0});

    before = await request('state');
    const rawNonFinite = JSON.stringify({
      revision: before.revision,
      taskId: task.id,
      action: 'finish_run',
      ...valid,
      producedQuantity: '__NONFINITE__',
    }).replace('"__NONFINITE__"', '1e309');
    let rejected = await response('shopfloor/action', {method: 'POST', body: rawNonFinite});
    assert.equal(rejected.status, 400, JSON.stringify(rejected.json));
    assert.deepEqual(persistedExecution(await request('state'), task.id), persistedExecution(before, task.id));

    before = await request('state');
    const rawLotNonFinite = JSON.stringify({
      revision: before.revision,
      taskId: task.id,
      action: 'finish_run',
      ...valid,
      lots: lots.map((lot, index) => index ? lot : {...lot, quantity: '__NONFINITE__'}),
    }).replace('"__NONFINITE__"', '1e309');
    rejected = await response('shopfloor/action', {method: 'POST', body: rawLotNonFinite});
    assert.equal(rejected.status, 400, JSON.stringify(rejected.json));
    assert.deepEqual(persistedExecution(await request('state'), task.id), persistedExecution(before, task.id));

    await action(task.id, 'finish_run', valid);
    state = await request('state');
    execution = state.executions.find(item => item.taskId === task.id);
    assert.equal(execution.phase, 'completed');
    assert.equal(execution.producedQuantity, 4);
    assert.equal(execution.plannedQuantity, 10);
    assert.equal(execution.metrics.totalQuantity, 4);
    assert.equal(state.tasks.find(item => item.id === task.id).status, 'completed');
    assert.equal(execution.events.at(-1).action, 'finish_run');
    assert.equal(execution.lots.length, 2);

    const completed = structuredClone(persistedExecution(state, task.id));
    await action(task.id, 'finish_run', valid, 409, state.revision);
    assert.deepEqual(persistedExecution(await request('state'), task.id), completed);

    cookie = adminCookie;
  } finally {
    await stop();
    rmSync(data, {recursive: true, force: true});
  }
});
