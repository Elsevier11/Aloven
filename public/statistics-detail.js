const PAGE_SIZE=25;
const ROME='Europe/Rome';
const number=new Intl.NumberFormat('it-IT',{maximumFractionDigits:2});
const dateTime=new Intl.DateTimeFormat('it-IT',{timeZone:ROME,dateStyle:'short',timeStyle:'short'});
const qualities={conforming:'Conforme',nonconforming:'Non conforme',review:'Da verificare'};
const checkLabels={pass:'Conforme',fail:'Non conforme',na:'Non verificato'};
const dispositions={pending:'Da decidere',released:'Rilasciato',scrapped:'Destinato a scarto',rework:'Da rilavorare'};

function present(value){return value!==undefined&&value!==null&&value!=='';}
function same(actual,expected){return !present(expected)||actual===expected;}
function text(value,c,fallback='—'){return present(value)?c.esc(value):fallback;}
function numeric(value){return value===null||value===undefined?'—':number.format(value);}
function unit(value,c){return present(value)?c.esc(c.unitLabel(value)):'—';}
function when(value){return present(value)?dateTime.format(new Date(value)):'—';}
function machineName(c,id){return c.state.machines?.find(machine=>machine.id===id)?.name||id||'Macchina non registrata';}
function modal(){return document.querySelector('#modal');}
function footer(label='Torna ai risultati'){return `<div class="dialog-footer"><button type="button" class="button secondary" data-statistics-detail-back>${label}</button></div>`;}
function pager(page,total){const pages=Math.max(1,Math.ceil(total/PAGE_SIZE));return pages>1?`<div class="statistics-detail-pagination"><button type="button" class="button secondary" data-statistics-detail-page="${page-1}" ${page===0?'disabled':''}>← Precedente</button><span>Pagina ${page+1} di ${pages}</span><button type="button" class="button secondary" data-statistics-detail-page="${page+1}" ${page>=pages-1?'disabled':''}>Successiva →</button></div>`:'';}

function romeParts(date){return Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:ROME,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date).map(part=>[part.type,part.value]));}
function romeMidnight(date){const target=Date.parse(`${date}T00:00:00Z`);let guess=target;for(let index=0;index<4;index++){const part=romeParts(new Date(guess));const represented=Date.parse(`${part.year}-${part.month}-${part.day}T${part.hour}:${part.minute}:${part.second}Z`);guess+=target-represented;}return guess;}
function nextDate(date){const value=new Date(`${date}T00:00:00Z`);value.setUTCDate(value.getUTCDate()+1);return value.toISOString().slice(0,10);}
function isDemoRecord(row){const id=String(row.taskId??row.id??''),title=String(row.taskTitle??'');return id==='sim10m-v1'||id.startsWith('sim10m-v1-')||title==='DEMO-STORICO'||title.startsWith('DEMO-STORICO · ');}
function unclassifiedCode(row){return row.reasonCode||'unclassified-legacy';}
function unclassifiedLabel(row){return row.reason||'Non classificata (storico)';}

export function traceComplete(execution){
 const lots=Array.isArray(execution?.lots)?execution.lots:[];
 return Boolean(String(execution?.outputLot||'').trim())&&['component1','component2'].every(component=>lots.some(lot=>lot.component===component&&String(lot.lot||'').trim()));
}

function activityRows(report,descriptor){
 return (report.details||[]).filter(row=>same(row.month,descriptor.month)&&same(row.completedDate,descriptor.date)&&same(row.machineId,descriptor.machineId)&&same(row.productCode,descriptor.productCode)&&same(row.productDescription,descriptor.productDescription)&&same(row.unit,descriptor.unit)&&same(row.scrapReasonCode,descriptor.scrapReasonCode)&&same(row.scrapReasonLabel,descriptor.scrapReasonLabel)&&same(row.qualityStatus,descriptor.qualityStatus)&&same(row.taskId,descriptor.taskId)&&(!descriptor.scrapOnly||Number(row.scrapQuantity)>0));
}

function traceMatches(execution,status){return !present(status)||(status==='complete'?traceComplete(execution):!traceComplete(execution));}

function clippedStops(c,report,filters,descriptor){
 const from=descriptor.date||filters.from,to=descriptor.date||filters.to;
 const rangeStart=romeMidnight(from),rangeEnd=romeMidnight(nextDate(to)),generated=Date.parse(report.generatedAt),now=Number.isFinite(generated)?generated:Date.now(),effectiveEnd=Math.min(rangeEnd,now);
 return (c.state.machineStops||[]).flatMap(stop=>{
  if(filters.excludeDemo&&isDemoRecord(stop))return [];
  if(!same(stop.machineId,filters.machineId)||!same(stop.machineId,descriptor.machineId)||!same(unclassifiedCode(stop),descriptor.reasonCode)||!same(unclassifiedLabel(stop),descriptor.reasonLabel))return [];
  const started=Date.parse(stop.startedAt),ended=stop.endedAt?Date.parse(stop.endedAt):null;
  if(!Number.isFinite(started)||started>=effectiveEnd||(ended!==null&&(!Number.isFinite(ended)||ended<=rangeStart)))return [];
  const clippedStart=Math.max(started,rangeStart),clippedEnd=Math.min(ended??effectiveEnd,effectiveEnd);
  return clippedEnd>clippedStart?[{...stop,clippedStart,clippedEnd,clippedHours:Math.round((clippedEnd-clippedStart)/36000)/100}]:[];
 }).sort((a,b)=>b.clippedStart-a.clippedStart||String(a.id).localeCompare(String(b.id)));
}

function bindPager(render){modal()?.querySelectorAll('[data-statistics-detail-page]').forEach(button=>button.onclick=()=>render(Number(button.dataset.statisticsDetailPage)));}

function analysisFor(descriptor){return descriptor.analysis||(descriptor.traceStatus?'trace':descriptor.qualityStatus||descriptor.attention?'quality':descriptor.scrapOnly||descriptor.scrapReasonCode?'scrap':'production');}
function detailColumns(analysis,c){
 const quantity=(row,key)=>`${numeric(row[key])} ${unit(row.unit,c)}`;
 const execution=row=>c.state.executions?.find(item=>item.taskId===row.taskId);
 const columns=[['Lavorazione',row=>`<strong>${text(row.productCode,c)}</strong><span class="statistics-detail-context">${text(row.taskTitle,c)}</span><span class="statistics-detail-context">${text(row.machineName,c)} · ${when(row.completedAt)}</span>`]];
 if(analysis==='quality')columns.push(['Esito qualità',row=>text(qualities[row.qualityStatus]||row.qualityStatus,c,'Non classificato')],['Aspetto / adesione',row=>{const checks=execution(row)?.qualityChecks||{};return `${text(checkLabels[checks.appearance],c)} / ${text(checkLabels[checks.bonding],c)}`;}],['Decisione sul prodotto',row=>text(dispositions[execution(row)?.qualityDisposition],c,'Non registrata')],['Note qualità',row=>text(execution(row)?.qualityNotes,c)]);
 else if(analysis==='trace')columns.push(['Lotto prodotto',row=>lotButton(c,execution(row)?.outputLot,row.productCode,'output')],...['component1','component2'].map((component,index)=>[`Lotti componente ${index+1}`,row=>{const lots=(execution(row)?.lots||[]).filter(lot=>lot.component===component);return lots.map(lot=>`${text(lot.articleCode,c)} · ${lotButton(c,lot.lot,lot.articleCode,'input')}`).join('<br>')||'Non registrati';}]),['Completezza',row=>traceComplete(execution(row))?'Completa':'Incompleta']);
 else if(analysis==='timing')columns.push(['Lavorazione prevista (h)',row=>numeric(row.plannedRunHours)],['Lavorazione effettiva (h)',row=>numeric(row.actualRunHours)],['Attrezzaggio previsto (h)',row=>numeric(row.plannedSetupHours)],['Attrezzaggio effettivo (h)',row=>numeric(row.actualSetupHours)]);
 else if(analysis==='punctuality')columns.push(['Consegna',row=>text(row.dueDate,c)],['Chiusa il',row=>text(row.completedDate,c)],['Ritardo',row=>row.lateDays==null?'—':row.lateDays>0?`${row.lateDays} gg`:'In orario']);
 else if(analysis==='speed')columns.push(['Buona',row=>quantity(row,'goodQuantity')],['Ore attive',row=>numeric(row.actualRunHours)],['Buona/min',row=>`${numeric(row.actualRunSeconds>0&&row.goodQuantity!=null?row.goodQuantity/(row.actualRunSeconds/60):null)} ${unit(row.unit,c)}/min`]);
 else if(analysis==='scrap')columns.push(['Scarto',row=>quantity(row,'scrapQuantity')],['Incidenza scarto',row=>row.scrapRate==null?'—':new Intl.NumberFormat('it-IT',{style:'percent',maximumFractionDigits:2}).format(row.scrapRate)],['Causale scarto',row=>text(row.scrapReasonLabel,c)],['Buona',row=>quantity(row,'goodQuantity')]);
 else columns.push(['Prevista',row=>quantity(row,'plannedQuantity')],['Buona',row=>quantity(row,'goodQuantity')],['Scarto',row=>quantity(row,'scrapQuantity')]);
 return columns;
}

function detailSummary(c,rows,descriptor){
 const analysis=analysisFor(descriptor),sum=key=>rows.length&&rows.every(row=>row[key]!=null)?rows.reduce((total,row)=>total+Number(row[key]),0):null;
 const units=[...new Set(rows.map(row=>row.unit))];
 const quantities=key=>units.map(value=>{const group=rows.filter(row=>row.unit===value);return `${numeric(group.every(row=>row[key]!=null)?group.reduce((total,row)=>total+Number(row[key]),0):null)} ${unit(value,c)}`;}).join(' · ')||'—';
 const count=status=>number.format(rows.filter(row=>row.qualityStatus===status).length);
 let values;
 if(analysis==='quality')values=[['Conformi',count('conforming')],['Non conformi',count('nonconforming')],['Da verificare / non classificati',number.format(rows.filter(row=>!['conforming','nonconforming'].includes(row.qualityStatus)).length)]];
 else if(analysis==='trace'){const complete=rows.filter(row=>traceComplete(c.state.executions?.find(item=>item.taskId===row.taskId))).length;values=[['Dichiarazioni complete',number.format(complete)],['Dichiarazioni incomplete',number.format(rows.length-complete)]];}
 else if(analysis==='timing')values=[['Lavorazione prevista',`${numeric(sum('plannedRunSeconds')==null?null:sum('plannedRunSeconds')/3600)} h`],['Lavorazione effettiva',`${numeric(sum('actualRunSeconds')==null?null:sum('actualRunSeconds')/3600)} h`]];
 else if(analysis==='scrap')values=[['Scarto nella selezione',quantities('scrapQuantity')],['Consuntivi con scarto',number.format(rows.length)]];
 else if(analysis==='speed')values=[['Quantità buona',quantities('goodQuantity')],['Ore attive',`${numeric(sum('actualRunSeconds')==null?null:sum('actualRunSeconds')/3600)} h`]];
 else values=[['Quantità prevista',quantities('plannedQuantity')],['Quantità buona',quantities('goodQuantity')],['Scarto',quantities('scrapQuantity')]];
 return `<div class="statistics-detail-summary">${values.map(([label,value])=>`<div>${label}<strong>${value}</strong></div>`).join('')}</div>`;
}

function openActivityList(c,report,filters,descriptor,startPage=0){
 const all=activityRows(report,descriptor).filter(row=>{const execution=c.state.executions?.find(item=>item.taskId===row.taskId);return traceMatches(execution,descriptor.traceStatus)&&(!descriptor.classifiedOnly||['conforming','nonconforming'].includes(row.qualityStatus))&&(!descriptor.dueOnly||row.dueDate)&&(!descriptor.lateOnly||row.lateDays>0)&&(!descriptor.attention||['nonconforming','review'].includes(row.qualityStatus)||execution?.qualityDisposition==='pending');});
 const analysis=analysisFor(descriptor),columns=detailColumns(analysis,c),context=[`${filters.from} → ${filters.to}`,descriptor.machineId?machineName(c,descriptor.machineId):filters.machineId?machineName(c,filters.machineId):'Tutte le macchine',descriptor.unit?c.unitLabel(descriptor.unit):'Quantità separate per unità',descriptor.month||descriptor.date,descriptor.productCode].filter(Boolean).join(' · ');
 const render=page=>{const pages=Math.max(1,Math.ceil(all.length/PAGE_SIZE));page=Math.max(0,Math.min(page,pages-1));const rows=all.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE);
  c.openDialog(`${c.dialogHeader(c.esc(descriptor.title||'Consuntivi chiusi nel periodo'),`${number.format(all.length)} risultati`)}<div class="dialog-body statistics-detail-body statistics-detail-list" data-analysis="${c.esc(analysis)}"><p class="statistics-detail-method">${c.esc(context)}</p>${descriptor.classifiedOnly?'<p class="statistics-detail-method">Conformità: conformi / (conformi + non conformi). Esiti da verificare e non classificati esclusi.</p>':''}${detailSummary(c,all,descriptor)}<div class="table-wrap"><table><thead><tr>${columns.map(([label])=>`<th>${label}</th>`).join('')}<th></th></tr></thead><tbody>${rows.map(row=>`<tr>${columns.map(([,cell])=>`<td>${cell(row)}</td>`).join('')}<td><button type="button" class="button link" data-statistics-detail-task="${c.esc(row.taskId)}">Apri consuntivo</button></td></tr>`).join('')||`<tr><td colspan="${columns.length+1}">Nessun consuntivo corrispondente.</td></tr>`}</tbody></table></div>${pager(page,all.length)}</div>`);
  bindPager(render);modal()?.querySelectorAll('[data-statistics-detail-task]').forEach(button=>button.onclick=()=>openExecution(c,report,filters,descriptor,button.dataset.statisticsDetailTask,()=>render(page)));
  modal()?.querySelectorAll('[data-statistics-detail-lot]').forEach(button=>button.onclick=()=>openTrace(c,{lot:button.dataset.statisticsDetailLot,articleCode:button.dataset.statisticsDetailArticle,direction:button.dataset.statisticsDetailDirection},()=>render(page)));
 };render(startPage);
}

function lotButton(c,lot,articleCode,direction){if(!present(lot))return '—';return `<button type="button" class="button link" data-statistics-detail-lot="${c.esc(lot)}" data-statistics-detail-article="${c.esc(articleCode||'')}" data-statistics-detail-direction="${direction}">${c.esc(lot)}</button>`;}
function componentRows(c,execution){const lots=execution?.lots||[];return lots.map(lot=>`<tr><td>${text(lot.component==='component1'?execution.component1Code:execution.component2Code,c)}</td><td>${lotButton(c,lot.lot,lot.articleCode,'input')}</td><td>${numeric(lot.quantity)} ${unit(lot.unit,c)}</td></tr>`).join('')||'<tr><td colspan="3">Nessun lotto componente registrato.</td></tr>';}

function openExecution(c,report,filters,descriptor,taskId,back){
 const row=(report.details||[]).find(item=>item.taskId===taskId),execution=c.state.executions?.find(item=>item.taskId===taskId),task=c.state.tasks?.find(item=>item.id===taskId);
 if(!row){back();return;}
 const checks=execution?.qualityChecks||{};
 c.openDialog(`${c.dialogHeader('Scheda consuntivo',c.esc(row.taskTitle||task?.title||taskId))}<div class="dialog-body statistics-detail-body statistics-detail-record"><div class="statistics-detail-grid"><div><span>Chiusura</span><strong>${when(row.completedAt)}</strong></div><div><span>Macchina</span><strong>${text(row.machineName,c)}</strong></div><div><span>Prodotto</span><strong>${text(row.productCode,c)} · ${text(row.productDescription,c)}</strong></div><div><span>Lotto prodotto</span><strong>${lotButton(c,execution?.outputLot,row.productCode,'output')}</strong></div><div><span>Ordine</span><strong>${text(task?.orderReference,c)}</strong></div><div><span>ERP</span><strong>${text(task?.erpReference,c)}</strong></div><div><span>Previsto lavorazione chiusa</span><strong>${numeric(row.plannedQuantity)} ${unit(row.unit,c)}</strong></div><div><span>Quantità buona</span><strong>${numeric(row.goodQuantity)} ${unit(row.unit,c)}</strong></div><div><span>Scarto</span><strong>${numeric(row.scrapQuantity)} ${unit(row.unit,c)}</strong></div><div><span>Produzione prevista / effettiva</span><strong>${numeric(row.plannedRunHours)} / ${numeric(row.actualRunHours)} h</strong></div><div><span>Attrezzaggio base previsto / effettivo</span><strong>${numeric(row.plannedSetupHours)} / ${numeric(row.actualSetupHours)} h</strong></div><div><span>Qualità / decisione</span><strong>${text(qualities[execution?.qualityStatus]||execution?.qualityStatus,c)} · ${text(dispositions[execution?.qualityDisposition]||execution?.qualityDisposition,c,'Storico non classificato')}</strong></div></div>${row.plausibilityFlagged?`<p class="statistics-detail-method"><strong>Fuori soglia · da verificare.</strong> ${(row.plausibilityFlags||[]).map(flag=>c.esc(flag.message)).join(' ')}${row.plausibilityReason?` Motivo: ${c.esc(row.plausibilityReason)}`:''}</p>`:''}<p>Controllo aspetto: <strong>${text(checkLabels[checks.appearance]||checks.appearance,c)}</strong> · adesione: <strong>${text(checkLabels[checks.bonding]||checks.bonding,c)}</strong></p>${execution?.qualityNotes?`<p class="statistics-detail-method">Note qualità: ${c.esc(execution.qualityNotes)}</p>`:''}<h3>Lotti componenti</h3><div class="table-wrap"><table><thead><tr><th>Componente</th><th>Lotto</th><th>Quantità</th></tr></thead><tbody>${componentRows(c,execution)}</tbody></table></div></div>${footer()}`);
 const setupLabel=[...(modal()?.querySelectorAll('.statistics-detail-grid span')||[])].find(item=>item.textContent.startsWith('Attrezzaggio base previsto'));
 if(setupLabel)setupLabel.textContent='Attrezzaggio previsto / effettivo';
 modal()?.querySelector('[data-statistics-detail-back]')?.addEventListener('click',back);
 modal()?.querySelectorAll('[data-statistics-detail-lot]').forEach(button=>button.onclick=()=>openTrace(c,{lot:button.dataset.statisticsDetailLot,articleCode:button.dataset.statisticsDetailArticle,direction:button.dataset.statisticsDetailDirection},()=>openExecution(c,report,filters,descriptor,taskId,back)));
}

let traceRequest=0;
function openTrace(c,query,back){
 const request=++traceRequest;
 const leave=()=>{if(traceRequest===request)traceRequest++;back();};
 const load=async()=>{
  c.openDialog(`${c.dialogHeader('Tracciabilità lotto',c.esc(query.lot))}<div class="dialog-body statistics-detail-body statistics-detail-trace"><p role="status">Caricamento relazioni…</p></div>${footer('Torna alla scheda')}`);modal()?.querySelector('[data-statistics-detail-back]')?.addEventListener('click',leave);
  const loadingBody=modal()?.querySelector('.statistics-detail-trace');
  try{const params=new URLSearchParams({lot:query.lot,direction:query.direction});if(query.articleCode)params.set('articleCode',query.articleCode);const result=await c.api(`mes/trace?${params}`);if(request!==traceRequest||!c.isActive()||!modal()?.open||!loadingBody?.isConnected)return;renderTrace(c,result,back,0,request);}
  catch(error){if(request!==traceRequest||!c.isActive()||!modal()?.open||!loadingBody?.isConnected)return;c.openDialog(`${c.dialogHeader('Tracciabilità lotto',c.esc(query.lot))}<div class="dialog-body statistics-detail-body statistics-detail-trace"><p class="statistics-detail-error" role="alert">${c.esc(error.message)}</p><button type="button" class="button primary" data-statistics-detail-retry>Riprova</button></div>${footer('Torna alla scheda')}`);modal()?.querySelector('[data-statistics-detail-retry]')?.addEventListener('click',load);modal()?.querySelector('[data-statistics-detail-back]')?.addEventListener('click',leave);}
 };load();
}

function renderTrace(c,result,back,startPage,request){const records=result.records||[];const render=page=>{if(request!==traceRequest)return;const pages=Math.max(1,Math.ceil(records.length/PAGE_SIZE));page=Math.max(0,Math.min(page,pages-1));const visible=records.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE);c.openDialog(`${c.dialogHeader('Tracciabilità lotto',c.esc(result.lot))}<div class="dialog-body statistics-detail-body statistics-detail-trace"><p class="statistics-detail-method">Ricerca esatta sull’intero storico, indipendente dai filtri statistici. I collegamenti descrivono la lavorazione, non i consumi di singole bobine.</p>${visible.map(record=>`<article class="statistics-detail-trace-record"><h3>${text(record.taskTitle,c)}</h3><p>${text(record.productCode,c)} · ${text(machineName(c,record.machineId),c)} · ${when(record.runEndedAt)}</p><p>Lotto prodotto: <strong>${text(record.outputLot,c,'Non registrato')}</strong> · buona ${numeric(record.producedQuantity)} ${unit(record.productUnit,c)} · scarto ${numeric(record.scrapQuantity)}</p><div class="table-wrap"><table><thead><tr><th>Componente</th><th>Lotto consumato</th><th>Quantità</th></tr></thead><tbody>${(record.inputLots||[]).map(lot=>`<tr><td>${text(lot.articleCode,c)}</td><td>${text(lot.lot,c)}</td><td>${numeric(lot.quantity)} ${unit(lot.unit,c)}</td></tr>`).join('')||'<tr><td colspan="3">Nessun lotto componente registrato.</td></tr>'}</tbody></table></div></article>`).join('')||'<p>Nessuna relazione reale trovata per il lotto.</p>'}${pager(page,records.length)}</div>${footer('Torna alla scheda')}`);bindPager(render);modal()?.querySelector('[data-statistics-detail-back]')?.addEventListener('click',back);};render(startPage);}

function openStopList(c,report,filters,descriptor,startPage=0){const all=clippedStops(c,report,filters,descriptor);const render=page=>{const pages=Math.max(1,Math.ceil(all.length/PAGE_SIZE));page=Math.max(0,Math.min(page,pages-1));const visible=all.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE);c.openDialog(`${c.dialogHeader(c.esc(descriptor.title||'Fermi macchina'),`${number.format(all.length)} risultati`)}<div class="dialog-body statistics-detail-body statistics-detail-list"><div class="table-wrap"><table><thead><tr><th>Macchina</th><th>Causale</th><th>Periodo nel filtro</th><th>Ore</th><th></th></tr></thead><tbody>${visible.map((stop,index)=>`<tr><td>${text(machineName(c,stop.machineId),c)}</td><td>${text(unclassifiedLabel(stop),c)}</td><td>${when(new Date(stop.clippedStart).toISOString())} → ${when(new Date(stop.clippedEnd).toISOString())}</td><td>${numeric(stop.clippedHours)}</td><td><button type="button" class="button link" data-statistics-detail-stop="${page*PAGE_SIZE+index}">Apri fermo</button></td></tr>`).join('')||'<tr><td colspan="5">Nessun fermo corrispondente.</td></tr>'}</tbody></table></div>${pager(page,all.length)}</div>`);bindPager(render);modal()?.querySelectorAll('[data-statistics-detail-stop]').forEach(button=>button.onclick=()=>openStop(c,all[Number(button.dataset.statisticsDetailStop)],()=>render(page)));};render(startPage);}
function openStop(c,stop,back){c.openDialog(`${c.dialogHeader('Scheda fermo',c.esc(machineName(c,stop.machineId)))}<div class="dialog-body statistics-detail-body statistics-detail-record"><div class="statistics-detail-grid"><div><span>Causale storica</span><strong>${text(unclassifiedCode(stop),c)} · ${text(unclassifiedLabel(stop),c)}</strong></div><div><span>Stato</span><strong>${stop.endedAt?'Chiuso':'Aperto'}</strong></div><div><span>Fermo reale</span><strong>${when(stop.startedAt)} → ${stop.endedAt?when(stop.endedAt):'ancora aperto'}</strong></div><div><span>Quota nel periodo selezionato</span><strong>${when(new Date(stop.clippedStart).toISOString())} → ${when(new Date(stop.clippedEnd).toISOString())}</strong></div><div><span>Durata nel periodo</span><strong>${numeric(stop.clippedHours)} h</strong></div><div><span>Operatore</span><strong>${text(stop.userName,c)}</strong></div></div></div>${footer()}`);modal()?.querySelector('[data-statistics-detail-back]')?.addEventListener('click',back);}

function openDaily(c,report,filters,descriptor,startPage=0){const all=(report.dailyActivity||[]).filter(row=>same(row.date,descriptor.date)&&same(row.machineId,descriptor.machineId));const render=page=>{const pages=Math.max(1,Math.ceil(all.length/PAGE_SIZE));page=Math.max(0,Math.min(page,pages-1));const visible=all.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE);c.openDialog(`${c.dialogHeader(c.esc(descriptor.title||'Ore attive per giorno'),c.esc(report.coverage?.message||'Copertura non disponibile'))}<div class="dialog-body statistics-detail-body statistics-detail-list"><p class="statistics-detail-method">Le ore derivano dagli eventi. Le quantità restano attribuite alla chiusura del consuntivo.</p><div class="table-wrap"><table><thead><tr><th>Data</th><th>Macchina</th><th>Ore attive</th><th></th></tr></thead><tbody>${visible.map(row=>`<tr><td>${text(row.date,c)}</td><td>${text(row.machineName,c)}</td><td>${numeric(row.activeRunHours)}</td><td><button type="button" class="button link" data-statistics-detail-daily-machine="${c.esc(row.machineId)}">Consuntivi chiusi nel periodo</button></td></tr>`).join('')||'<tr><td colspan="4">Nessuna ora attiva corrispondente.</td></tr>'}</tbody></table></div>${pager(page,all.length)}</div>`);bindPager(render);modal()?.querySelectorAll('[data-statistics-detail-daily-machine]').forEach(button=>button.onclick=()=>openActivityList(c,report,filters,{kind:'activities',title:'Consuntivi chiusi nel periodo',machineId:button.dataset.statisticsDetailDailyMachine},0));};render(startPage);}

export function openStatisticsDetail(c,report,filters,descriptor){
 if(!descriptor||!['activities','stops','daily'].includes(descriptor.kind))throw new TypeError('Tipo di dettaglio statistico non valido.');
 if(descriptor.kind==='activities'&&descriptor.taskId)openExecution(c,report,filters,descriptor,descriptor.taskId,()=>openActivityList(c,report,filters,descriptor));
 else if(descriptor.kind==='activities')openActivityList(c,report,filters,descriptor);
 else if(descriptor.kind==='stops')openStopList(c,report,filters,descriptor);
 else openDaily(c,report,filters,descriptor);
}
