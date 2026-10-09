const number = new Intl.NumberFormat('it-IT',{maximumFractionDigits:2});
const percent = new Intl.NumberFormat('it-IT',{style:'percent',maximumFractionDigits:2});
const dateFormat = new Intl.DateTimeFormat('it-IT',{timeZone:'Europe/Rome',dateStyle:'short',timeStyle:'short'});
let filters=null,report=null,loading=false,error='',revision=null,selected='monthly',page=0,request=0,tablesOpen=false,chartAbort=null;
const chartUnits={monthly:null,scrapReasons:null};
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

function unitsFor(rows) {
 return [...new Set(rows.map(row=>row.unit).filter(unit=>unit!==null&&unit!==undefined))].sort((a,b)=>String(a).localeCompare(String(b),'it'));
}
function unitPicker(kind,rows,c,label) {
 const units=unitsFor(rows);
 if(!units.length)return '';
 if(!units.includes(chartUnits[kind]))chartUnits[kind]=units[0];
 if(units.length===1)return `<p class="statistics-chart-unit">Unità: <strong>${c.esc(c.unitLabel(units[0]))}</strong></p>`;
 return `<div class="statistics-unit-picker" role="group" aria-label="${c.esc(label)}">${units.map(unit=>`<button type="button" data-chart-unit="${kind}" data-unit="${c.esc(unit)}" aria-pressed="${chartUnits[kind]===unit}">${c.esc(c.unitLabel(unit))}</button>`).join('')}</div>`;
}
function sumNullable(rows,key) {
 const values=rows.map(row=>row[key]);
 return values.some(item=>item===null||item===undefined)?null:values.reduce((sum,item)=>sum+Number(item),0);
}
function machinesForChart(rows) {
 const groups=new Map();
 for(const row of rows) {
  if(!groups.has(row.machineId))groups.set(row.machineId,{machineId:row.machineId,machineName:row.machineName,rows:[]});
  groups.get(row.machineId).rows.push(row);
 }
 return [...groups.values()].map(group=>({machineId:group.machineId,machineName:group.machineName,plannedRunHours:sumNullable(group.rows,'plannedRunHours'),actualRunHours:sumNullable(group.rows,'actualRunHours')})).sort((a,b)=>a.machineName.localeCompare(b.machineName,'it'));
}
function barMark({label,series,amount,maximum,suffix='',tone='actual'},c) {
 const missing=amount===null||amount===undefined;
 const safeAmount=missing?'—':number.format(amount);
 const ratio=missing||maximum<=0?0:Math.max(0,Math.min(100,Number(amount)/maximum*100));
 const spoken=missing?'dato non disponibile':`${safeAmount}${suffix}`;
 return `<div class="statistics-bar-mark ${missing?'is-missing':Number(amount)===0?'is-zero':''}" tabindex="0" role="img" aria-label="${c.esc(`${label}, ${series}: ${spoken}`)}"><span class="statistics-series">${c.esc(series)}</span><span class="statistics-bar-track" aria-hidden="true"><i class="statistics-bar-fill ${tone}" style="--bar-size:${ratio.toFixed(3)}%"></i></span><strong>${c.esc(safeAmount)}${missing?'':c.esc(suffix)}</strong><span class="statistics-chart-tooltip" role="tooltip">${c.esc(label)} · ${c.esc(series)}: ${c.esc(spoken)}</span></div>`;
}
function groupedBarChart(rows,{labelOf,series,empty},c) {
 if(!rows.length)return `<p class="statistics-chart-empty">${c.esc(empty)}</p>`;
 const maximum=Math.max(0,...rows.flatMap(row=>series.map(item=>Number(row[item.key])||0)));
 return `<div class="statistics-bar-chart">${rows.map(row=>{const label=labelOf(row);return `<div class="statistics-bar-group"><h3>${c.esc(label)}</h3>${series.map(item=>barMark({label,series:item.label,amount:row[item.key],maximum,suffix:item.suffix||'',tone:item.tone},c)).join('')}</div>`;}).join('')}</div>`;
}
function chartPanel({id,title,description,legend='',controls='',body},c) {
 return `<section id="${id}" class="statistics-chart-card" aria-labelledby="${id}-title"><div class="statistics-chart-heading"><div><h2 id="${id}-title">${c.esc(title)}</h2><p>${c.esc(description)}</p></div>${controls}</div>${legend}${body}</section>`;
}
function charts(c) {
 const monthlyRows=report.monthly||[],monthlyControls=unitPicker('monthly',monthlyRows,c,'Unità del grafico produzione mensile');
 const monthly=monthlyRows.filter(row=>row.unit===chartUnits.monthly),machineRows=machinesForChart(report.machines||[]);
 const scrapRows=report.scrapReasons||[],scrapControls=unitPicker('scrapReasons',scrapRows,c,'Unità del grafico causali scarto');
 const scrap=scrapRows.filter(row=>row.unit===chartUnits.scrapReasons),stops=report.stopReasons||[];
 const legend=items=>`<div class="statistics-chart-legend" aria-label="Legenda">${items.map(item=>`<span><i class="${item.tone}" aria-hidden="true"></i>${c.esc(item.label)}</span>`).join('')}</div>`;
 return `<div class="statistics-chart-grid" aria-label="Grafici statistici">
 ${chartPanel({id:'monthly-production',title:'Produzione mensile',description:'Quantità buona e scartata, senza sommare unità diverse.',controls:monthlyControls,legend:legend([{tone:'good',label:'Quantità buona'},{tone:'scrap',label:'Scarto'}]),body:groupedBarChart(monthly,{labelOf:row=>row.month,series:[{key:'goodQuantity',label:'Buona',tone:'good'},{key:'scrapQuantity',label:'Scarto',tone:'scrap'}],empty:'Nessuna produzione nel periodo selezionato.'},c)},c)}
 ${chartPanel({id:'machine-hours',title:'Ore di produzione per macchina',description:'Confronto tra lavorazione pianificata ed effettiva.',legend:legend([{tone:'planned',label:'Pianificate'},{tone:'actual',label:'Effettive'}]),body:groupedBarChart(machineRows,{labelOf:row=>row.machineName,series:[{key:'plannedRunHours',label:'Pianificate',tone:'planned',suffix:' h'},{key:'actualRunHours',label:'Effettive',tone:'actual',suffix:' h'}],empty:'Nessuna ora di produzione nel periodo selezionato.'},c)},c)}
 ${chartPanel({id:'scrap-causes',title:'Scarti per causale',description:'Quantità scartata attribuita alla causale registrata.',controls:scrapControls,legend:legend([{tone:'scrap',label:'Quantità scartata'}]),body:groupedBarChart(scrap,{labelOf:row=>row.label,series:[{key:'scrapQuantity',label:'Scarto',tone:'scrap'}],empty:'Nessuno scarto nel periodo selezionato.'},c)},c)}
 ${chartPanel({id:'downtime-causes',title:'Fermi per causale',description:'Ore di fermo sovrapposte al periodo selezionato.',legend:legend([{tone:'downtime',label:'Ore di fermo'}]),body:groupedBarChart(stops,{labelOf:row=>row.label,series:[{key:'stoppedHours',label:'Fermo',tone:'downtime',suffix:' h'}],empty:'Nessun fermo nel periodo selezionato.'},c)},c)}
 </div>`;
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
 <details class="statistics-help"><summary>Come leggere i dati</summary><p class="statistics-method">Produzione attribuita alla data di completamento (ora italiana). Scarto % = scarto ÷ (quantità buona + scarto). I fermi comprendono solo la durata nel periodo scelto, inclusi quelli aperti. Le ore di lavorazione effettiva escludono le pause.</p></details>
 ${error?`<div class="statistics-error" role="alert">${c.esc(error)} <button id="statistics-retry" class="button secondary">Riprova</button></div>`:''}
 ${totals?`<section aria-label="Riepilogo del periodo"><div class="metrics statistics-metrics"><div><span>Attività completate</span><strong>${number.format(totals.count)}</strong></div><div><span>Ore lavorate</span><strong>${value('actualRunHours',totals.actualRunHours,c)}</strong></div><div><span>Ore di attrezzaggio</span><strong>${value('actualSetupHours',totals.actualSetupHours,c)}</strong></div><div><span>Ore di fermo</span><strong>${value('stoppedHours',totals.stoppedHours,c)}</strong></div></div><div class="statistics-quantities">${totals.quantities.map(q=>`<article><strong>${c.esc(c.unitLabel(q.unit))}</strong><span>Buona <b>${value('goodQuantity',q.goodQuantity,c)}</b></span><span>Scarto <b>${value('scrapQuantity',q.scrapQuantity,c)}</b></span><span>Incidenza <b>${value('scrapRate',q.scrapRate,c)}</b></span></article>`).join('')}</div></section>${charts(c)}`:`<section class="statistics-chart-loading" aria-busy="${!error}"><p role="status" class="statistics-empty">${error?'I dati non sono disponibili.':'Caricamento statistiche…'}</p></section>`}
 <details id="statisticsTableDetails" class="statistics-table-details" ${tablesOpen?'open':''}><summary id="statisticsTablesToggle">${tablesOpen?'Nascondi tabelle':'Mostra tabelle'}<span>Dettaglio tabellare · 6 viste</span></summary><div class="statistics-table-content">
 <div class="statistics-tabs" aria-label="Raggruppamento statistiche">${Object.entries(tables).map(([key,t])=>`<button class="button ${selected===key?'primary':'secondary'}" data-statistics-tab="${key}" aria-pressed="${selected===key}">${t.label}</button>`).join('')}</div>
 <section class="statistics-results" aria-busy="${!ready&&!error}"><div class="statistics-section-heading"><h2>${tables[selected].label}</h2>${ready?`<span>${number.format(rows.length)} righe · ${c.esc(filters.from)} → ${c.esc(filters.to)}</span>`:''}</div>
 ${!ready?`<p role="status" class="statistics-empty">${error?'I dati non sono disponibili.':'Caricamento statistiche…'}</p>`:`<div class="table-wrap"><table><thead><tr>${columns.map(([,label])=>`<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${visible.map(row=>`<tr>${columns.map(([key])=>`<td class="${typeof row[key]==='number'?'statistics-number':''}">${value(key,row[key],c)}</td>`).join('')}</tr>`).join('')||`<tr><td colspan="${columns.length}" class="statistics-empty">Nessun dato per il periodo e la macchina selezionati.</td></tr>`}</tbody></table></div>${pages>1?`<div class="statistics-pagination"><button class="button secondary" id="statistics-previous" ${page===0?'disabled':''}>← Precedente</button><span>Pagina ${page+1} di ${pages}</span><button class="button secondary" id="statistics-next" ${page===pages-1?'disabled':''}>Successiva →</button></div>`:''}`}
 <p class="statistics-method">L’export comprende tutte le righe filtrate, in fogli distinti. “—” indica un dato non disponibile. Lo storico DEMO-STORICO contiene dati simulati; è incluso nelle statistiche.</p></section></div></details>`;
}
async function load(c) {
 if(loading)return;
 const token=++request; loading=true;error=''; c.render();
 try { const result=await c.api(`statistics?${new URLSearchParams(filters)}`); if(token!==request)return; report=result;filters={from:result.filters.from,to:result.filters.to,machineId:result.filters.machineId||''}; revision=c.state.revision; }
 catch(e) { if(token===request)error=e.message; }
 finally { if(token===request){loading=false;if(c.isActive())c.render();} }
}
export function bindStatistics(c) {
 chartAbort?.abort();chartAbort=new AbortController();
 document.addEventListener('keydown',event=>{if(event.key==='Escape')document.querySelectorAll('.statistics-bar-mark:hover,.statistics-bar-mark:focus').forEach(mark=>mark.classList.add('tooltip-dismissed'));},{signal:chartAbort.signal});
 document.querySelector('#statistics-filters').onsubmit=e=>{e.preventDefault();const next=Object.fromEntries(new FormData(e.target));if(next.from>next.to){c.toast('La data finale deve seguire quella iniziale.',true);return;} filters=next; report=null;page=0;load(c);};
 document.querySelectorAll('[data-statistics-tab]').forEach(b=>b.onclick=()=>{selected=b.dataset.statisticsTab;page=0;c.render();});
 document.querySelectorAll('[data-chart-unit]').forEach(b=>b.onclick=()=>{chartUnits[b.dataset.chartUnit]=b.dataset.unit;c.render();});
 document.querySelectorAll('.statistics-bar-mark').forEach(mark=>{
  mark.addEventListener('keydown',event=>{if(event.key==='Escape'){mark.classList.add('tooltip-dismissed');event.stopPropagation();}});
  mark.addEventListener('blur',()=>mark.classList.remove('tooltip-dismissed'));
  mark.addEventListener('pointerleave',()=>mark.classList.remove('tooltip-dismissed'));
 });
 document.querySelector('#statisticsTableDetails')?.addEventListener('toggle',event=>{tablesOpen=event.currentTarget.open;const summary=document.querySelector('#statisticsTablesToggle');if(summary)summary.firstChild.textContent=tablesOpen?'Nascondi tabelle':'Mostra tabelle';});
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
