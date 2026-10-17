import {repartoModel} from './reparto.js';

// Vista a schermo intero per il monitor di reparto: sola lettura, si aggiorna da sola.
// Serve un account che pianifica (la stessa lettura della vista «In reparto»); la sessione dura 12 ore.
const REFRESH_MS = 15000;
const app = document.getElementById('tv-app');
let state = null, receivedAt = 0, failed = 0;

const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch]));
const mins = value => {
  const total = Math.max(0, Math.round(Number(value) || 0)), h = Math.floor(total / 60), m = total % 60;
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
};

export function tvCards(models) {
  return models.map(({cell: m, next, more}) => {
    const name = esc(m.machineName || m.machineId);
    const progress = m.progress == null ? '' : `<div class="tv-progress" data-over="${m.progress > 100}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100, m.progress)}"><span style="width:${Math.min(100, m.progress)}%"></span><b>${m.progress > 200 ? 'Oltre il previsto' : `${m.progress} %`}</b></div>`;
    const facts = [m.operator && `Operatore ${esc(m.operator)}`, ...m.lines.map(esc), m.delay > 0 ? `In ritardo di ${esc(mins(m.delay))}` : ''].filter(Boolean);
    const current = m.taskId
      ? `<p class="tv-task">${esc(m.title)}</p>${progress}<ul class="tv-facts">${facts.map(f => `<li>${f}</li>`).join('')}</ul>`
      : '<p class="tv-task tv-idle">Nessuna attività in corso</p>';
    const upcoming = next.slice(0, 3).map(n => `<li><span>${esc(n.start || '—')}</span>${esc(n.title)}</li>`).join('');
    return `<article class="tv-card" data-tone="${esc(m.tone)}" data-alert="${m.alert}">`
      + `<header><h2>${name}</h2><span class="tv-state">${esc(m.label)}</span></header>`
      + (m.stop ? `<p class="tv-stop">${esc(m.stop)}</p>` : '')
      + current
      + (upcoming ? `<h3>Prossime${more ? ` · e altre ${more}` : ''}</h3><ol class="tv-next">${upcoming}</ol>` : '<h3>Nessuna attività in programma</h3>')
      + '</article>';
  }).join('');
}

function render() {
  if (!state) return;
  const models = repartoModel({state, receivedAt, mins, machine: id => state.machines?.find(x => x.id === id)}).map(model => {
    const machine = state.machines?.find(x => x.id === model.cell.machineId);
    model.cell.machineName = (machine?.name || model.cell.machineId).split(' · ')[0];
    return model;
  });
  const running = models.filter(m => m.cell.taskId).length, stopped = models.filter(m => m.cell.state === 'stopped').length, late = models.filter(m => m.cell.delay > 0).length;
  const summary = `${running} in corso${stopped ? ` · ${stopped} ${stopped === 1 ? 'ferma' : 'ferme'}` : ''}${late ? ` · ${late} in ritardo` : ''}`;
  const clock = new Intl.DateTimeFormat('it-IT', {hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome'}).format(new Date());
  const stale = failed > 0 ? '<span class="tv-stale" role="alert">Dati non aggiornati: connessione assente</span>' : '';
  app.innerHTML = `<header class="tv-top"><img src="/aloven-logo.png" alt="Aloven"><strong>${esc(summary)}</strong>${stale}<time>${clock}</time></header>`
    + `<main class="tv-grid" data-count="${models.length}">${tvCards(models)}</main>`;
}

async function load() {
  try {
    const response = await fetch('/api/state?view=planning', {credentials: 'same-origin', headers: {'X-Aloven-Request': '1'}});
    if (response.status === 401 || response.status === 403) {
      state = null;
      app.innerHTML = '<div class="tv-message" role="alert">Sessione scaduta o permessi insufficienti. <a href="/">Accedi con un account che pianifica</a> e riapri questa pagina.</div>';
      return;
    }
    if (!response.ok) throw new Error(String(response.status));
    state = await response.json();
    receivedAt = Date.now();
    failed = 0;
  } catch {
    failed += 1;
    if (!state) app.innerHTML = '<div class="tv-message" role="alert">Impossibile leggere i dati del reparto. Riprovo…</div>';
  }
  render();
}

load();
setInterval(load, REFRESH_MS);
setInterval(render, 30000);
