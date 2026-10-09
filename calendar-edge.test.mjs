import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { scheduleTask } from './scheduler.mjs';

const everyDay = Object.fromEntries(
  Array.from({ length: 7 }, (_, day) => [day, [['08:00', '12:00']]]),
);

test('salta festivita consecutive senza perdere minuti di lavorazione', () => {
  const calendar = {
    weekly: everyDay,
    exceptions: {
      '2026-07-14': [],
      '2026-07-15': [],
    },
  };

  const result = scheduleTask(
    { id: 'HOLIDAYS', setupMinutes: 0, runMinutes: 180, status: 'planned' },
    '2026-07-13T11:00',
    calendar,
  );

  assert.equal(result.end, '2026-07-16T10:00');
  assert.deepEqual(result.segments, [
    { start: '2026-07-13T11:00', end: '2026-07-13T12:00', kind: 'run' },
    { start: '2026-07-16T08:00', end: '2026-07-16T10:00', kind: 'run' },
  ]);
});

test('attraversa correttamente fine mese e fine anno', () => {
  const calendar = {
    weekly: everyDay,
    exceptions: {
      '2026-12-31': [],
      '2027-01-01': [],
    },
  };

  const result = scheduleTask(
    { id: 'NEW-YEAR', setupMinutes: 0, runMinutes: 180, status: 'planned' },
    '2026-12-30T11:00',
    calendar,
  );

  assert.equal(result.start, '2026-12-30T11:00');
  assert.equal(result.end, '2027-01-02T10:00');
  assert.deepEqual(result.segments, [
    { start: '2026-12-30T11:00', end: '2026-12-30T12:00', kind: 'run' },
    { start: '2027-01-02T08:00', end: '2027-01-02T10:00', kind: 'run' },
  ]);
});

test('mantiene gli orari Europe/Rome ai cambi ora indipendentemente dal fuso host', () => {
  const program = `
    import { scheduleTask } from './scheduler.mjs';
    const calendar = {
      weekly: { 1: [['08:00', '12:00']], 5: [['08:00', '12:00']] },
      exceptions: {},
    };
    const task = { setupMinutes: 0, runMinutes: 120, status: 'planned' };
    const spring = scheduleTask(task, '2026-03-27T12:00', calendar);
    const autumn = scheduleTask(task, '2026-10-23T12:00', calendar);
    process.stdout.write(JSON.stringify({ spring, autumn }));
  `;
  const results = ['UTC', 'America/Los_Angeles', 'Asia/Tokyo'].map(TZ => JSON.parse(
    execFileSync(process.execPath, ['--input-type=module', '--eval', program], {
      cwd: process.cwd(),
      env: { ...process.env, TZ },
      encoding: 'utf8',
    }),
  ));

  assert.deepEqual(results[1], results[0]);
  assert.deepEqual(results[2], results[0]);
  assert.equal(results[0].spring.start, '2026-03-30T08:00');
  assert.equal(results[0].spring.end, '2026-03-30T10:00');
  assert.equal(results[0].autumn.start, '2026-10-26T08:00');
  assert.equal(results[0].autumn.end, '2026-10-26T10:00');
});

test('segnala esplicitamente un calendario senza disponibilita', () => {
  assert.throws(
    () => scheduleTask(
      { id: 'NO-SLOTS', setupMinutes: 0, runMinutes: 1, status: 'planned' },
      '2026-01-01T08:00',
      { weekly: {}, exceptions: {} },
    ),
    /Nessuna disponibilita|Nessuna disponibilità/,
  );
});

test('applica eccezioni diverse a macchine con lo stesso calendario generale', () => {
  const weekly = { 1: [['08:00', '12:00']], 2: [['08:00', '12:00']] };
  const generalExceptions = { '2026-08-17': [] };
  const calendars = {
    machineA: {
      weekly,
      exceptions: { ...generalExceptions, '2026-08-17': [['10:00', '12:00']] },
    },
    machineB: {
      weekly,
      exceptions: { ...generalExceptions },
    },
  };
  const task = { setupMinutes: 0, runMinutes: 60, status: 'planned' };

  const machineA = scheduleTask(task, '2026-08-17T08:00', calendars.machineA);
  const machineB = scheduleTask(task, '2026-08-17T08:00', calendars.machineB);

  assert.equal(machineA.start, '2026-08-17T10:00');
  assert.equal(machineA.end, '2026-08-17T11:00');
  assert.equal(machineB.start, '2026-08-18T08:00');
  assert.equal(machineB.end, '2026-08-18T09:00');
});
