import {liveCellModel, liveTitle, endLabel, serverClock} from './planning-live.js';
import {dispatchLabel, dispatchTone} from './planning-presentation.js';

export const NEXT_LIMIT = 4;

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

/** Dettagli della macchina in corso su due o tre righe: chi e da quando, tempo su previsto, fine e ritardo. */
export function detailLines(m, c) {
  const lines = [...m.lines], out = [];
  const since = lines[0]?.startsWith('da ') ? lines.shift() : '';
  const who = [m.operator && `Operatore ${m.operator}`, since].filter(Boolean).join(' · ');
  if (who) out.push({text: who});
  const end = lines.findIndex(l => l.startsWith('fine '));
  const endLine = end >= 0 ? lines.splice(end, 1)[0] : '';
  for (const line of lines) out.push({text: line});
  const finish = [endLine, m.delay > 0 ? `in ritardo di ${c.mins(m.delay)}` : ''].filter(Boolean).join(' · ');
  if (finish) out.push({text: finish.charAt(0).toUpperCase() + finish.slice(1), alert: m.delay > 0});
  if (m.stop) out.push({text: m.stop, alert: true});
  return out;
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
    const machine = c.machine(m.machineId);
    const name = machine?.name || m.machineId;
    const tip = [m.title, ...m.lines, m.stop, m.delay > 0 ? `In ritardo di ${c.mins(m.delay)}` : ''].filter(Boolean).join(' · ');
    const current = m.taskId
      ? `<button type="button" class="reparto-current" data-reparto-task="${c.esc(m.taskId)}" title="${c.esc(tip)}"><span class="reparto-task">${c.esc(m.title)}</span></button>`
        + (m.progress == null ? '' : `<div class="reparto-progress" role="progressbar" aria-label="Avanzamento sul tempo previsto" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100, m.progress)}" data-over="${m.progress > 100}"><span style="width:${Math.min(100, m.progress)}%"></span><b>${m.progress > 200 ? 'Oltre il previsto' : `${m.progress} %`}</b></div>`)
        + `<ul class="reparto-lines">${detailLines(m, c).map(l => `<li${l.alert ? ' class="reparto-alert"' : ''}>${c.esc(l.text)}</li>`).join('')}</ul>`
      : `<p class="reparto-none">Nessuna attività in corso</p>${m.stop ? `<p class="reparto-alert">${c.esc(m.stop)}</p>` : ''}`;
    const upcoming = next.length
      ? `<ol class="reparto-next">${next.map(n => `<li><button type="button" data-reparto-task="${c.esc(n.id)}" title="${c.esc(n.title)}"><span class="reparto-when">${c.esc(n.start || '—')}</span><span class="reparto-name">${c.esc(n.title)}</span>${n.badge ? `<span class="reparto-badge" data-tone="${n.tone}">${c.esc(n.badge)}</span>` : ''}</button></li>`).join('')}</ol>${more ? `<p class="reparto-more">e altre ${more} in sequenza</p>` : ''}`
      : '<p class="reparto-none">Nessuna attività in programma</p>';
    return `<article class="reparto-card" data-machine="${c.esc(m.machineId)}" data-tone="${m.tone}" data-alert="${m.alert}" aria-label="${c.esc(`${name}: ${m.label}`)}">`
      + `<header><h3>${c.esc(name.split(' · ')[0])}</h3><span class="live-state">${c.esc(m.label)}${m.since ? ` <small>da ${c.esc(m.since)}</small>` : ''}</span></header>`
      + `<section aria-label="In corso"><h4>In corso</h4>${current}</section>`
      + `<section aria-label="Prossime attività"><h4>Prossime</h4>${upcoming}</section></article>`;
  }).join('');
  return `<section class="reparto-view" id="reparto-view" aria-label="Stato del reparto"><p class="reparto-summary" role="status">${c.esc(summary)} <a class="reparto-tv-link" href="/reparto-tv" target="_blank" rel="noopener">Apri il monitor a schermo intero</a></p><div class="reparto-grid">${cards}</div></section>`;
}
