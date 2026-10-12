import {taskReference,dispatchLabel,dispatchTone} from './planning-presentation.js';

const locked = t => ['in_progress','completed'].includes(t.status);
export function placementChoices(tasks, task, mode) {
  const sequence=tasks.filter(t=>t.machineId===task.machineId&&t.position!==null&&t.id!==task.id).sort((a,b)=>a.position-b.position);
  const boundary=sequence.findLastIndex(locked);
  return mode==='after'?sequence.slice(Math.max(0,boundary)):sequence.slice(boundary+1);
}
export function placementAction(tasks,id,mode,targetId,fixedStart,machineId) {
  const original=tasks.find(t=>t.id===id),task=original?{...original,machineId:machineId||original.machineId}:null;
  if(!task||!['planned','unplanned'].includes(task.status))throw new Error('Questa attività non può essere spostata.');
  if(mode==='date'||mode==='cascade'){if(!fixedStart)throw new Error('Scegli data e ora di inizio.');return {kind:'plan',id,machineId:task.machineId,fixedStart,...(mode==='cascade'?{shiftFollowing:true}:{})};}
  if(!['end','before','after'].includes(mode))throw new Error('Seleziona una posizione valida.');
  const sequence=tasks.filter(t=>t.machineId===task.machineId&&t.position!==null&&t.id!==id).sort((a,b)=>a.position-b.position);
  let beforeId='';
  if(mode!=='end') {
    if(!placementChoices(tasks,task,mode).some(t=>t.id===targetId))throw new Error('La posizione non è disponibile. Scegli dopo le attività bloccate.');
    const index=sequence.findIndex(t=>t.id===targetId);
    beforeId=mode==='before'?targetId:(sequence[index+1]?.id||'');
  }
  const current=tasks.filter(t=>t.machineId===task.machineId&&t.position!==null).sort((a,b)=>a.position-b.position);
  const next=current[current.findIndex(t=>t.id===id)+1]?.id||'';
  if(task.machineId===original.machineId&&task.status==='planned'&&!task.fixedStart&&next===beforeId)return null;
  return {kind:'plan',id,beforeId,...(task.machineId!==original.machineId?{machineId:task.machineId}:{})};
}
function compatibleMachines(c,t) {
  const ids=Array.isArray(t.compatibleMachineIds)&&t.compatibleMachineIds.length?t.compatibleMachineIds:[t.machineId];
  const machines=c.state.machines.filter(machine=>ids.includes(machine.id));
  if(!machines.length&&t.machineId){const current=c.machine(t.machineId);if(current)machines.push(current);}
  return machines;
}
function dueDateLabel(value) {
  if(!value)return '';
  const date=new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime())?value:new Intl.DateTimeFormat('it-IT',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}).format(date);
}
function placementHelp(mode) {
  const messages={end:'Aggiunge l’attività in fondo alla sequenza della macchina.',before:'Inserisce l’attività subito prima di quella scelta e ricalcola la sequenza.',after:'Inserisce l’attività subito dopo quella scelta e ricalcola la sequenza.',date:'Fissa l’inizio di questa attività. Le altre attività restano al loro posto.',cascade:'Fissa l’inizio e ricalcola le attività successive, rispettando date fissate e attività avviate.'};
  return (messages[mode]||messages.end)+(['date','cascade'].includes(mode)?' Il trascinamento usa scatti di 15 minuti; qui puoi indicare data e ora al minuto.':'');
}
function submitLabel(task,mode) {
  if(mode==='date')return 'Salva nella bozza';
  if(mode==='cascade')return 'Anteprima coda';
  return task.status==='unplanned'?'Anteprima pianificazione':'Anteprima spostamento';
}
export function planningSelection(c) {
  const t=c.state.tasks.find(t=>t.id===c.selectedTaskId);
  if(!t)return '';
  const choices=placementChoices(c.state.tasks,t,'before'),warning=c.warnings.get(t.id);
  const unit=c.unitLabel(c.state.articles.find(a=>a.id===t.productArticleId)?.unit||'m');
  const quantity=t.quantity==null?'Non indicata':`${new Intl.NumberFormat('it-IT').format(t.quantity)} ${unit}`;
  const machines=compatibleMachines(c,t);
  const machineField=machines.length===1?`<div class="selection-destination" role="group" aria-label="Macchina di destinazione"><span>Macchina di destinazione</span><strong>${c.esc(machines[0].name)}</strong><input type="hidden" name="machineId" value="${c.esc(machines[0].id)}"></div>`:`<label>Macchina di destinazione<select name="machineId" aria-label="Macchina di destinazione">${machines.map(m=>`<option value="${c.esc(m.id)}" ${m.id===t.machineId?'selected':''}>${c.esc(m.name)}</option>`).join('')}</select></label>`;
  const titleFacts=[t.quantity!=null?`Quantità ${quantity}`:'',t.dueDate?`Consegna ${dueDateLabel(t.dueDate)}`:''].filter(Boolean);
  return `<div class="selection-heading"><h2 id="selection-heading" tabindex="-1">Attività selezionata</h2><button class="icon-button" id="clear-planning-selection" aria-label="Chiudi riepilogo attività">×</button></div><div class="selection-body">
  <div class="selection-information"><div class="selection-states">${c.badge(t.status)}<span class="dispatch-state dispatch-tone" data-tone="${c.esc(dispatchTone(t))}">${c.esc(dispatchLabel(t))}</span></div><h3>${c.esc(t.title)}</h3>${titleFacts.length?`<p class="selection-title-facts">${titleFacts.map(value=>c.esc(value)).join(' · ')}</p>`:''}<p class="selection-reference"><span>Riferimento operativo</span><strong>${c.esc(taskReference(t))}</strong></p><p class="selection-machine">${c.esc(c.machine(t.machineId)?.name)}</p><p>${c.esc(c.type(t.typeId)?.name)}</p>${t.fixedStart?'<p class="planning-pin">Data fissata: conserva questo inizio finché non la rimuovi. <button type="button" class="button subtle" id="selection-unpin" aria-label="Rimuovi data fissata">Rimuovi</button></p>':''}
  ${['planned','unplanned'].includes(t.status)?`<form id="selection-placement"><h3>${t.status==='unplanned'?'Posiziona attività':'Modifica la posizione'}</h3>${machineField}<label>Posizione<select name="mode" aria-label="Inserisci attività"><optgroup label="Sequenza"><option value="end">In coda</option><option value="before" ${choices.length?'':'disabled'}>Prima</option><option value="after">Dopo</option></optgroup><optgroup label="Data"><option value="date" ${t.fixedStart?'selected':''}>Data precisa</option><option value="cascade">Data precisa e sposta successive</option></optgroup></select></label><label id="selection-reference-label" hidden>Attività di riferimento<select name="targetId" aria-label="Attività di riferimento"></select></label><label id="selection-start-label" hidden>Data e ora di inizio<input type="datetime-local" name="fixedStart" aria-label="Data e ora di inizio" value="${c.esc(t.fixedStart||t.start||(c.dateStart||'')+'T08:00')}" step="60"></label><p class="selection-help" id="selection-placement-help"></p><button type="submit" class="button primary">${submitLabel(t,t.fixedStart?'date':'end')}</button></form>`:`<p class="selection-help">${locked(t)?'Attività bloccata: puoi consultarla, ma non spostarla.':'Attività annullata: usa la scheda completa per ripristinarla.'}</p>`}
  ${warning?`<p class="selection-warning" role="status">${c.esc(warning)}</p>`:''}
  <dl class="selection-facts"><div><dt>Prodotto</dt><dd>${c.esc(t.productCode||'Non indicato')}</dd></div><div><dt>Quantità prevista</dt><dd>${c.esc(quantity)}</dd></div><div><dt>Attrezzaggio</dt><dd>${c.mins(t.effectiveSetupMinutes??t.setupMinutes)}</dd></div><div><dt>Lavorazione</dt><dd>${c.mins(t.runMinutes)}</dd></div><div><dt>Inizio previsto</dt><dd>${c.fmt(t.start)}</dd></div><div><dt>Fine prevista</dt><dd>${t.end?c.fmt(t.end):'Non pianificata'}</dd></div></dl>
  <details class="selection-materials"><summary>Componenti e descrizioni</summary>${c.materialDetails(t)}</details></div>
  <div class="selection-actions"><button class="button secondary" id="selection-details">Scheda completa</button>${t.start?'<button class="button secondary" id="selection-focus">Mostra giorno e macchina</button>':''}${t.status==='planned'?'<div class="selection-unplan"><button class="button subtle" id="selection-unplan">Togli dal piano</button><p>La rimozione arriva al reparto solo con il prossimo invio del piano; l’attività torna tra quelle da pianificare.</p></div>':''}</div></div>`;
}
export function bindPlanningSelection(c) {
  const root=document.querySelector('#planning-selection');
  root.onkeydown=e=>{if(e.key==='Escape'&&!e.target.matches('select')){e.preventDefault();c.clear();}};
  root.querySelector('#clear-planning-selection')?.addEventListener('click',c.clear);
  root.querySelector('#selection-details')?.addEventListener('click',()=>c.taskDetails(c.selectedTaskId));
  root.querySelector('#selection-focus')?.addEventListener('click',c.focusTask);
  root.querySelector('#selection-unpin')?.addEventListener('click',async()=>{const task=c.state.tasks.find(t=>t.id===c.selectedTaskId),queue=c.state.tasks.filter(t=>t.machineId===task.machineId&&t.position!==null).sort((a,b)=>a.position-b.position),next=queue[queue.findIndex(t=>t.id===task.id)+1];try{await c.mutate({kind:'plan',id:task.id,beforeId:next?.id||''},true);}catch(error){c.toast(error.message,true);}});
  root.querySelector('#selection-unplan')?.addEventListener('click',async()=>{try{await c.mutate({kind:'plan',id:c.selectedTaskId,unplan:true},true);}catch(e){c.toast(e.message,true);}});
  const form=root.querySelector('#selection-placement');if(!form)return;
  const task=c.state.tasks.find(t=>t.id===c.selectedTaskId),label=root.querySelector('#selection-reference-label'),help=root.querySelector('#selection-placement-help');
  const update=()=>{const destination={...task,machineId:form.elements.machineId.value};for(const optionMode of ['before','after'])form.elements.mode.querySelector(`[value="${optionMode}"]`).disabled=!placementChoices(c.state.tasks,destination,optionMode).length;if(['before','after'].includes(form.elements.mode.value)&&form.elements.mode.selectedOptions[0].disabled)form.elements.mode.value='end';const mode=form.elements.mode.value,dateMode=mode==='date'||mode==='cascade';label.hidden=mode==='end'||dateMode;const dateLabel=root.querySelector('#selection-start-label');dateLabel.hidden=!dateMode;form.elements.fixedStart.required=dateMode;help.textContent=placementHelp(mode);const button=form.querySelector('[type=submit]');button.textContent=submitLabel(task,mode);const choices=placementChoices(c.state.tasks,destination,mode);form.elements.targetId.innerHTML=choices.map(t=>`<option value="${c.esc(t.id)}">${c.esc(t.title)}${locked(t)?' · bloccata':''}</option>`).join('');form.elements.targetId.required=mode==='before'||mode==='after';};
  if(!placementChoices(c.state.tasks,task,'after').length)form.elements.mode.querySelector('[value="after"]').disabled=true;
  form.elements.mode.onchange=update;form.elements.machineId.onchange=update;update();
  form.onsubmit=async e=>{e.preventDefault();const b=form.querySelector('[type="submit"]');b.disabled=true;try{const action=placementAction(c.state.tasks,c.selectedTaskId,form.elements.mode.value,form.elements.targetId.value,form.elements.fixedStart.value,form.elements.machineId.value);if(action)await c.mutate(action,form.elements.mode.value!=='date',form.elements.mode.value==='date');else c.toast('L’attività è già in questa posizione.');}catch(err){c.toast(err.message,true);}finally{if(b.isConnected)b.disabled=false;}};
}
