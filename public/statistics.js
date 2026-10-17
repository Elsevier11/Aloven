import {openStatisticsDetail,traceComplete} from './statistics-detail.js';
const number = new Intl.NumberFormat('it-IT',{maximumFractionDigits:2});
const percent = new Intl.NumberFormat('it-IT',{style:'percent',maximumFractionDigits:2});
const dateFormat = new Intl.DateTimeFormat('it-IT',{timeZone:'Europe/Rome',dateStyle:'short',timeStyle:'short'});
let filters=null,report=null,loading=false,error='',revision=null,selected='monthly',page=0,request=0,tablesOpen=false,chartAbort=null;
let dashboard='overview',grain='month',dashboardUnit=null;
const chartUnits={monthly:null,scrapReasons:null};
const metrics=[['count','Attività'],['plannedQuantity','Previsto lavorazioni chiuse'],['goodQuantity','Q.tà buona'],['scrapQuantity','Scarto'],['scrapRate','Scarto %'],['plannedSetupHours','Attrezzaggio previsto (h)'],['actualSetupHours','Attrezzaggio effettivo (h)'],['setupPairedCount','Coppie attr.'],['setupDeltaHours','Delta attr. (h)'],['averageSetupDeltaMinutes','Delta medio (min)'],['plannedRunHours','Lav. prevista (h)'],['actualRunHours','Lav. effettiva (h)'],['nonconformingCount','Non conformi'],['plausibilityFlaggedCount','Fuori soglia']];
const tables={
 monthly:{label:'Per mese',columns:[['month','Mese'],['unit','Unità'],...metrics]},
 machines:{label:'Per macchina',columns:[['machineName','Macchina'],['unit','Unità'],...metrics]},
 products:{label:'Per prodotto',columns:[['productCode','Codice'],['productDescription','Prodotto'],['unit','Unità'],...metrics]},
 scrapReasons:{label:'Causali scarto',columns:[['reasonCode','Codice'],['label','Causale'],['unit','Unità'],['count','Attività con scarto'],['scrapQuantity','Q.tà scartata']]},
 stopReasons:{label:'Fermi macchina',columns:[['reasonCode','Codice'],['label','Causale'],['stopCount','Fermi'],['closedStopCount','Chiusi'],['openStopCount','Aperti'],['stoppedHours','Durata nel periodo (h)']]},
 speeds:{label:'Velocità effettiva',columns:[['machineName','Macchina'],['productCode','Codice'],['productDescription','Prodotto'],['unit','Unità'],['count','Attività'],['activeRunHours','Ore attive'],['goodQuantity','Q.tà buona'],['totalQuantity','Q.tà totale'],['goodUnitsPerMinute','Buona/min'],['totalUnitsPerMinute','Totale/min']]},
 dailyActivity:{label:'Attività giornaliera',columns:[['date','Data'],['machineName','Macchina'],['activeRunHours','Ore lavorazione attiva']]},
 details:{label:'Dettaglio attività',columns:[['closureStatus','Chiusura'],['completedAt','Chiusa il'],['taskTitle','Attività'],['machineName','Macchina'],['productCode','Prodotto'],['unit','Unità'],...metrics.filter(x=>x[0]!=='count'),['qualityStatus','Qualità'],['scrapReasonLabel','Causale scarto']]},
};
// Short axis labels that cannot wrap at the hyphen: «dic 25» for months, «13/10» for days.
function axisLabel(label,grain){if(grain==='day'&&label.length>=10)return label.slice(8,10)+'/'+label.slice(5,7);if(grain==='month'&&label.length===7&&label[4]==='-')return new Date(label+'-01T12:00:00Z').toLocaleDateString('it-IT',{month:'short',year:'2-digit',timeZone:'UTC'}).replace('.','');return label;}
// Scostamento percentuale effettivo/previsto: sopra il 5 % in ambra, sotto il -5 % in verde.
function deviation(x) {
  if (x === null || x === undefined) return '—';
  const text = (x > 0 ? '+' : x < 0 ? '−' : '') + new Intl.NumberFormat('it-IT',{style:'percent',maximumFractionDigits:1}).format(Math.abs(x));
  return `<span class="statistics-dev ${x > .05 ? 'statistics-amber' : x < -.05 ? 'statistics-green' : ''}">${text}</span>`;
}

// Tendenza rispetto al periodo precedente: freccia e segno, mai solo il colore.
// mode 'rel' = variazione relativa (quantità, ore); 'pts' = differenza in punti percentuali (tassi).
function trend(current, previous, better, mode, range) {
  if (current === null || current === undefined || previous === null || previous === undefined) return '';
  const delta = mode === 'pts' ? (current-previous)*100 : previous === 0 ? null : (current-previous)/previous*100;
  if (delta === null || !Number.isFinite(delta)) return '';
  const flat = Math.abs(delta) < .05, arrow = flat ? '▬' : delta > 0 ? '▲' : '▼';
  const tone = flat ? '' : (delta > 0) === (better === 'up') ? 'statistics-green' : 'statistics-amber';
  const text = (delta > 0 ? '+' : delta < 0 ? '−' : '') + new Intl.NumberFormat('it-IT',{maximumFractionDigits:1}).format(Math.abs(delta)) + (mode === 'pts' ? ' pt' : ' %');
  return `<em class="statistics-trend ${tone}" title="Rispetto al periodo precedente (${range})">${arrow} ${text}</em>`;
}

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
let executionState=null,executionIndex=new Map();
function executionFor(c,id){if(executionState!==c.state){executionState=c.state;executionIndex=new Map(c.state.executions.map(e=>[e.taskId,e]));}return executionIndex.get(id);}
function drillAttrs(descriptor,c){return `data-statistics-detail="${c.esc(JSON.stringify({kind:'activities',...descriptor}))}"`;}
function drillButton(label,descriptor,c,cls='statistics-link'){return `<button type="button" class="${cls}" ${drillAttrs(descriptor,c)}>${c.esc(label)}</button>`;}
function descriptorFor(kind,row){
 const title=tables[kind]?.label||'Consuntivi';
 if(kind==='details')return {taskId:row.taskId,title:row.taskTitle};
 if(kind==='monthly')return {analysis:'production',month:row.month,unit:row.unit,title:`Produzione · ${row.month}`};
 if(kind==='machines')return {analysis:'timing',machineId:row.machineId,unit:row.unit,title:row.machineName};
 if(kind==='products'||kind==='speeds')return {analysis:kind==='speeds'?'speed':'production',machineId:kind==='speeds'?row.machineId:undefined,productCode:row.productCode,productDescription:row.productDescription,unit:row.unit,title:row.productDescription||row.productCode};
 if(kind==='scrapReasons')return {analysis:'scrap',scrapOnly:true,scrapReasonCode:row.reasonCode,scrapReasonLabel:row.label,unit:row.unit,title:row.label};
 if(kind==='stopReasons')return {kind:'stops',reasonCode:row.reasonCode,reasonLabel:row.label,title:row.label};
 if(kind==='dailyActivity')return {kind:'daily',date:row.date,machineId:row.machineId,title:`Ore attive · ${row.date} · ${row.machineName}`};
 return {title};
}
function chartPanel({id,title,description,controls='',body,detail},c){return `<section id="${id}" class="statistics-chart-card" aria-labelledby="${id}-title"><div class="statistics-chart-heading"><div><h2 id="${id}-title">${c.esc(title)}</h2><p>${c.esc(description)}</p></div>${controls}${detail?drillButton('Analizza dati →',detail,c):''}</div>${body}</section>`;}
const emptyChart=text=>`<p class="statistics-chart-empty">${text}</p>`;
const legend=items=>`<div class="statistics-chart-legend">${items.map(([tone,label])=>`<span><i class="${tone}" aria-hidden="true"></i>${label}</span>`).join('')}</div>`;
function barChart(rows,{labelOf,series,descriptor,empty},c){
 if(!rows.length)return emptyChart(empty);
 const max=Math.max(0,...rows.flatMap(r=>series.map(x=>Number(r[x.key])||0)));
 return `<div class="statistics-bar-chart${series.length===1?' single-series':''}">${rows.map(row=>{const label=labelOf(row);return `<div class="statistics-bar-group"><h3>${drillButton(label,descriptor(row),c)}</h3>${series.map(item=>{const amount=row[item.key],missing=amount==null,spoken=missing?'dato non disponibile':number.format(amount)+(item.suffix||'');return `<button type="button" class="statistics-bar-mark ${missing?'is-missing':amount===0?'is-zero':''}" ${drillAttrs(descriptor(row),c)} aria-label="${c.esc(label+', '+item.label+': '+spoken)}"><span class="statistics-series">${item.label}</span><span class="statistics-bar-track" aria-hidden="true"><i class="statistics-bar-fill ${item.tone}" style="--bar-size:${max&&!missing?amount/max*100:0}%"></i></span><strong>${c.esc(missing?'—':spoken)}</strong><span class="statistics-chart-tooltip" role="tooltip">${c.esc(label)} · ${c.esc(spoken)} · clicca per i consuntivi</span></button>`;}).join('')}</div>`;}).join('')}</div>`;
}
function productionChart(c){
 const controls=unitPicker('monthly',report.monthly,c,'Unità del grafico produzione mensile'),unit=chartUnits.monthly;
 let rows=report.monthly.filter(r=>r.unit===unit).map(r=>({...r,label:r.month,descriptor:{month:r.month,unit,title:`Produzione · ${r.month}`}}));
 if(grain==='day'){
  const grouped=new Map();for(const r of report.details.filter(r=>r.unit===unit)){if(!grouped.has(r.completedDate))grouped.set(r.completedDate,[]);grouped.get(r.completedDate).push(r);}
  rows=[...grouped.entries()].map(([date,items])=>({label:date,goodQuantity:sumNullable(items,'goodQuantity'),plannedQuantity:sumNullable(items,'plannedQuantity'),descriptor:{date,unit,title:`Produzione chiusa · ${date}`}})).sort((a,b)=>a.label.localeCompare(b.label));
 }
 const max=Math.max(0,...rows.flatMap(r=>[r.goodQuantity||0,r.plannedQuantity||0]));
 const x=i=>80+(rows.length===1?280:i*560/(rows.length-1)),y=v=>165-(max?v/max*140:0);
 const path=key=>{let gap=true;return rows.map((r,i)=>{if(r[key]==null){gap=true;return '';}const part=`${gap?'M':'L'}${x(i)} ${y(r[key])}`;gap=false;return part;}).join(' ');};
 const series=[['plannedQuantity','Previsto chiuse','planned'],['goodQuantity','Buona','actual']];
 const graph=rows.length?`${legend([['actual','Produzione buona'],['planned','Quantità prevista']])}<div class="statistics-plot-scroll"><div class="statistics-plot" style="min-width:${rows.length>31?rows.length*18:0}px"><div class="statistics-y-axis" aria-hidden="true">${[1,.75,.5,.25,0].map(r=>`<span>${new Intl.NumberFormat('it-IT',{notation:'compact',maximumFractionDigits:1}).format(max*r)}</span>`).join('')}</div><svg viewBox="0 0 660 190" preserveAspectRatio="none" aria-hidden="true">${[25,60,95,130,165].map(y=>`<line x1="70" x2="640" y1="${y}" y2="${y}" stroke="#e9eef5"/>`).join('')}${series.map(([key,,tone])=>`<path d="${path(key)}" fill="none" stroke="${tone==='actual'?'var(--mes-blue)':'#91b2ed'}" stroke-width="3" ${tone==='planned'?'stroke-dasharray="6 5"':''}/>`).join('')}</svg>${rows.map((r,i)=>series.map(([key,label,tone])=>r[key]==null?'':`<button type="button" class="statistics-point ${tone}${y(r[key])<50?' tooltip-below':''}${i===0?' edge-start':i===rows.length-1?' edge-end':''}${r[key]===0?' is-zero':''}" style="left:${x(i)/660*100}%;top:${y(r[key])/190*100}%" ${drillAttrs(r.descriptor,c)} aria-label="${c.esc(r.label+', '+label+': '+number.format(r[key])+' '+c.unitLabel(unit))}"><span class="statistics-chart-tooltip" role="tooltip">${c.esc(r.label)} · ${label}: ${number.format(r[key])} ${c.esc(c.unitLabel(unit))}</span></button>`).join('')).join('')}<div class="statistics-axis-labels">${rows.filter((_,i)=>rows.length<=12||i%Math.ceil(rows.length/12)===0||i===rows.length-1).map(r=>`<span>${c.esc(axisLabel(r.label,grain))}</span>`).join('')}</div></div></div><p class="statistics-plot-note">Scala: 0–${number.format(max)} ${c.esc(c.unitLabel(unit))}. </p>`:emptyChart('Nessuna produzione nel periodo selezionato.');
 return chartPanel({id:'monthly-production',title:grain==='month'?'Produzione mensile':'Produzione per giorno di chiusura',description:'Quantità buona rispetto a quella prevista, per data di chiusura delle lavorazioni consuntivate.',controls:`${controls}<div class="statistics-grain"><button data-statistics-grain="month" aria-pressed="${grain==='month'}">Mese</button><button data-statistics-grain="day" aria-pressed="${grain==='day'}">Giorno</button></div>`,body:graph,detail:{analysis:'production',unit,title:'Consuntivi di produzione'}},c);
}
function stopsChart(c){
 const rows=report.stopReasons,total=rows.reduce((n,r)=>n+r.stoppedHours,0),palette=['var(--mes-amber)','var(--mes-red)','var(--mes-purple)','var(--mes-blue)','var(--mes-green)','var(--mes-muted)'];let offset=0;
 const donut=total>0?`<div class="statistics-donut"><svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="46" fill="none" stroke="#edf1f6" stroke-width="14"/>${rows.map((r,i)=>{const segment=r.stoppedHours/total*289.027,path=`<circle cx="60" cy="60" r="46" fill="none" stroke="${palette[i%palette.length]}" stroke-width="14" stroke-dasharray="${segment} ${289.027-segment}" stroke-dashoffset="${-offset}" transform="rotate(-90 60 60)"/>`;offset+=segment;return path;}).join('')}</svg><div><b>${number.format(report.totals.stoppedHours)} h</b><small>fermi nel periodo</small></div></div>`:'';
 return chartPanel({id:'downtime-causes',title:'Cause dei fermi',description:'Durate effettive ritagliate al periodo, inclusi i fermi aperti.',detail:{kind:'stops',title:'Fermi macchina'},body:rows.length?`<div class="statistics-donut-layout">${donut}<div class="statistics-cause-list">${rows.map((r,i)=>`<button type="button" ${drillAttrs(descriptorFor('stopReasons',r),c)}><i style="background:${palette[i%palette.length]}"></i><span>${c.esc(r.label)}</span><strong>${number.format(r.stoppedHours)} h</strong></button>`).join('')}</div></div>`:emptyChart('Nessun fermo nel periodo selezionato.')},c);
}
function dailyChart(c){
 const rows=report.dailyActivity,days=[...new Set(rows.map(r=>r.date))].sort().slice(-7),machines=[...new Map(rows.map(r=>[r.machineId,r.machineName])).entries()],max=Math.max(0,...rows.filter(r=>days.includes(r.date)).map(r=>r.activeRunHours));
 const body=rows.length?`<div class="statistics-heat-scroll"><div class="statistics-heat-grid" style="grid-template-columns:120px repeat(${days.length},minmax(42px,1fr))"><span></span>${days.map(d=>`<b>${c.esc(d.slice(8,10)+'/'+d.slice(5,7))}</b>`).join('')}${machines.map(([id,name])=>`${drillButton(name,{machineId:id,title:name},c,'statistics-heat-machine')}${days.map(d=>{const found=rows.find(r=>r.machineId===id&&r.date===d),hours=found?.activeRunHours??(report.coverage.status==='complete'?0:null),ratio=hours==null?0:max?hours/max:0,tone=hours==null?'missing':ratio>.75?'high':ratio>.4?'medium':ratio>0?'low':'zero';return `<button class="statistics-heat-cell ${tone}" ${drillAttrs({kind:'daily',machineId:id,date:d,title:`Ore attive · ${name} · ${d}`},c)} aria-label="${c.esc(name+' · '+d+' · '+(hours==null?'dato non disponibile':number.format(hours)+' ore attive'))}">${hours==null?'—':number.format(hours)}</button>`;}).join('')}`).join('')}</div></div><p class="statistics-plot-note">Ultime ${days.length} date con eventi nel periodo. Intensità relativa alle ore attive, non saturazione. ${c.esc(report.coverage.message)}</p>`:emptyChart('Nessuna ora attiva ricostruibile nel periodo.');
 return chartPanel({id:'daily-activity',title:'Attività delle macchine',description:'Ore di lavorazione attiva per giorno.',detail:{kind:'daily',title:'Ore attive giornaliere'},body},c);
}
function attentionChart(c){
 const items=report.details.filter(r=>r.plausibilityFlagged||['nonconforming','review'].includes(r.qualityStatus)||executionFor(c,r.taskId)?.qualityDisposition==='pending');
 return chartPanel({id:'quality-attention',title:'Qualità da verificare',description:'Consuntivi non conformi, fuori soglia o in attesa di decisione.',detail:{analysis:'quality',attention:true,title:'Qualità da verificare'},body:items.length?`<div class="statistics-mini-table"><table><thead><tr><th>Lavorazione / lotto</th><th>Macchina</th><th>Qualità</th></tr></thead><tbody>${items.slice(0,5).map(r=>{const e=executionFor(c,r.taskId);return `<tr><td>${drillButton(r.taskTitle,{analysis:'quality',taskId:r.taskId,title:r.taskTitle},c)}<small>${c.esc(e?.outputLot||'Lotto prodotto non registrato')}</small></td><td>${c.esc(r.machineName.split(' · ')[0])}</td><td><span class="statistics-status ${r.qualityStatus==='nonconforming'?'bad':'warning'}">${c.esc(r.plausibilityFlagged?'Fuori soglia · da verificare':value('qualityStatus',r.qualityStatus,c))}</span></td></tr>`;}).join('')}</tbody></table></div>`:emptyChart('Nessun consuntivo da verificare nel periodo.')},c);
}
function productsChart(c){
 const rows=(report.products||[]).filter(r=>r.unit===dashboardUnit).sort((a,b)=>(b.goodQuantity||0)-(a.goodQuantity||0));
 return chartPanel({id:'production-products',title:'Produzione per articolo',description:'Quantità buona degli articoli accoppiati.',detail:{analysis:'production',unit:dashboardUnit,title:'Produzione per articolo'},body:barChart(rows,{labelOf:r=>r.productCode+' · '+r.productDescription,series:[{key:'goodQuantity',label:'Buona',tone:'actual',suffix:' '+c.unitLabel(dashboardUnit)}],descriptor:r=>descriptorFor('products',r),empty:'Nessuna produzione nel periodo.'},c)},c);
}
function hoursChart(c){return chartPanel({id:'machine-hours',title:'Ore di produzione per macchina',description:'Tempi previsti ed effettivi delle lavorazioni consuntivate.',body:legend([['planned','Pianificate'],['actual','Effettive']])+barChart(machinesForChart(report.machines),{labelOf:r=>r.machineName,series:[{key:'plannedRunHours',label:'Pianificate',tone:'planned',suffix:' h'},{key:'actualRunHours',label:'Effettive',tone:'actual',suffix:' h'}],descriptor:r=>({analysis:'timing',machineId:r.machineId,title:r.machineName}),empty:'Nessuna ora di produzione nel periodo.'},c)},c);}
function scrapChart(c){const controls=unitPicker('scrapReasons',report.scrapReasons,c,'Unità del grafico causali scarto'),rows=report.scrapReasons.filter(r=>r.unit===chartUnits.scrapReasons);return chartPanel({id:'scrap-causes',title:'Scarti per causale',description:'Quantità attribuite alle causali registrate, per unità.',controls,body:barChart(rows,{labelOf:r=>r.label,series:[{key:'scrapQuantity',label:'Scarto',tone:'scrap'}],descriptor:r=>descriptorFor('scrapReasons',r),empty:'Nessuno scarto nel periodo.'},c)},c);}
function machineTable(c){
 return chartPanel({id:'machine-performance',title:'Confronto macchine',description:'Produzione, tempi e scarti; una riga per macchina e unità.',body:report.machines.length?`<div class="statistics-mini-table"><table><thead><tr><th>Macchina</th><th>Buona</th><th>Scarto</th><th>Ore attive</th><th title="Tempo di lavorazione effettivo rispetto al previsto">Scost. lavoraz.</th><th>Delta attr.</th></tr></thead><tbody>${report.machines.map(r=>`<tr><td>${drillButton(String(r.machineName).split(' · ')[0],descriptorFor('machines',r),c)}</td><td>${value('goodQuantity',r.goodQuantity,c)} ${c.esc(c.unitLabel(r.unit))}</td><td><span class="statistics-status ${r.scrapRate>0?'warning':'good'}">${value('scrapRate',r.scrapRate,c)}</span></td><td>${value('actualRunHours',r.actualRunHours,c)} h</td><td>${deviation(r.runDeviationRate)}</td><td class="${r.setupDeltaHours>0?'statistics-amber':'statistics-green'}">${value('setupDeltaHours',r.setupDeltaHours,c)} h</td></tr>`).join('')}</tbody></table></div>`:emptyChart('Nessun consuntivo per macchina.')},c);
}
function speedsChart(c){const rows=report.speeds.filter(r=>r.unit===dashboardUnit);return chartPanel({id:'effective-speed',title:'Velocità effettiva di accoppiamento',description:'Quantità buona per minuto di lavorazione attiva; nessuna velocità teorica inventata.',body:barChart(rows,{labelOf:r=>r.machineName.split(' · ')[0]+' · '+r.productCode,series:[{key:'goodUnitsPerMinute',label:'Buona/min',tone:'actual',suffix:' '+c.unitLabel(dashboardUnit)+'/min'}],descriptor:r=>descriptorFor('speeds',r),empty:'Nessuna velocità calcolabile nel periodo.'},c)},c);}
function traceChart(c){const complete=report.details.filter(r=>traceComplete(executionFor(c,r.taskId))).length,missing=report.details.length-complete;return chartPanel({id:'lot-coverage',title:'Tracciabilità dei lotti',description:'Lotto prodotto e lotti di entrambi i componenti presenti nella dichiarazione.',body:`<div class="statistics-quality-counts">${drillButton(complete+' complete',{analysis:'trace',traceStatus:'complete',title:'Dichiarazioni con lotti completi'},c,'statistics-quality-tile good')}${drillButton(missing+' incomplete / storico',{analysis:'trace',traceStatus:'missing',title:'Dichiarazioni con lotti mancanti'},c,'statistics-quality-tile warning')}</div><p class="statistics-plot-note">Il denominatore comprende tutti i consuntivi chiusi del periodo, incluso lo storico precedente alla raccolta del lotto prodotto. Quei record restano esplicitamente incompleti. I collegamenti descrivono la lavorazione, non i consumi di singole bobine.</p>`},c);}
function qualityChart(c){const statuses=[['conforming','Conformi','good'],['nonconforming','Non conformi','bad'],['review','Da verificare','warning']];return chartPanel({id:'quality-results',title:'Esiti dei controlli',description:'Esito qualità delle dichiarazioni, distinto dalla decisione sul prodotto.',body:`<div class="statistics-quality-counts">${statuses.map(([key,label,tone])=>drillButton(label+' · '+report.details.filter(r=>r.qualityStatus===key).length,{analysis:'quality',qualityStatus:key,title:label},c,'statistics-quality-tile '+tone)).join('')}</div><p class="statistics-plot-note">${report.details.filter(r=>!statuses.some(([key])=>key===r.qualityStatus)).length} dichiarazioni senza esito classificato. Conformità: conformi / (conformi + non conformi); da verificare e non classificati esclusi.</p>`},c);}
function performanceDefinition(c){return chartPanel({id:'oee-readiness',title:'Performance e fattori OEE',description:'Dati necessari per un indicatore di efficacia riconciliabile.',body:`<p class="statistics-plot-note"><strong>OEE non disponibile.</strong> I tempi e le quantità del periodo sono consultabili nei confronti macchina; non equivalgono ai tre fattori OEE.</p><div class="statistics-factor-grid"><div><strong>Disponibilità · —</strong><span>Da definire il tempo produttivo di riferimento e la classificazione di setup, pulizia e fermi.</span></div><div><strong>Performance · —</strong><span>Manca uno standard produttivo convalidato per articolo e macchina. La velocità anagrafica può essere indicativa.</span></div><div><strong>Qualità OEE · —</strong><span>Da concordare il trattamento di scarti e rilavorazioni. La conformità dei controlli è mostrata separatamente.</span></div></div><p class="statistics-plot-note">Disponibilità × performance × qualità: nessuna media arbitraria, target o percentuale dimostrativa. Le definizioni richiedono una decisione del responsabile di produzione.</p>`},c);}
function charts(c){const panels=dashboard==='overview'?[productionChart(c),stopsChart(c),dailyChart(c),attentionChart(c)]:dashboard==='production'?[productionChart(c),productsChart(c),speedsChart(c),traceChart(c)]:dashboard==='quality'?[scrapChart(c),qualityChart(c),attentionChart(c),traceChart(c)]:[hoursChart(c),machineTable(c),dailyChart(c),speedsChart(c),performanceDefinition(c)];return `<div class="statistics-chart-grid" aria-label="Grafici statistici">${panels.join('')}</div>`;}
function summary(c){
 const totals=report.totals,units=totals.quantities.map(q=>q.unit);if(!units.includes(dashboardUnit))dashboardUnit=units[0]??null;
 const q=totals.quantities.find(q=>q.unit===dashboardUnit),conforming=report.details.filter(r=>r.qualityStatus==='conforming').length,nonconforming=report.details.filter(r=>r.qualityStatus==='nonconforming').length,classified=conforming+nonconforming,traced=report.details.filter(r=>traceComplete(executionFor(c,r.taskId))).length;const hasProductLots=traced>0||report.details.some(r=>String(executionFor(c,r.taskId)?.outputLot||'').trim());
 const prev=report.previous,range=prev?`${prev.from} → ${prev.to}`:'',prevQ=prev?.quantities.find(x=>x.unit===dashboardUnit),t=totals;
 const kpi=(label,amount,description,tone,descriptor,change='')=>`<button type="button" class="statistics-kpi ${tone}" ${drillAttrs(descriptor,c)}><span>${label}</span><strong>${amount}</strong>${change}<small>${description}</small><span class="statistics-kpi-open" aria-hidden="true">›</span></button>`;
 const punctuality=t.dueCount?`${t.lateCount} in ritardo su ${t.dueCount}${t.averageLateDays?` · media ${number.format(t.averageLateDays)} gg`:''}${t.withoutDueDateCount?` · ${t.withoutDueDateCount} senza consegna`:''}`:'Data di consegna non indicata';
 return `<section class="statistics-dashboard-summary" aria-label="Riepilogo del periodo">${units.length>1?`<div class="statistics-dashboard-units" role="group" aria-label="Unità dei KPI">${units.map(u=>`<button class="button secondary" data-dashboard-unit="${c.esc(u)}" aria-pressed="${u===dashboardUnit}">${c.esc(c.unitLabel(u))}</button>`).join('')}<span>Quantità separate per unità</span></div>`:''}<div class="statistics-kpis">${kpi('Produzione buona',q?value('goodQuantity',q.goodQuantity,c):'—',c.esc(dashboardUnit?c.unitLabel(dashboardUnit):'Nessuna quantità registrata'),'blue',{analysis:'production',unit:dashboardUnit,title:'Produzione buona'},trend(q?.goodQuantity,prevQ?.goodQuantity,'up','rel',range))}${kpi('Incidenza scarto',q?value('scrapRate',q.scrapRate,c):'—',q?'Scarto '+value('scrapQuantity',q.scrapQuantity,c)+' '+c.esc(c.unitLabel(q.unit)):'Nessuna quantità registrata','red',{analysis:'scrap',unit:dashboardUnit,scrapOnly:true,title:'Consuntivi con scarto'},trend(q?.scrapRate,prevQ?.scrapRate,'down','pts',range))}${kpi('Conformità',classified?percent.format(conforming/classified):'—',classified+' esiti conformi / non conformi','green',{analysis:'quality',classifiedOnly:true,title:'Esiti conformi e non conformi'},classified&&prev?.classifiedCount?trend(conforming/classified,prev.conformingCount/prev.classifiedCount,'up','pts',range):'')}${kpi('Fermi macchina',value('stoppedHours',totals.stoppedHours,c)+' h',totals.stopCount+' fermi · '+totals.openStopCount+' aperti','amber',{kind:'stops',title:'Fermi macchina'},trend(totals.stoppedHours,prev?.stoppedHours,'down','rel',range))}${kpi('Puntualità',t.punctualityRate===null?'—':percent.format(t.punctualityRate),c.esc(punctuality),'cyan',{analysis:'punctuality',dueOnly:true,lateOnly:t.lateCount>0,title:t.lateCount>0?'Consegne in ritardo':'Consegne del periodo'},trend(t.punctualityRate,prev?.punctualityRate,'up','pts',range))}${hasProductLots?kpi('Lotti completi',traced+' / '+report.details.length,'Prodotto + entrambi i componenti','purple',{analysis:'trace',traceStatus:'complete',title:'Dichiarazioni con lotti completi'}):''}</div><div class="metrics statistics-metrics"><div>${drillButton('Consuntivi chiusi',{title:'Consuntivi chiusi nel periodo'},c)}<strong>${number.format(totals.count)}</strong></div><div><span>Ore lavorate</span><strong>${value('actualRunHours',totals.actualRunHours,c)}</strong></div><div><span>Ore di attrezzaggio</span><strong>${value('actualSetupHours',totals.actualSetupHours,c)}</strong></div><div><span>Ore di fermo</span><strong>${value('stoppedHours',totals.stoppedHours,c)}</strong></div></div></section>`;
}
export function statisticsView(c) {
 if(!filters) { const dates=c.state.executions.filter(e=>(e.phase==='completed'||(e.interruptedAt&&e.producedQuantity!=null))&&e.runEndedAt).map(e=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(e.runEndedAt))).sort(); const today=c.localDate(),recent=new Date(Date.parse(today+'T12:00:00Z')-30*864e5).toISOString().slice(0,10);filters={from:dates[0]&&dates[0]>recent?dates[0]:recent,to:today,machineId:'',excludeDemo:false}; }
 const stale=revision!==c.state.revision;
 const ready=report&&!loading&&!stale;
 const totals=ready?report.totals:null;
 const rows=ready?report[selected]||[]:[];
 const pages=Math.max(1,Math.ceil(rows.length/25)); page=Math.min(page,pages-1);
 const columns=tables[selected].columns;
 const visible=rows.slice(page*25,(page+1)*25);
 return `${c.heading('Statistiche di produzione','',`<button class="button primary" id="statistics-export" ${ready?'':'disabled'}>↓ Esporta Excel</button>`)}
 <form id="statistics-filters" class="statistics-filters"><label>Dal<input type="date" name="from" required value="${c.esc(filters.from)}"></label><label>Al<input type="date" name="to" required value="${c.esc(filters.to)}"></label><label>Macchina<select name="machineId" aria-label="Macchina"><option value="">Tutte le macchine</option>${c.state.machines.map(m=>`<option value="${c.esc(m.id)}" ${filters.machineId===m.id?'selected':''}>${c.esc(m.name)}</option>`).join('')}</select></label><label><input type="checkbox" name="excludeDemo" value="true" ${filters.excludeDemo?'checked':''}> Escludi dati demo</label><button class="button secondary" type="submit" ${loading?'disabled':''}>Applica filtri</button></form>
 ${ready&&report.generatedAt?`<p class="statistics-generated" role="status">Dati generati il ${c.esc(new Intl.DateTimeFormat('it-IT',{timeZone:'Europe/Rome',dateStyle:'short',timeStyle:'medium'}).format(new Date(report.generatedAt)))}</p>`:''}
 <details class="statistics-help"><summary>Come leggere i dati</summary><p class="statistics-method">Produzione attribuita alla data di chiusura (ora italiana), comprese le interruzioni con dichiarazione. Quantità sempre separate per unità. Il previsto riguarda solo le lavorazioni chiuse nel periodo, non il carico ordini. ${c.state.setupRules?.length?'L’attrezzaggio previsto applica le regole di sequenza dove definite e usa altrimenti il tempo base della scheda.':'Non sono configurate matrici di sequenza: l’attrezzaggio previsto è il tempo base della scheda.'} OEE, costi e puntualità non sono calcolati senza una base dati dedicata. Scarto % = scarto ÷ (quantità buona + scarto). I fermi comprendono solo la durata nel periodo scelto, inclusi quelli aperti. Le ore giornaliere derivano dagli eventi di avvio, ripresa, pausa e fine, ritagliati per giorno italiano. ${ready?c.esc(report.coverage.message):''}</p></details>
 ${error?`<div class="statistics-error" role="alert">${c.esc(error)} <button id="statistics-retry" class="button secondary">Riprova</button></div>`:''}
 <div class="statistics-dashboard-tabs" role="group" aria-label="Analisi di produzione">${[['overview','Panoramica'],['production','Produzione'],['quality','Qualità e scarti'],['machines','Macchine']].map(([key,label])=>`<button type="button" data-statistics-dashboard="${key}" aria-pressed="${dashboard===key}">${label}</button>`).join('')}</div>
 ${totals?`${summary(c)}${charts(c)}`:`<section class="statistics-chart-loading" aria-busy="${!error}"><p role="status" class="statistics-empty">${error?'I dati non sono disponibili.':'Caricamento statistiche…'}</p></section>`}
 <details id="statisticsTableDetails" class="statistics-table-details" ${tablesOpen?'open':''}><summary id="statisticsTablesToggle">${tablesOpen?'Nascondi tabelle':'Mostra tabelle'}<span>Dettaglio tabellare · 8 viste</span></summary><div class="statistics-table-content">
 <div class="statistics-tabs" aria-label="Raggruppamento statistiche">${Object.entries(tables).map(([key,t])=>`<button class="button ${selected===key?'primary':'secondary'}" data-statistics-tab="${key}" aria-pressed="${selected===key}">${t.label}</button>`).join('')}</div>
 <section class="statistics-results" aria-busy="${!ready&&!error}"><div class="statistics-section-heading"><h2>${tables[selected].label}</h2>${ready?`<span>${number.format(rows.length)} righe · ${c.esc(filters.from)} → ${c.esc(filters.to)}</span>`:''}</div>
 ${!ready?`<p role="status" class="statistics-empty">${error?'I dati non sono disponibili.':'Caricamento statistiche…'}</p>`:`<div class="table-wrap"><table><thead><tr>${columns.map(([,label])=>`<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${visible.map(row=>`<tr>${columns.map(([key],index)=>`<td class="${typeof row[key]==='number'?'statistics-number':''}">${index===0?drillButton(row[key]==null?'—':String(row[key]),descriptorFor(selected,row),c):value(key,row[key],c)}</td>`).join('')}</tr>`).join('')||`<tr><td colspan="${columns.length}" class="statistics-empty">Nessun dato per il periodo e la macchina selezionati.</td></tr>`}</tbody></table></div>${pages>1?`<div class="statistics-pagination"><button class="button secondary" id="statistics-previous" ${page===0?'disabled':''}>← Precedente</button><span>Pagina ${page+1} di ${pages}</span><button class="button secondary" id="statistics-next" ${page===pages-1?'disabled':''}>Successiva →</button></div>`:''}`}
 <p class="statistics-method">L’export comprende tutte le righe filtrate in 9 fogli distinti. “—” indica un dato non disponibile. Lo storico DEMO-STORICO contiene dati simulati ed è ${filters.excludeDemo?'escluso':'incluso'}.</p></section></div></details>`;
}
async function load(c) {
 if(loading)return;
 const token=++request; loading=true;error=''; c.render();
 try { const result=await c.api(`statistics?${new URLSearchParams(filters)}`); if(token!==request)return; report=result;filters={from:result.filters.from,to:result.filters.to,machineId:result.filters.machineId||'',excludeDemo:Boolean(result.filters.excludeDemo)}; revision=c.state.revision; }
 catch(e) { if(token===request)error=e.message; }
 finally { if(token===request){loading=false;if(c.isActive())c.render();} }
}
export function bindStatistics(c) {
 chartAbort?.abort();chartAbort=new AbortController();
 document.addEventListener('keydown',event=>{if(event.key==='Escape')document.querySelectorAll('.statistics-bar-mark:hover,.statistics-bar-mark:focus,.statistics-point:hover,.statistics-point:focus').forEach(mark=>mark.classList.add('tooltip-dismissed'));},{signal:chartAbort.signal});
 document.querySelector('#statistics-filters').onsubmit=e=>{e.preventDefault();const next=Object.fromEntries(new FormData(e.target));next.excludeDemo=next.excludeDemo==='true';if(next.from>next.to){c.toast('La data finale deve seguire quella iniziale.',true);return;} filters=next; report=null;page=0;load(c);};
 document.querySelectorAll('[data-statistics-tab]').forEach(b=>b.onclick=()=>{selected=b.dataset.statisticsTab;page=0;c.render();});
 document.querySelectorAll('[data-statistics-dashboard]').forEach(b=>b.onclick=()=>{dashboard=b.dataset.statisticsDashboard;c.render();});
 document.querySelectorAll('[data-dashboard-unit]').forEach(b=>b.onclick=()=>{dashboardUnit=b.dataset.dashboardUnit;c.render();});
 document.querySelectorAll('[data-statistics-grain]').forEach(b=>b.onclick=()=>{grain=b.dataset.statisticsGrain;c.render();});
 document.querySelectorAll('[data-statistics-detail]').forEach(b=>b.onclick=()=>openStatisticsDetail(c,report,filters,JSON.parse(b.dataset.statisticsDetail)));
 document.querySelectorAll('[data-chart-unit]').forEach(b=>b.onclick=()=>{chartUnits[b.dataset.chartUnit]=b.dataset.unit;c.render();});
 document.querySelectorAll('.statistics-bar-mark,.statistics-point').forEach(mark=>{
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
