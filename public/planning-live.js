import {taskReference} from './planning-presentation.js';

export const LIVE_STATES = {
  idle: {label: 'Libera', tone: 'idle'},
  setup: {label: 'Attrezzaggio', tone: 'setup'},
  setup_paused: {label: 'Attrezzaggio in pausa', tone: 'paused'},
  setup_done: {label: 'Attrezzaggio concluso', tone: 'ready'},
  run: {label: 'Produzione', tone: 'run'},
  paused: {label: 'In pausa', tone: 'paused'},
  in_progress: {label: 'In corso', tone: 'run'},
  stopped: {label: 'Fermo', tone: 'stopped'},
};

const pad = n => String(n).padStart(2, '0');
/** Europe/Rome wall-clock minute ("YYYY-MM-DDTHH:mm") of an instant given in milliseconds. */
export function romeMinuteOf(ms) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).formatToParts(new Date(ms)).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
const localMs = value => Date.parse(`${String(value).slice(0, 16)}:00Z`);
const hhmm = iso => iso ? new Intl.DateTimeFormat('it-IT', {timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(new Date(iso)) : '';

/** Planned end as "HH:mm" today, "DD/MM HH:mm" on another day (planned dates are Rome wall-clock strings). */
export function endLabel(plannedEnd, nowMs) {
  const end = String(plannedEnd).slice(0, 16), time = end.slice(11, 16);
  return end.slice(0, 10) === romeMinuteOf(nowMs).slice(0, 10) ? time : `${end.slice(8, 10)}/${end.slice(5, 7)} ${time}`;
}
/** Minutes the activity has run past its planned end; 0 when on time or without a planned end. */
export function delayMinutes(plannedEnd, nowMs) {
  if (!plannedEnd || !Number.isFinite(nowMs)) return 0;
  return Math.max(0, Math.round((localMs(romeMinuteOf(nowMs)) - localMs(plannedEnd)) / 60000));
}
/** Elapsed whole minutes between an ISO instant and now. */
export function elapsedMinutes(since, nowMs) {
  const start = Date.parse(since);
  return Number.isFinite(start) && Number.isFinite(nowMs) ? Math.max(0, Math.floor((nowMs - start) / 60000)) : null;
}
/** Server clock as seen now: server time at receipt plus what elapsed locally since. */
export function serverClock(serverNow, receivedAt, clientNow = Date.now()) {
  const server = Date.parse(serverNow);
  return Number.isFinite(server) ? server + (clientNow - receivedAt) : clientNow;
}

/** Reference and title, without repeating the reference when the title already carries it. */
export function liveTitle(task) {
  const title = task.title.toLowerCase();
  const parts = taskReference(task).split(' · ').filter(part => part && !title.includes(part.toLowerCase().replace(/^(ord\.|lotto)\s+/, '')));
  return parts.length ? `${parts.join(' · ')} · ${task.title}` : task.title;
}

/** Everything one cell shows, as plain data (no HTML), so it can be tested without a DOM. */
export function liveCellModel(item, task, nowMs, mins) {
  const meta = LIVE_STATES[item.state] || LIVE_STATES.idle;
  const running = ['setup', 'run'].includes(item.state);
  const lines = [];
  const delay = item.taskId ? delayMinutes(item.plannedEnd, nowMs) : 0;
  if (item.taskId) {
    if (item.phaseSince && ['setup', 'setup_done', 'run'].includes(item.state)) lines.push(`da ${hhmm(item.phaseSince)}`);
    if (item.state === 'setup' || item.state === 'setup_paused' || (item.state === 'stopped' && item.phase === 'setup_running')) {
      const done = Math.floor((item.setupActualSeconds || 0) / 60), serverMs = Date.parse(item.serverAt || ''), live = item.state === 'setup' && Number.isFinite(serverMs) ? Math.max(0, Math.floor((nowMs - serverMs) / 60000)) : 0;
      lines.push(`attrezzaggio ${mins(done + live)} su ${mins(item.plannedSetupMinutes ?? 0)}`);
    } else if (['run', 'paused', 'stopped', 'in_progress'].includes(item.state) && item.runActualSeconds != null) {
      const done = Math.floor(item.runActualSeconds / 60), serverMs = Date.parse(item.serverAt || ''), live = item.state === 'run' && Number.isFinite(serverMs) ? Math.max(0, Math.floor((nowMs - serverMs) / 60000)) : 0;
      lines.push(`lavorazione ${mins(done + live)} su ${mins(item.plannedRunMinutes ?? 0)}`);
    }
    if (item.plannedEnd) lines.push(`fine ${endLabel(item.plannedEnd, nowMs)}`);
  }
  const stop = item.stop ? `Fermo dalle ${hhmm(item.stop.startedAt)} · ${item.stop.reason}` : '';
  return {
    machineId: item.machineId, taskId: item.taskId, state: item.state, label: meta.label, tone: meta.tone, running,
    title: task ? liveTitle(task) : '', lines, stop,
    delay, alert: item.state === 'stopped' || delay > 0,
    since: item.taskId && item.phaseSince && ['setup', 'setup_done', 'run'].includes(item.state) ? hhmm(item.phaseSince) : '',
    meta: item.stop ? `fermo dalle ${hhmm(item.stop.startedAt)}` : delay > 0 ? `+${mins(delay)}` : item.taskId && item.plannedEnd ? `fine ${endLabel(item.plannedEnd, nowMs)}` : '',
  };
}

/** Compact strip with one cell per visible machine. */
export function liveStrip(c) {
  const items = (c.state.liveMachines || []).filter(item => !c.machineFilter || item.machineId === c.machineFilter);
  if (!items.length && !(c.state.liveMachines || []).length) return '';
  const nowMs = serverClock(c.state.serverNow, c.receivedAt);
  const models = items.map(item => liveCellModel({...item, serverAt: c.state.serverNow}, c.state.tasks.find(t => t.id === item.taskId), nowMs, c.mins));
  const running = models.filter(m => m.taskId).length, stopped = models.filter(m => m.state === 'stopped').length, late = models.filter(m => m.delay > 0).length;
  const summary = `${running} in corso${stopped ? ` · ${stopped} ${stopped === 1 ? 'ferma' : 'ferme'}` : ''}${late ? ` · ${late} in ritardo` : ''}`;
  const cells = models.map(m => {
    const machine = c.machine(m.machineId), color = c.machineColor(c.state, m.machineId);
    const body = `<span class="live-head"><i class="live-dot" style="background:${c.esc(color)}"></i><b>${c.esc((machine?.name || m.machineId).split(' · ')[0])}</b><span class="live-state">${c.esc(m.label)}${m.since ? ` <small>da ${c.esc(m.since)}</small>` : ''}</span></span>`
      + `<span class="live-line"><span class="live-task${m.title ? '' : ' live-empty'}">${c.esc(m.title || 'Nessuna attività in corso')}</span>${m.meta ? `<span class="live-meta${m.alert ? ' live-alert' : ''}">${c.esc(m.meta)}</span>` : ''}</span>`;
    const tip = [m.title, ...m.lines, m.stop, m.delay > 0 ? `In ritardo di ${c.mins(m.delay)}` : ''].filter(Boolean).join(' · ');
    const label = `${machine?.name || m.machineId}: ${m.label}${m.title ? `, ${tip}` : ''}`;
    return m.taskId
      ? `<button type="button" class="live-cell" data-tone="${m.tone}" data-alert="${m.alert}" data-live-task="${c.esc(m.taskId)}" title="${c.esc(tip)}" aria-label="${c.esc(label)}">${body}</button>`
      : `<div class="live-cell" data-tone="${m.tone}" data-alert="${m.alert}" role="group" aria-label="${c.esc(label)}">${body}</div>`;
  }).join('');
  return `<section class="live-strip" id="live-strip" aria-label="Adesso in reparto" data-collapsed="${c.collapsed}"><header><h2>Adesso in reparto</h2><span class="live-summary" role="status" title="${c.esc(summary)}">${c.esc(summary)}</span><button type="button" class="link-button" id="live-toggle" aria-expanded="${!c.collapsed}" aria-controls="live-cells">${c.collapsed ? 'Mostra' : 'Nascondi'}</button></header><div class="live-cells" id="live-cells" ${c.collapsed ? 'hidden' : ''}>${cells}</div></section>`;
}
