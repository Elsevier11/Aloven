import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleMachine, scheduleTask, validateCalendar } from './scheduler.mjs';

const calendar = {
  weekly: {
    1: [['08:00', '12:00'], ['13:00', '17:00']],
    2: [['08:00', '12:00'], ['13:00', '17:00']],
    3: [['08:00', '12:00'], ['13:00', '17:00']],
    4: [['08:00', '12:00'], ['13:00', '17:00']],
    5: [['08:00', '12:00'], ['13:00', '17:00']],
  },
  exceptions: {
    '2026-10-12': [['10:00', '14:00']],
  },
};

test('divide la lavorazione tra pausa pranzo, weekend ed eccezione', () => {
  const result = scheduleTask(
    { id: 'A', setupMinutes: 60, runMinutes: 600, status: 'planned' },
    '2026-10-09T11:00',
    calendar,
  );
  assert.equal(result.start, '2026-10-09T11:00');
  assert.equal(result.end, '2026-10-13T10:00');
  assert.deepEqual(result.segments, [
    { start: '2026-10-09T11:00', end: '2026-10-09T12:00', kind: 'setup' },
    { start: '2026-10-09T13:00', end: '2026-10-09T17:00', kind: 'run' },
    { start: '2026-10-12T10:00', end: '2026-10-12T14:00', kind: 'run' },
    { start: '2026-10-13T08:00', end: '2026-10-13T10:00', kind: 'run' },
  ]);
});

test('sposta il setup indivisibile al primo turno adatto', () => {
  const result = scheduleTask(
    { id: 'B', setupMinutes: 180, runMinutes: 60, status: 'planned' },
    '2026-10-08T15:00',
    calendar,
  );
  assert.equal(result.start, '2026-10-09T08:00');
  assert.deepEqual(result.segments.slice(0, 2), [
    { start: '2026-10-09T08:00', end: '2026-10-09T11:00', kind: 'setup' },
    { start: '2026-10-09T11:00', end: '2026-10-09T12:00', kind: 'run' },
  ]);
});

test('rifiuta setup impossibili e calendari sovrapposti', () => {
  assert.throws(
    () => scheduleTask({ id: 'C', setupMinutes: 300, runMinutes: 1 }, '2026-10-08T08:00', calendar),
    /Setup.*impossibile/i,
  );
  assert.throws(
    () => validateCalendar({ weekly: { 1: [['08:00', '12:00'], ['11:00', '13:00']] }, exceptions: {} }),
    /sovrappongono/i,
  );
});

test('mantiene immutabile una attività bloccata e rileva sovrapposizioni', () => {
  const locked = {
    id: 'L', status: 'in_progress', setupMinutes: 60, runMinutes: 60,
    start: '2026-10-08T10:00', end: '2026-10-08T12:00',
    segments: [
      { start: '2026-10-08T10:00', end: '2026-10-08T11:00', kind: 'setup' },
      { start: '2026-10-08T11:00', end: '2026-10-08T12:00', kind: 'run' },
    ],
  };
  const result = scheduleMachine([locked, { id: 'N', status: 'planned', setupMinutes: 0, runMinutes: 60 }], '2026-10-08T08:00', calendar);
  assert.strictEqual(result[0], locked);
  assert.equal(result[1].start, '2026-10-08T13:00');

  assert.throws(
    () => scheduleMachine([
      { id: 'P', status: 'planned', setupMinutes: 60, runMinutes: 180 },
      locked,
    ], '2026-10-08T08:00', calendar),
    /Sovrapposizione/i,
  );
});

test('gestisce setup zero e conserva la durata esatta al minuto', () => {
  const task = { id: 'Z', status: 'planned', setupMinutes: 0, runMinutes: 301 };
  const result = scheduleTask(task, '2026-10-08T10:30', calendar);
  assert.equal(result.start, '2026-10-08T10:30');
  assert.equal(result.segments.some(segment => segment.kind === 'setup'), false);
  const total = result.segments.reduce((sum, segment) => {
    const start = Date.parse(`${segment.start}:00Z`);
    const end = Date.parse(`${segment.end}:00Z`);
    return sum + (end - start) / 60000;
  }, 0);
  assert.equal(total, 301);
  assert.deepEqual(task, { id: 'Z', status: 'planned', setupMinutes: 0, runMinutes: 301 });
});

test('rifiuta attività annullate e date ISO non reali', () => {
  assert.throws(
    () => scheduleMachine([{ id: 'X', status: 'cancelled', setupMinutes: 0, runMinutes: 1 }], '2026-10-08T08:00', calendar),
    /annullata/i,
  );
  assert.throws(
    () => scheduleTask({ id: 'X', setupMinutes: 0, runMinutes: 1 }, '2026-02-30T08:00', calendar),
    /non valida/i,
  );
});
