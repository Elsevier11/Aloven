const number = new Intl.NumberFormat('it-IT',{maximumFractionDigits:2});
const percent = new Intl.NumberFormat('it-IT',{style:'percent',maximumFractionDigits:2});
const dateFormat = new Intl.DateTimeFormat('it-IT',{timeZone:'Europe/Rome',dateStyle:'short',timeStyle:'short'});
let filters=null,report=null,loading=false,error='',revision=null,selected='monthly',page=0,request=0;
const metrics=[['count','Attività'],['plannedQuantity','Q.tà prevista'],['goodQuantity','Q.tà buona'],['scrapQuantity','Scarto'],['scrapRate','Scarto %'],['plannedSetupHours','Attr. previsto (h)'],['actualSetupHours','Attr. effettivo (h)'],['plannedRunHours','Lav. prevista (h)'],['actualRunHours','Lav. effettiva (h)'],['nonconformingCount','Non conformi']];
const tables={
 monthly:{label:'Per mese',columns:[['month','Mese'],['unit','Unità'],...metrics]},
 machines:{label:'Per macchina',columns:[['machineName','Macchina'],['unit','Unità'],...metrics]},
 products:{label:'Per prodotto',columns:[['productCode','Codice'],['productDescription','Prodotto'],['unit','Unità'],...metrics]},
 scrapReasons:{label:'Causali scarto',columns:[['reasonCode','Codice'],['label','Causale'],['unit','Unità'],['count','Attività con scarto'],['scrapQuantity','Q.tà scartata']]},
 stopReasons:{label:'Fermi macchina',columns:[['reasonCode','Codice'],['label','Causale'],['stopCount','Fermi'],['closedStopCount','Chiusi'],['openStopCount','Aperti'],['stoppedHours','Durata nel periodo (h)']]},
 details:{label:'Dettaglio attività',columns:[['completedAt','Completata il'],['taskTitle','Attività'],['machineName','Macchina'],['productCode','Prodotto'],['unit','Unità'],...metrics.filter(x=>x[0]!=='count'),['qualityStatus','Qualità'],['scrapReasonLabel','Causale scarto']]},
};
function value(key,x,c) {
 if(x===null||x===undefined) return '—';
 if(key==='scrapRate') return percent.format(x);
 if(key==='unit') return c.unitLabel(x);
 if(key==='completedAt') return dateFormat.format(new Date(x));
 if(key==='qualityStatus') return {conforming:'Conforme',nonconforming:'Non conforme',review:'Da verificare'}[x]||c.esc(x);
 return typeof x==='number'?number.format(x):c.esc(x);
}
export function statisticsView(c) {
 if(!filters) { const dates=c.state.executions.filter(e=>e.phase==='completed'&&e.runEndedAt).map(e=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(e.runEndedAt))).sort(); filters={from:dates[0]||c.localDate(),to:c.localDate(),machineId:''}; }
 const stale=revision!==c.state.revision;
 const ready=report&&!loading&&!stale;
 const totals=ready?report.totals:null;
 const rows=ready?report[selected]||[]:[];
 const pages=Math.max(1,Math.ceil(rows.length/25)); page=Math.min(page,pages-1);
 const columns=tables[selected].columns;
 const visible=rows.slice(page*25,(page+1)*25);
 return `${c.heading('Statistiche','Produzione consuntivata, scarti e fermi macchina.',`<button class="button primary" id="statistics-export" ${ready?'':'disabled'}>↓ Esporta Excel</button>`)}
 <form id="statistics-filters" class="statistics-filters"><label>Dal<input type="date" name="from" required value="${c.esc(filters.from)}"></label><label>Al<input type="date" name="to" required value="${c.esc(filters.to)}"></label><label>Macchina<select name="machineId" aria-label="Macchina"><option value="">Tutte le macchine</option>${c.state.machines.map(m=>`<option value="${c.esc(m.id)}" ${filters.machineId===m.id?'selected':''}>${c.esc(m.name)}</option>`).join('')}</select></label><button class="button secondary" type="submit" ${loading?'disabled':''}>Applica filtri</button></form>
 <p class="statistics-method">Produzione attribuita alla data di completamento (ora italiana). Scarto % = scarto ÷ (quantità buona + scarto). I fermi comprendono solo la durata nel periodo scelto, inclusi quelli aperti. Le ore di lavorazione effettiva escludono le pause.</p>
 ${error?`<div class="statistics-error" role="alert">${c.esc(error)} <button id="statistics-retry" class="button secondary">Riprova</button></div>`:''}
 ${totals?`<div class="metrics statistics-metrics"><div><span>Attività completate</span><strong>${number.format(totals.count)}</strong></div><div><span>Ore lavorate</span><strong>${number.format(totals.actualRunHours)}</strong></div><div><span>Ore di attrezzaggio</span><strong>${number.format(totals.actualSetupHours)}</strong></div><div><span>Ore di fermo</span><strong>${number.format(totals.stoppedHours)}</strong></div></div>
 <div class="statistics-quantities">${totals.quantities.map(q=>`<p><strong>${c.esc(c.unitLabel(q.unit))}</strong> · Buona: <b>${value('goodQuantity',q.goodQuantity,c)}</b> · Scarto: <b>${value('scrapQuantity',q.scrapQuantity,c)}</b> · Incidenza: <b>${value('scrapRate',q.scrapRate,c)}</b></p>`).join('')}</div>`:''}
 <div class="statistics-tabs" aria-label="Raggruppamento statistiche">${Object.entries(tables).map(([key,t])=>`<button class="button ${selected===key?'primary':'secondary'}" data-statistics-tab="${key}" aria-pressed="${selected===key}">${t.label}</button>`).join('')}</div>
 <section class="statistics-results" aria-busy="${!ready&&!error}"><div class="statistics-section-heading"><h2>${tables[selected].label}</h2>${ready?`<span>${number.format(rows.length)} righe · ${c.esc(filters.from)} → ${c.esc(filters.to)}</span>`:''}</div>
 ${!ready?`<p role="status" class="statistics-empty">${error?'I dati non sono disponibili.':'Caricamento statistiche…'}</p>`:`<div class="table-wrap"><table><thead><tr>${columns.map(([,label])=>`<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${visible.map(row=>`<tr>${columns.map(([key])=>`<td class="${typeof row[key]==='number'?'statistics-number':''}">${value(key,row[key],c)}</td>`).join('')}</tr>`).join('')||`<tr><td colspan="${columns.length}" class="statistics-empty">Nessun dato per il periodo e la macchina selezionati.</td></tr>`}</tbody></table></div>${pages>1?`<div class="statistics-pagination"><button class="button secondary" id="statistics-previous" ${page===0?'disabled':''}>← Precedente</button><span>Pagina ${page+1} di ${pages}</span><button class="button secondary" id="statistics-next" ${page===pages-1?'disabled':''}>Successiva →</button></div>`:''}`}
 <p class="statistics-method">L’export comprende tutte le righe filtrate, in fogli distinti. “—” indica un dato non disponibile. Lo storico DEMO-STORICO contiene dati simulati; è incluso nelle statistiche.</p></section>`;
}
async function load(c) {
 if(loading)return;
 const token=++request; loading=true;error=''; c.render();
 try { const result=await c.api(`statistics?${new URLSearchParams(filters)}`); if(token!==request)return; report=result;filters={from:result.filters.from,to:result.filters.to,machineId:result.filters.machineId||''}; revision=c.state.revision; }
 catch(e) { if(token===request)error=e.message; }
 finally { if(token===request){loading=false;if(c.isActive())c.render();} }
}
export function bindStatistics(c) {
 document.querySelector('#statistics-filters').onsubmit=e=>{e.preventDefault();const next=Object.fromEntries(new FormData(e.target));if(next.from>next.to){c.toast('La data finale deve seguire quella iniziale.',true);return;} filters=next; report=null;page=0;load(c);};
 document.querySelectorAll('[data-statistics-tab]').forEach(b=>b.onclick=()=>{selected=b.dataset.statisticsTab;page=0;c.render();});
 document.querySelector('#statistics-previous')?.addEventListener('click',()=>{page--;c.render();});
 document.querySelector('#statistics-next')?.addEventListener('click',()=>{page++;c.render();});
 document.querySelector('#statistics-retry')?.addEventListener('click',()=>load(c));
 document.querySelector('#statistics-export').onclick=async e=>{
  const button=e.currentTarget;button.disabled=true;button.textContent='Esportazione…';
  try { const response=await fetch(`/api/statistics/export?${new URLSearchParams(filters)}`); if(!response.ok){const payload=await response.json();throw new Error(payload.error||'Esportazione non riuscita.');} const url=URL.createObjectURL(await response.blob());const a=document.createElement('a');a.href=url;a.download=`Aloven-statistiche-${filters.from}-${filters.to}.xlsx`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);c.toast('File Excel esportato.'); }
  catch(e){c.toast(e.message,true);}finally{button.disabled=false;button.textContent='↓ Esporta Excel';}
 };
 if(!loading&&!error&&(!report||revision!==c.state.revision))load(c);
}
