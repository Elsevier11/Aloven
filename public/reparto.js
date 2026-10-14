import {liveCellModel, liveTitle, endLabel, serverClock} from './planning-live.js';
import {dispatchLabel, dispatchTone} from './planning-presentation.js';

export const NEXT_LIMIT = 5;

/** Not-yet-started activities of one machine, in sequence order (the draft plan the planner sees). */
export function nextTasks(tasks = [], machineId) {
  return tasks
    .filter(t => t.machineId === machineId && t.position != null && t.status === 'planned')
    .sort((a, b) => a.position - b.position);
}

/** Everything the Reparto view shows, as plain data (no HTML), so it can be tested without a DOM. */
export function repartoModel(c, nowMs = serverClock(c.state.serverNow, c.receivedAt)) {
  const tasks = c.state.tasks || [];
  return (c.state.liveMachines || []).map(item => {
    const cell = liveCellModel({...item, serverAt: c.state.serverNow}, tasks.find(t => t.id === item.taskId), nowMs, c.mins);
    const queue = nextTasks(tasks, item.machineId);
    return {
      cell,
      next: queue.slice(0, NEXT_LIMIT).map(t => ({
        id: t.id,
        title: liveTitle(t),
        start: t.start ? endLabel(t.start, nowMs) : '',
        tone: dispatchTone(t),
        badge: dispatchTone(t) === 'released' ? '' : dispatchLabel(t),
      })),
      more: Math.max(0, queue.length - NEXT_LIMIT),
    };
  });
}

/** Dedicated view: for every machine what is running now and what comes next. */
export function repartoView(c) {
  const models = repartoModel(c);
  if (!models.length) return '<section class="reparto-view"><p class="empty-state">Nessuna macchina configurata.</p></section>';
  const running = models.filter(m => m.cell.taskId).length;
  const stopped = models.filter(m => m.cell.state === 'stopped').length;
  const late = models.filter(m => m.cell.delay > 0).length;
  const summary = `${running} in corso${stopped ? ` · ${stopped} ${stopped === 1 ? 'ferma' : 'ferme'}` : ''}${late ? ` · ${late} in ritardo` : ''}`;
  const cards = models.map(({cell: m, next, more}) => {
    const machine = c.machine(m.machineId), color = c.machineColor(c.state, m.machineId);
    const name = machine?.name || m.machineId;
    const tip = [m.title, ...m.lines, m.stop, m.delay > 0 ? `In ritardo di ${c.mins(m.delay)}` : ''].filter(Boolean).join(' · ');
    const current = m.taskId
      ? `<button type="button" class="reparto-current" data-reparto-task="${c.esc(m.taskId)}" title="${c.esc(tip)}"><span class="reparto-task">${c.esc(m.title)}</span></button>`
        + `<ul class="reparto-lines">${m.lines.map(l => `<li>${c.esc(l)}</li>`).join('')}${m.stop ? `<li class="reparto-alert">${c.esc(m.stop)}</li>` : ''}${m.delay > 0 ? `<li class="reparto-alert">In ritardo di ${c.esc(c.mins(m.delay))}</li>` : ''}</ul>`
      : `<p class="reparto-none">Nessuna attività in corso</p>${m.stop ? `<p class="reparto-alert">${c.esc(m.stop)}</p>` : ''}`;
    const upcoming = next.length
      ? `<ol class="reparto-next">${next.map(n => `<li><button type="button" data-reparto-task="${c.esc(n.id)}"><span class="reparto-when">${c.esc(n.start || '—')}</span><span class="reparto-name">${c.esc(n.title)}</span>${n.badge ? `<span class="reparto-badge" data-tone="${n.tone}">${c.esc(n.badge)}</span>` : ''}</button></li>`).join('')}</ol>${more ? `<p class="reparto-more">e altre ${more} in sequenza</p>` : ''}`
      : '<p class="reparto-none">Nessuna attività in programma</p>';
    return `<article class="reparto-card" data-machine="${c.esc(m.machineId)}" data-tone="${m.tone}" data-alert="${m.alert}" aria-label="${c.esc(`${name}: ${m.label}`)}">`
      + `<header><i class="live-dot" style="background:${c.esc(color)}"></i><h3>${c.esc(name.split(' · ')[0])}</h3><span class="live-state">${c.esc(m.label)}${m.since ? ` <small>da ${c.esc(m.since)}</small>` : ''}</span></header>`
      + `<section aria-label="In corso"><h4>In corso</h4>${current}</section>`
      + `<section aria-label="Prossime attività"><h4>Prossime</h4>${upcoming}</section></article>`;
  }).join('');
  return `<section class="reparto-view" id="reparto-view" aria-label="Stato del reparto"><p class="reparto-summary" role="status">${c.esc(summary)}</p><div class="reparto-grid">${cards}</div></section>`;
}
