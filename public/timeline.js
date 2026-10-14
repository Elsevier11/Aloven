import {taskReference,taskBarReference,dispatchLabel,dispatchTone} from './planning-presentation.js';
import {taskInPeriod} from './planning-insights.js';
import {scheduleTask} from '../scheduler.mjs';
import {can} from '../roles.mjs';
import {effectiveMachineCalendar} from './calendar.js';

const minute=v=>Number(v.slice(0,2))*60+Number(v.slice(3,5));
const clock=v=>`${String(Math.floor(v/60)).padStart(2,'0')}:${String(v%60).padStart(2,'0')}`;
const locked=t=>['in_progress','completed'].includes(t?.status);
const warningFor=(warnings,id)=>warnings?.get?.(id)??warnings?.[id]??'';
let clockTimer,insertionController,timeTipController,touchController,previewTimer,previewContext,currentPreview,currentDragAction,insertionPainter,paintGeneration=0;
function romeTime(){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts().filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));return {date:`${parts.year}-${parts.month}-${parts.day}`,minute:Number(parts.hour)*60+Number(parts.minute)};}
/** Visual only: an activity still running past its planned end is extended up to the current time. */
function overrunBars(tasks,m,d,lo,hi,scale){
 const now=romeTime(),clock=value=>Number(value.slice(0,2))*60+Number(value.slice(3,5));
 return tasks.filter(t=>t.machineId===m.id&&t.status==='in_progress'&&t.end&&t.end.slice(0,10)<=d&&d<=now.date).map(t=>{
  const from=Math.max(lo,t.end.slice(0,10)===d?clock(t.end.slice(11)):lo),to=Math.min(hi,d===now.date?now.minute:hi);
  return to>from?`<div class="overrun-bar" data-overrun="${t.id}" style="left:${(from-lo)*scale}px;width:${(to-from)*scale}px" title="Oltre la fine prevista" aria-hidden="true"></div>`:'';
 }).join('');
}
function updateNowMarkers(){const markers=document.querySelectorAll('[data-now-marker]');if(!markers.length&&clockTimer){clearInterval(clockTimer);clockTimer=undefined;return;}const now=romeTime();for(const marker of markers){const value=now.minute-Number(marker.dataset.lo),limit=Number(marker.dataset.span);marker.hidden=marker.dataset.date!==now.date||value<0||value>limit;if(marker.hidden)continue;marker.style[marker.dataset.orientation]=`${value*Number(marker.dataset.scale)}px`;marker.setAttribute('aria-label',`Ora attuale ${clock(now.minute)}`);}}
const machinePalette=Array.from({length:8},(_,i)=>`var(--mes-machine-${i+1})`);
export function machineColor(state,id){const index=(state.machines||[]).findIndex(m=>m.id===id);return machinePalette[Math.max(0,index)%machinePalette.length];}
export function temporalPlan(c,ms,dates,showCompleted){
 const {state,esc}=c,tasks=state.tasks.filter(t=>t.position!==null&&(showCompleted||t.status!=='completed'));
 const maintenance=state.calendar?.maintenanceBlocks||[];
 const limits=[];for(const block of maintenance.filter(b=>ms.some(m=>m.id===b.machineId))){if(dates.includes(block.start.slice(0,10)))limits.push(minute(block.start.slice(11)));if(dates.includes(block.end.slice(0,10)))limits.push(minute(block.end.slice(11)));}
 for(const m of ms)for(const d of dates){for(const s of (c.baseShifts||c.effectiveShifts)(d,m.id))limits.push(...s.map(minute));for(const t of tasks.filter(t=>t.machineId===m.id))for(const s of t.segments.filter(s=>s.start.slice(0,10)===d))limits.push(minute(s.start.slice(11)),minute(s.end.slice(11)));}
 const lo=limits.length?Math.floor(Math.min(...limits)/60)*60:480,hi=limits.length?Math.max(lo+60,Math.ceil(Math.max(...limits)/60)*60):1080,span=hi-lo,zoom=Number(c.zoom)>0?Number(c.zoom):1;
 const viewport=typeof window==='undefined'?1366:window.innerWidth,available=Math.max(360,viewport-(viewport>800?224+32+280+16:20));
 const scale=Math.max(dates.length===1?360:240,(available-190)/dates.length)/span*zoom;
 const tickStep=scale<.8?120:60,ticks=Array.from({length:Math.floor(span/tickStep)+1},(_,i)=>lo+i*tickStep);
 const marker=d=>`<div class="now-marker" data-now-marker data-date="${d}" data-lo="${lo}" data-span="${span}" data-scale="${scale}" data-orientation="left" hidden><span>Adesso</span></div>`;
 const header=m=>{const stop=(state.machineStops||[]).find(x=>x.machineId===m.id&&!x.endedAt),parts=m.name.split(' · '),count=tasks.filter(t=>t.machineId===m.id).length,here=tasks.filter(t=>t.machineId===m.id&&taskInPeriod(t,dates)).length;return `<div class="temporal-machine" style="--machine-color:${machineColor(state,m.id)}"><strong><i class="machine-color-dot" aria-hidden="true"></i>${esc(parts[0])}</strong>${parts.length>1?`<span class="machine-description">${esc(parts.slice(1).join(' · '))}</span>`:''}<small title="${count} in sequenza in totale">${here} nel periodo${count>here?` · <button type="button" class="outside-sequence" data-outside-sequence="${m.id}">${count-here} fuori</button>`:''}</small>${stop?`<span class="machine-stopped">FERMA · ${esc(stop.reason)}</span><small>Piano da verificare alla ripresa</small>`:''}<div class="machine-tools"><button type="button" class="button secondary direct-sequence" data-sequence="${m.id}" aria-label="Vedi sequenza · ${esc(m.name)}">Sequenza</button><details class="machine-actions"><summary aria-label="Azioni macchina" title="Azioni">⋯</summary><div><button class="button subtle" data-focus-machine="${m.id}" aria-label="Solo questa macchina">Solo questa</button><button class="button ${stop?'primary':'secondary'}" data-machine-stop="${m.id}" data-stop-action="${stop?'resume':'stop'}" aria-label="${stop?'Riattiva macchina':'Ferma macchina'}">${stop?'Riattiva':'Ferma'}</button>${can(state.user.role,'calendar')?`<button class="button subtle" data-maintenance="${m.id}" aria-label="Manutenzione programmata">Manutenzione</button>`:''}</div></details></div></div>`;};
 const maintenanceBands=(m,d)=>maintenance.filter(b=>b.machineId===m.id&&b.start<`${d}T23:59`&&b.end>`${d}T00:00`).map(b=>{
  const start=Math.max(lo,b.start.slice(0,10)===d?minute(b.start.slice(11)):0),end=Math.min(hi,b.end.slice(0,10)===d?minute(b.end.slice(11)):1440);
  if(end<=start)return '';
  const width=(end-start)*scale,full=`${b.name} · ${m.name} · ${c.fmt(b.start)} → ${c.fmt(b.end)}`;
  return `<button type="button" class="timeline-maintenance${width<88?' compact':''}" ${can(state.user.role,'calendar')?`data-maintenance-block="${esc(b.id)}" data-machine="${esc(m.id)}"`:''} style="left:${(start-lo)*scale}px;width:${width}px" aria-label="${esc(full)}"><svg class="maintenance-symbol" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 6a5 5 0 0 0-6 6L3 17a3 3 0 0 0 4 4l5-5a5 5 0 0 0 6-6l-4 4-4-4 4-4Z"/></svg><strong>${esc(b.name)}</strong><span>${clock(start)}–${clock(end)}</span></button>`;
 }).join('');
const cell=(m,d)=>{const bands=c.effectiveShifts(d,m.id).map(([a,b])=>`<div class="working-band" style="left:${(minute(a)-lo)*scale}px;width:${(minute(b)-minute(a))*scale}px"></div>`).join('');const lines=ticks.map(v=>`<div class="time-rule" style="left:${(v-lo)*scale}px"></div>`).join('');const blocks=tasks.filter(t=>t.machineId===m.id).flatMap(t=>t.segments.filter(s=>s.start.slice(0,10)===d).map(s=>{const pixels=(minute(s.end.slice(11))-minute(s.start.slice(11)))*scale,compact=pixels<88,warning=warningFor(c.planWarnings,t.id),phase=s.kind==='setup'?'Attrezzaggio':'Lavorazione',status=c.labels?.[t.status]??t.status,selected=c.selectedTaskId===t.id,fixed=Boolean(t.fixedStart),full=`${m.name} · ${t.title} · ${phase} · ${status} · ${s.start.slice(11)}–${s.end.slice(11)} · ${dispatchLabel(t)} · ${taskReference(t)}${fixed?' · Data fissata':''}${warning?` · Attenzione: ${warning}`:''}`;return `<button type="button" class="time-block ${s.kind} ${t.status}${compact?' compact':''}${warning?' has-warning':''}${selected?' selected':''}${fixed?' fixed-start':''}" data-task="${t.id}" data-machine="${m.id}" data-before="${locked(t)?'':t.id}" data-detail="${t.id}" data-time-tip="${t.id}" data-start="${s.start}" data-end="${s.end}" draggable="${!locked(t)}" style="--machine-color:${machineColor(state,m.id)};left:${(minute(s.start.slice(11))-lo)*scale}px;width:${pixels}px" aria-label="${esc(full)}"${selected?' aria-current="true"':''}><strong class="task-reference">${esc(s.kind==='setup'?'Attr. '+taskBarReference(t):taskBarReference(t))}</strong><span>${s.start.slice(11)}–${s.end.slice(11)} · ${esc(status)}</span><i class="bar-dispatch dispatch-state" data-tone="${dispatchTone(t)}" title="${esc(dispatchLabel(t))}" role="img" aria-label="${esc(dispatchLabel(t))}"></i>${fixed?'<i class="fixed-start-pin" title="Data fissata" role="img" aria-label="Data fissata"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10l-1 6 3 3v2H5v-2l3-3-1-6Zm5 11v7"/></svg></i>':''}${warning?'<i class="plan-warning" aria-hidden="true">!</i>':''}</button>`;})).join('');return `<div class="temporal-cell" data-drop-machine="${m.id}" data-date="${d}" data-lo="${lo}" data-scale="${scale}" style="width:${span*scale}px">${bands}${lines}${marker(d)}${maintenanceBands(m,d)}${blocks}${overrunBars(tasks,m,d,lo,hi,scale)}</div>`;};
 const shown=tasks.some(t=>ms.some(m=>m.id===t.machineId)&&t.segments.some(s=>dates.includes(s.start.slice(0,10))));
 const first=tasks.filter(t=>ms.some(m=>m.id===t.machineId)).flatMap(t=>t.segments.map(s=>s.start.slice(0,10))).sort()[0];
 const empty=!shown?`<div class="timeline-empty-period">Nessuna attività nel periodo selezionato.${first?` <button class="button secondary" data-focus-day="${first}">Vai alle attività pianificate</button>`:''}</div>`:'';
 return `${empty}<section class="temporal gantt-temporal resource-timeline${dates.length===1?' single-day':''}" data-time-scale="${scale}" style="width:${190+dates.length*span*scale}px"><div class="gantt-dates"><div>MACCHINA / SEQUENZA</div>${dates.map(d=>`<button class="day-heading" data-focus-day="${d}" style="width:${span*scale}px">${c.fmt(d+'T00:00').split(',')[0]}<div class="gantt-hours">${ticks.slice(0,-1).map(v=>`<span style="left:${(v-lo)*scale}px">${clock(v)}</span>`).join('')}</div></button>`).join('')}</div>${ms.map(m=>`<div class="gantt-row" data-resource="${m.id}">${header(m)}${dates.map(d=>cell(m,d)).join('')}</div>`).join('')}</section>`;
}
export function clearTimeTips(){clearInterval(clockTimer);clockTimer=undefined;timeTipController?.abort();timeTipController=undefined;document.querySelector('#time-tooltip')?.remove();}
export function bindTimeTips(c){
 clearTimeTips();timeTipController=new AbortController();const {signal}=timeTipController;
 const describe=(element,enabled)=>{const ids=new Set((element.getAttribute('aria-describedby')||'').split(/\s+/).filter(Boolean));enabled?ids.add('time-tooltip'):ids.delete('time-tooltip');if(ids.size)element.setAttribute('aria-describedby',[...ids].join(' '));else element.removeAttribute('aria-describedby');};
 for(const described of document.querySelectorAll('[aria-describedby~="time-tooltip"]'))describe(described,false);
 document.querySelector('#time-tooltip')?.remove();const tip=document.createElement('div');tip.id='time-tooltip';tip.className='time-tooltip';tip.role='tooltip';tip.hidden=true;document.body.append(tip);
 let active,hideTimer,dismissed,dismissedAll=false,pointerX,pointerY,pointerPressed=false;
 const cancelHide=()=>{clearTimeout(hideTimer);hideTimer=undefined;};
 const hide=()=>{cancelHide();tip.hidden=true;if(active)describe(active,false);active=undefined;};
 const scheduleHide=()=>{cancelHide();hideTimer=setTimeout(()=>{if(!tip.matches(':hover')&&!active?.matches(':hover, :focus'))hide();},120);};
 const position=()=>{if(!active||tip.hidden)return;const r=active.getBoundingClientRect(),gap=8,width=tip.offsetWidth,height=tip.offsetHeight;const list=active.closest('.dispatch-backlog,.dispatch-sequence');if(list&&innerWidth>800){const area=list.getBoundingClientRect(),side=list.classList.contains('dispatch-backlog')?area.right+gap:area.left-width-gap;if(side>=gap&&side+width<=innerWidth-gap){tip.style.left=side+'px';tip.style.top=Math.max(gap,Math.min(r.top,innerHeight-height-gap))+'px';return;}}tip.style.left=`${Math.max(gap,Math.min(r.left,innerWidth-width-gap))}px`;const below=r.bottom+gap,above=r.top-height-gap;tip.style.top=`${Math.max(gap,below+height<=innerHeight-gap?below:above)}px`;};
 const show=b=>{if(pointerPressed||dismissedAll||dismissed===b||c.dragTaskId?.())return;const t=c.state.tasks.find(t=>t.id===b.dataset.timeTip);if(!t)return;cancelHide();if(active&&active!==b)describe(active,false);active=b;const warning=warningFor(c.planWarnings,t.id);const reference=taskReference(t),referenceInTitle=t.title.toLowerCase().includes(reference.toLowerCase().replace(/^(ordine|lotto)\s+/,''));tip.innerHTML=`<strong>${referenceInTitle?c.esc(t.title):c.esc(reference)+' · '+c.esc(t.title)}</strong><p>${c.esc(dispatchLabel(t))}</p><p>${c.fmt(t.start)} → ${c.fmt(t.end)}</p><p>Quantità: ${t.quantity==null?'Non indicata':c.esc(new Intl.NumberFormat('it-IT').format(t.quantity)+' '+(c.unitLabel?.(c.state.articles?.find(a=>a.id===t.productArticleId)?.unit||'m')||'m'))}${t.status==='planned'?'':' · '+c.labels[t.status]}</p>${warning?`<p class="tooltip-warning">Attenzione: ${c.esc(warning)}</p>`:''}`;tip.hidden=false;describe(b,true);position();};
 const moveFocus=(b,key)=>{const blocks=[...document.querySelectorAll('[data-time-tip]')].filter(item=>item.dataset.machine===b.dataset.machine&&item.closest('.dispatch-sequence,.backlog,.timeline-scroll')===b.closest('.dispatch-sequence,.backlog,.timeline-scroll')).sort((a,z)=>(a.dataset.start||'').localeCompare(z.dataset.start||''));const unique=blocks.filter((item,index)=>blocks.findIndex(x=>x.dataset.task===item.dataset.task)===index),current=unique.findIndex(item=>item.dataset.task===b.dataset.task);if(current<0||!unique.length)return;const delta=key==='ArrowLeft'||key==='ArrowUp'?-1:1,target=key==='Home'?unique[0]:key==='End'?unique.at(-1):unique[Math.max(0,Math.min(unique.length-1,current+delta))];target?.focus();};
 for(const b of document.querySelectorAll('[data-time-tip]')){
  b.addEventListener('mouseenter',()=>show(b),{signal});b.addEventListener('mouseleave',()=>{if(dismissed===b)dismissed=undefined;scheduleHide();},{signal});
  b.addEventListener('focus',()=>{dismissedAll=false;dismissed=undefined;show(b);},{signal});b.addEventListener('pointermove',()=>{if(tip.hidden&&!dismissedAll)show(b);},{signal});b.addEventListener('blur',()=>{if(dismissed===b)dismissed=undefined;scheduleHide();},{signal});
  b.addEventListener('keydown',event=>{if(event.key==='Escape'){dismissed=b;hide();event.stopPropagation();return;}if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)){event.preventDefault();moveFocus(b,event.key);}},{signal});
  b.addEventListener('click',()=>{dismissedAll=true;dismissed=b;hide();},{signal});b.addEventListener('dragstart',hide,{signal});
 }
 document.addEventListener('pointerdown',()=>{pointerPressed=true;hide();},{signal,capture:true});
 document.addEventListener('pointerup',()=>{pointerPressed=false;},{signal,capture:true});
 document.addEventListener('dragend',()=>{pointerPressed=false;},{signal,capture:true});
 document.addEventListener('dragstart',hide,{signal,capture:true});
 document.addEventListener('pointermove',event=>{const moved=pointerX!==event.clientX||pointerY!==event.clientY;pointerX=event.clientX;pointerY=event.clientY;if(dismissedAll&&moved){dismissedAll=false;dismissed=undefined;}},{signal,capture:true});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!tip.hidden){dismissedAll=true;dismissed=active;hide();event.preventDefault();event.stopPropagation();}},{signal,capture:true});
 tip.addEventListener('mouseenter',cancelHide,{signal});tip.addEventListener('mouseleave',scheduleHide,{signal});window.addEventListener('resize',position,{signal});window.addEventListener('scroll',position,{signal,capture:true});
 signal.addEventListener('abort',()=>{cancelHide();if(active)describe(active,false);tip.remove();},{once:true});
 updateNowMarkers();if(document.querySelector('[data-now-marker]'))clockTimer=setInterval(updateNowMarkers,60000);
}

function previewKey(action){return `${previewContext?.state?.revision??''}|${JSON.stringify(action)}`;}
function previewSegments(preview,action){
 const groups=[],seen=new Set();
 const add=(value,machineId=action.machineId,taskId=action.id)=>{const segments=value?.segments||value?.newSegments||value?.placement?.segments,id=value?.id||value?.taskId||taskId,resource=value?.machineId||value?.placement?.machineId||machineId,key=resource+'|'+id;if(segments?.length&&!seen.has(key)){seen.add(key);groups.push({machineId:resource,taskId:id,segments});}};
 add(preview?.placement);
 for(const value of preview?.placements||preview?.changedTasks||preview?.changes||[])add(value,value.machineId,value.id||value.taskId);
 return groups;
}
function removePreviewFootprints(){document.querySelectorAll('.drag-preview-footprint').forEach(element=>element.remove());}
function drawPreviewFootprints(preview,action){
 const existing=[...document.querySelectorAll('.drag-preview-footprint')];let index=0;
 for(const group of previewSegments(preview,action))for(const segment of group.segments||[]){
  for(const cell of document.querySelectorAll(`[data-drop-machine="${CSS.escape(group.machineId||action.machineId)}"]`)){
   const date=cell.dataset.date,dayStart=`${date}T00:00`,dayEnd=`${date}T24:00`,start=segment.start>dayStart?segment.start:dayStart,end=segment.end<dayEnd?segment.end:dayEnd;if(end<=start)continue;
   const startMinute=start===dayStart?0:minute(start.slice(11)),endMinute=end===dayEnd?1440:minute(end.slice(11)),left=(startMinute-Number(cell.dataset.lo))*Number(cell.dataset.scale),width=(endMinute-startMinute)*Number(cell.dataset.scale);
   const footprint=existing[index++]||document.createElement('div');footprint.className=`drag-preview-footprint ${segment.kind==='setup'?'setup':'run'}`;footprint.dataset.previewTask=group.taskId||action.id;footprint.style.left=`${left}px`;footprint.style.width=`${Math.max(2,width)}px`;footprint.setAttribute('aria-hidden','true');if(footprint.parentElement!==cell)cell.append(footprint);
  }
 }
 for(const footprint of existing.slice(index))footprint.remove();
}
function setHintState(entry,state,message){
 if(currentDragAction?.key!==entry.key||!entry.hint?.isConnected)return;
 entry.hint.classList.toggle('invalid',state==='invalid');entry.hint.classList.toggle('checking',state==='checking');entry.hint.querySelector('span').textContent=message;
 for(const footprint of document.querySelectorAll('.drag-preview-footprint'))footprint.dataset.validity=state;
 entry.cell.dataset.insertionInvalid=state==='invalid'?'true':'false';entry.cell.dataset.insertionError=state==='invalid'?message:'';
 positionHintLabel(entry.hint);
}
function positionHintLabel(hint){const label=hint.querySelector('span'),viewport=hint.closest('.timeline-scroll')?.getBoundingClientRect();if(!label||!viewport)return;label.style.left='7px';label.style.right='auto';label.style.maxWidth=`${Math.max(120,viewport.width-16)}px`;const anchor=hint.getBoundingClientRect(),width=label.offsetWidth,left=Math.max(viewport.left+8,Math.min(anchor.left+7,viewport.right-width-8));label.style.left=`${left-anchor.left}px`;}
function showResolvedPreview(entry,preview){drawPreviewFootprints(preview,entry.action);const placement=preview?.placement||{},segments=previewSegments(preview,entry.action).flatMap(group=>group.segments),start=placement.start||entry.action.fixedStart,end=placement.end||segments.at(-1)?.end;setHintState(entry,'ready',start&&end?`${previewContext.fmt(start)} → ${previewContext.fmt(end)} · ${segments.length} ${segments.length===1?'fascia':'fasce'}`:'Posizione verificata');}
function startPreview(entry){
 clearTimeout(previewTimer);previewTimer=undefined;
 if(currentPreview?.key===entry.key&&currentPreview.promise){const generation=++paintGeneration;currentPreview.promise.then(preview=>{if(generation===paintGeneration&&currentDragAction?.key===entry.key)showResolvedPreview(entry,preview);}).catch(error=>{if(generation===paintGeneration&&currentDragAction?.key===entry.key)setHintState(entry,'invalid',error?.message||'Posizione non disponibile');});return currentPreview.promise;}
 const generation=++paintGeneration;
 const promise=Promise.resolve().then(()=>previewContext.previewPlacement(entry.action)).then(preview=>{
  if(currentPreview?.key===entry.key){currentPreview.result=preview;currentPreview.error=undefined;}
  if(generation===paintGeneration&&currentDragAction?.key===entry.key)showResolvedPreview(entry,preview);
  return preview;
 }).catch(error=>{if(currentPreview?.key===entry.key)currentPreview.error=error;if(generation===paintGeneration&&currentDragAction?.key===entry.key)setHintState(entry,'invalid',error?.message||'Posizione non disponibile');throw error;});
 currentPreview={key:entry.key,action:entry.action,promise,result:undefined,error:undefined};promise.catch(()=>{});return promise;
}
export function resolveDragPreview(action){
 if(!previewContext?.previewPlacement)return Promise.reject(new Error('Anteprima di posizionamento non disponibile.'));
 const key=previewKey(action);if(currentDragAction?.key===key&&currentDragAction.error)return Promise.reject(new Error(currentDragAction.error));if(currentPreview?.key===key){clearTimeout(previewTimer);previewTimer=undefined;if(currentPreview.error)return Promise.reject(currentPreview.error);return currentPreview.promise;}
 const entry=currentDragAction?.key===key?currentDragAction:{key,action};return startPreview(entry);
}
export function clearDragPreview(){clearTimeout(previewTimer);previewTimer=undefined;paintGeneration++;currentPreview=undefined;currentDragAction=undefined;removePreviewFootprints();}
export function clearInsertionHints(){paintGeneration++;currentDragAction=undefined;removePreviewFootprints();for(const cell of document.querySelectorAll('[data-drop-machine]')){delete cell.dataset.insertionBefore;delete cell.dataset.insertionInvalid;delete cell.dataset.insertionError;delete cell.dataset.insertionPreviewKey;cell.classList.remove('show-drag-hint-overflow');cell.querySelector('.insertion-hint')?.remove();}}

export function timelineDropStart(cell,clientX,grabOffsetMinutes=0){
 const raw=Number(cell.dataset.lo)+(clientX-cell.getBoundingClientRect().left)/Number(cell.dataset.scale)-Number(grabOffsetMinutes||0);
 const midnight=Date.parse(`${cell.dataset.date}T00:00:00Z`),snapped=Math.round(raw/15)*15;
 return new Date(midnight+snapped*60000).toISOString().slice(0,16);
}

// Resolve against the whole queue, including tasks on days outside the viewport.
export function timelineInsertionBefore(tasks,machineId,dragId,date,atMinute){
 const queue=tasks.filter(t=>t.machineId===machineId&&t.position!==null&&t.id!==dragId).sort((a,b)=>a.position-b.position);
 for(const task of queue){
  const segments=(task.segments||[]).filter(s=>s.start.slice(0,10)===date);
  if(segments.length){
   const start=Math.min(...segments.map(s=>minute(s.start.slice(11)))),end=Math.max(...segments.map(s=>minute(s.end.slice(11))));
   if(atMinute<(start+end)/2)return task.id;
  }else if(task.start?.slice(0,10)>date)return task.id;
 }
 return '';
}

export function bindInsertionHints(c){
 insertionController?.abort();insertionController=new AbortController();const {signal}=insertionController;clearInsertionHints();clearDragPreview();previewContext=c;
 const calendars=new Map();let lastPointer,geometryFrame;
 const localPreview=(task,action)=>{
  if(!action.fixedStart)return;
  try{
   if(!calendars.has(action.machineId))calendars.set(action.machineId,effectiveMachineCalendar(c.state.calendar,action.machineId));
   return {placement:scheduleTask({...task,machineId:action.machineId,setupMinutes:task.effectiveSetupMinutes??task.setupMinutes},action.fixedStart,calendars.get(action.machineId))};
  }catch{
   // Keep a visible estimate even when an indivisible setup cannot fit.
   const start=Date.parse(action.fixedStart+'Z'),duration=(task.effectiveSetupMinutes??task.setupMinutes??0)+(task.runMinutes||0);
   return {placement:{id:task.id,machineId:action.machineId,segments:[{kind:'run',start:action.fixedStart,end:new Date(start+duration*60000).toISOString().slice(0,16)}]}};
  }
 };
 const dragId=event=>c.dragTaskId?.()||event.dataTransfer?.getData('text/plain')||'';
 const paint=(cell,event,explicitTaskId)=>{
  const taskId=explicitTaskId||dragId(event),dragTask=c.state.tasks.find(t=>t.id===taskId);if(!taskId||!dragTask)return;
  lastPointer={clientX:event.clientX,clientY:event.clientY,taskId};
  const horizontal=cell.closest('.gantt-temporal')!==null,axis=horizontal?event.clientX:event.clientY;
  const blocks=[...cell.querySelectorAll('[data-task]')].filter(b=>b.dataset.task!==taskId);
  let beforeId='',position=0,fixedStart='',outsideShift=false;
  if(horizontal){
   fixedStart=timelineDropStart(cell,event.clientX,c.dragGrabOffsetMinutes?.()||0);const atMinute=minute(fixedStart.slice(11)),fixedDate=fixedStart.slice(0,10);
   position=(Date.parse(fixedStart+'Z')-Date.parse(cell.dataset.date+'T00:00Z'))/60000*Number(cell.dataset.scale)-Number(cell.dataset.lo)*Number(cell.dataset.scale);
   const shifts=c.effectiveShifts(fixedDate,cell.dataset.dropMachine);
   outsideShift=!shifts.some(([a,b])=>atMinute>=minute(a)&&atMinute<minute(b));
  }else{
   const candidate=blocks.find(b=>{const r=b.getBoundingClientRect();return axis<r.top+r.height/2;});
   beforeId=candidate?.dataset.task||'';position=candidate?.offsetTop??cell.scrollHeight;
   if(!candidate&&blocks.length){const queue=c.state.tasks.filter(t=>t.machineId===cell.dataset.dropMachine&&t.position!==null&&t.id!==taskId).sort((a,b)=>a.position-b.position),last=blocks.at(-1).dataset.task;beforeId=queue[queue.findIndex(t=>t.id===last)+1]?.id||'';}
  }
  const before=c.state.tasks.find(t=>t.id===beforeId),compatible=dragTask.compatibleMachineIds?.length?dragTask.compatibleMachineIds:[dragTask.machineId];
  const error=!compatible.includes(cell.dataset.dropMachine)?'Macchina non compatibile':outsideShift?'Orario fuori turno':locked(before)?'Posizione bloccata':'';
  const action={kind:'plan',id:taskId,machineId:cell.dataset.dropMachine,...(horizontal?{fixedStart,shiftFollowing:true}:{beforeId})};
  const key=previewKey(action),invalid=Boolean(error);
  if(cell.dataset.insertionPreviewKey===key&&currentDragAction?.key===key){positionHintLabel(currentDragAction.hint);return;}
  for(const other of document.querySelectorAll('[data-drop-machine]'))if(other!==cell){other.querySelector('.insertion-hint')?.remove();other.classList.remove('show-drag-hint-overflow');delete other.dataset.insertionPreviewKey;}
  cell.dataset.insertionBefore=beforeId;cell.dataset.insertionInvalid=invalid?'true':'false';cell.dataset.insertionError=error;
  let hint=cell.querySelector('.insertion-hint');if(!hint){hint=document.createElement('div');hint.className='insertion-hint';hint.innerHTML='<span></span>';cell.append(hint);}cell.classList.add('show-drag-hint-overflow');
  hint.classList.toggle('invalid',invalid);hint.classList.toggle('gantt-hint',horizontal);hint.classList.toggle('tail-hint',!before);
  hint.style[horizontal?'left':'top']=`${Math.max(0,position)}px`;
  cell.dataset.insertionPreviewKey=key;
  clearTimeout(previewTimer);paintGeneration++;currentDragAction={key,action,cell,hint,error};
  const estimate=horizontal?localPreview(dragTask,action):null;
  if(estimate)drawPreviewFootprints(estimate,action);else removePreviewFootprints();
  if(invalid){setHintState(currentDragAction,'invalid',error);return;}
  setHintState(currentDragAction,'checking',fixedStart?`${c.fmt(fixedStart)} · Anteprima stimata, in verifica…`:'Verifica posizione…');
  previewTimer=setTimeout(()=>{if(currentDragAction?.key===key)startPreview(currentDragAction);},180);
 };
 for(const cell of document.querySelectorAll('[data-drop-machine]')){cell.addEventListener('dragover',event=>paint(cell,event),{signal});cell.addEventListener('dragleave',event=>{if(!cell.contains(event.relatedTarget))clearInsertionHints();},{signal});cell.addEventListener('drop',()=>queueMicrotask(clearInsertionHints),{signal});}
 // Some native drags over another draggable button omit dragover on its cell.
 const paintNativePointer=event=>{const taskId=c.dragTaskId?.();if(!taskId||(!event.clientX&&!event.clientY))return;const cell=document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-drop-machine]');if(cell)paint(cell,event,taskId);};
 document.addEventListener('drag',paintNativePointer,{signal,capture:true});document.addEventListener('dragenter',paintNativePointer,{signal,capture:true});
 const refreshGeometry=()=>{if(!lastPointer||!c.dragTaskId?.()||geometryFrame)return;geometryFrame=requestAnimationFrame(()=>{geometryFrame=undefined;if(!lastPointer||!c.dragTaskId?.())return;const cell=document.elementFromPoint(lastPointer.clientX,lastPointer.clientY)?.closest('[data-drop-machine]');if(cell)paint(cell,lastPointer,lastPointer.taskId);else clearInsertionHints();});};
 window.addEventListener('resize',refreshGeometry,{signal});document.addEventListener('scroll',refreshGeometry,{signal,capture:true});
 document.addEventListener('dragend',()=>{lastPointer=undefined;clearInsertionHints();clearDragPreview();},{signal});
 signal.addEventListener('abort',()=>{cancelAnimationFrame(geometryFrame);lastPointer=undefined;clearInsertionHints();clearDragPreview();},{once:true});
 insertionPainter=paint;
}

export function bindTouchTimelineDrag(c){
 touchController?.abort();touchController=new AbortController();const {signal}=touchController;let pending,active,holdTimer,suppressClick=false,ending=false;
 const finish=()=>{clearTimeout(holdTimer);holdTimer=undefined;const gesture=active;active=undefined;pending=undefined;gesture?.source.classList.remove('dragging');gesture?.ghost.remove();if(gesture){if(gesture.source.hasPointerCapture?.(gesture.pointerId))gesture.source.releasePointerCapture(gesture.pointerId);c.setDragState?.(null,0);}document.querySelectorAll('.drop-hover').forEach(element=>element.classList.remove('drop-hover'));};
 const cancel=()=>{if(active)suppressClick=true;finish();clearInsertionHints();clearDragPreview();};
 const move=event=>{const target=document.elementFromPoint(event.clientX,event.clientY),cell=target?.closest?.('[data-drop-machine]');active.ghost.hidden=Boolean(cell);active.ghost.style.left=`${event.clientX+12}px`;active.ghost.style.top=`${event.clientY+12}px`;document.querySelectorAll('[data-drop-machine]').forEach(element=>element.classList.toggle('drop-hover',element===cell));if(cell)insertionPainter?.(cell,event,active.id);else clearInsertionHints();};
 document.addEventListener('pointerdown',()=>{suppressClick=false;},{signal,capture:true});
 for(const source of document.querySelectorAll('[draggable="true"][data-task]'))source.addEventListener('pointerdown',event=>{
  if(!['touch','pen'].includes(event.pointerType)||event.button!==0||ending||pending||active||c.canDrag?.()===false)return;const task=c.state.tasks.find(task=>task.id===source.dataset.task);if(!task||locked(task))return;
  pending={source,id:source.dataset.task,pointerId:event.pointerId,x:event.clientX,y:event.clientY};
  holdTimer=setTimeout(()=>{if(!pending)return;const cell=source.closest('.temporal-cell');let offset=0;if(cell&&task.start&&source.dataset.start){const start=Date.parse(task.start+'Z'),segmentStart=Date.parse(source.dataset.start+'Z'),point=segmentStart+(pending.x-source.getBoundingClientRect().left)/Number(cell.dataset.scale)*60000;if(Number.isFinite(start)&&Number.isFinite(point))offset=(point-start)/60000;}const ghost=document.createElement('div');ghost.className='touch-drag-ghost';ghost.textContent=task.title;ghost.setAttribute('aria-hidden','true');document.body.append(ghost);active={...pending,offset,ghost};source.classList.add('dragging');source.setPointerCapture?.(event.pointerId);c.setDragState?.(active.id,offset);move({clientX:pending.x,clientY:pending.y});},260);
 },{signal});
 document.addEventListener('pointermove',event=>{
  if(pending&&!active){if(event.pointerId!==pending.pointerId)return;const dx=event.clientX-pending.x,dy=event.clientY-pending.y;if(Math.hypot(dx,dy)>9){clearTimeout(holdTimer);pending=undefined;}return;}
  if(!active||event.pointerId!==active.pointerId)return;event.preventDefault();if(Math.hypot(event.clientX-active.x,event.clientY-active.y)>3)active.moved=true;move(event);
 },{signal,capture:true});
 document.addEventListener('pointerup',async event=>{
  if(event.pointerId!==active?.pointerId&&event.pointerId!==pending?.pointerId)return;
  clearTimeout(holdTimer);if(!active){pending=undefined;return;}event.preventDefault();suppressClick=true;move(event);const action=active.moved?currentDragAction?.action:undefined;ending=true;finish();try{if(action)await c.onTouchDrop?.(action);}catch(error){c.toast?.(error?.message||'Posizione non disponibile',true);}finally{ending=false;clearInsertionHints();clearDragPreview();}
 },{signal,capture:true});
 document.addEventListener('pointercancel',event=>{if(event.pointerId===active?.pointerId||event.pointerId===pending?.pointerId)cancel();},{signal,capture:true});document.addEventListener('click',event=>{if(suppressClick){event.preventDefault();event.stopImmediatePropagation();suppressClick=false;}},{signal,capture:true});signal.addEventListener('abort',cancel,{once:true});
 document.addEventListener('touchmove',event=>{if(active)event.preventDefault();},{signal,capture:true,passive:false});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&(active||pending)){event.preventDefault();cancel();}},{signal});
 window.addEventListener('blur',cancel,{signal});
}
