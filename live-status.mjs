import { executionMetrics } from './quality.mjs';

/**
 * Read-only picture of what is running on each machine right now.
 * One entry per machine; `state` is one of idle, setup, setup_paused, setup_done, run, paused, in_progress, stopped.
 * A machine with an open stop is "stopped" whatever its execution phase says; the phase is still reported.
 */
export function machineLiveStatus(db, {machines, tasks, now = new Date().toISOString()}) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('Database SQLite non valido.');
  const executions = new Map(db.prepare("SELECT * FROM execution WHERE phase<>'completed' AND interruptedAt IS NULL").all().map(row => [row.taskId, row]));
  const stops = new Map(db.prepare('SELECT machineId,startedAt,reason FROM machineStops WHERE endedAt IS NULL ORDER BY startedAt,rowid').all().map(row => [row.machineId, {reason: row.reason, startedAt: row.startedAt}]));
  return machines.map(machine => {
    const task = tasks.find(item => item.machineId === machine.id && item.status === 'in_progress') || null;
    const execution = task ? executions.get(task.id) || null : null;
    const stop = stops.get(machine.id) || null;
    let state = 'idle', phaseSince = null;
    if (task) {
      state = 'in_progress';
      if (execution?.phase === 'setup_running') { state = execution.setupPausedAt ? 'setup_paused' : 'setup'; phaseSince = execution.setupStartedAt; }
      else if (execution?.phase === 'setup_done') { state = 'setup_done'; phaseSince = execution.setupEndedAt; }
      else if (execution?.phase === 'run_running') { state = 'run'; phaseSince = execution.lastRunStartedAt; }
      else if (execution?.phase === 'run_paused') state = 'paused';
    }
    if (stop) state = 'stopped';
    const metrics = execution ? executionMetrics(execution, now) : null;
    return {
      machineId: machine.id,
      state,
      taskId: task?.id ?? null,
      phase: execution?.phase ?? null,
      phaseSince,
      setupActualSeconds: metrics?.actualSetupSeconds ?? null,
      runActualSeconds: metrics?.actualRunSeconds ?? null,
      plannedSetupMinutes: task ? (execution?.plannedSetupMinutes ?? task.effectiveSetupMinutes ?? task.setupMinutes) : null,
      plannedRunMinutes: task ? (execution?.plannedRunMinutes ?? task.runMinutes) : null,
      plannedEnd: task?.end ?? null,
      stop,
    };
  });
}
