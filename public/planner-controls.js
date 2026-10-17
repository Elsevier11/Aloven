import {taskReference,dispatchLabel,dispatchTone,dueDelayDays} from './planning-presentation.js';

const locked = t => ['in_progress','completed'].includes(t.status);
export function placementChoices(tasks, task, mode) {
  const sequence=tasks.filter(t=>t.machineId===task.machineId&&t.position!==null&&t.id!==task.id).sort((a,b)=>a.position-b.position);
  const boundary=sequence.findLastIndex(locked);
  return mode==='after'?sequence.slice(Math.max(0,boundary)):sequence.slice(boundary+1);
}
export function placementAction(tasks,id,mode,targetId,machineId) {
  const original=tasks.find(t=>t.id===id),task=original?{...original,machineId:machineId||original.machineId}:null;
  if(!task||!['planned','unplanned'].includes(task.status))throw new Error('Questa attività non può essere spostata.');
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
/** Setup the machine's rules would give this activity in its current sequence position (same rule as the server). */
export function theoreticalSetup(state,task) {
  const queue=state.tasks.filter(t=>t.machineId===task.machineId&&t.position!==null).sort((a,b)=>a.position-b.position),index=queue.findIndex(t=>t.id===task.id);
  if(index>0){
    const rule=(state.setupRules||[]).find(item=>item.machineId===task.machineId&&item.fromTypeId===queue[index-1].typeId&&item.toTypeId===task.typeId);
    if(rule)return rule.minutes;
  }
  return task.setupMinutes;
}
/** Action for a manual setup time; null when it matches what is stored. A value equal to the theoretical one clears the override. */
export function setupOverrideAction(state,task,minutes) {
  if(!Number.isInteger(minutes)||minutes<0)throw new Error('Inserisci minuti interi, zero o più.');
  const theory=theoreticalSetup(state,task),next=minutes===theory?null:minutes;
  if((task.setupOverrideMinutes??null)===next)return null;
  return {kind:'setupOverride',id:task.id,minutes:next};
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
  const messages={end:'Aggiunge l’attività in fondo alla sequenza della macchina.',before:'Inserisce l’attività subito prima di quella scelta e ricalcola la sequenza.',after:'Inserisce l’attività subito dopo quella scelta e ricalcola la sequenza.'};
  return messages[mode]||messages.end;
}
function submitLabel(task,mode) {
  return task.status==='unplanned'?'Anteprima pianificazione':'Anteprima spostamento';
}
const placementHint = mode => ({end: 'In fondo alla sequenza.', before: 'Prima dell’attività scelta.', after: 'Dopo l’attività scelta.'}[mode] || '');
export function planningSelection(c) {
  const t=c.state.tasks.find(t=>t.id===c.selectedTaskId);
  if(!t)return '';
  const choices=placementChoices(c.state.tasks,t,'before'),warning=c.warnings.get(t.id);
  const unit=c.unitLabel(c.state.articles.find(a=>a.id===t.productArticleId)?.unit||'m');
  const quantity=t.quantity==null?'Non indicata':`${new Intl.NumberFormat('it-IT').format(t.quantity)} ${unit}`;
  const machines=compatibleMachines(c,t),canPlace=['planned','unplanned'].includes(t.status);
  const currentMachine=c.machine(t.machineId)?.name||'';
  const single=canPlace&&machines.length===1;
  // With one compatible machine the destination is part of the subtitle; the hidden field still belongs to the placement form.
  const subtitle=single?`<p class="selection-destination" role="group" aria-label="Macchina di destinazione"><strong>${c.esc(machines[0].name)}</strong> · ${c.esc(c.type(t.typeId)?.name)}<input type="hidden" name="machineId" value="${c.esc(machines[0].id)}" form="selection-placement"></p>`:`<p class="selection-machine"><strong>${c.esc(currentMachine)}</strong> · ${c.esc(c.type(t.typeId)?.name)}</p>`;
  const machineField=single?'':`<label>Macchina di destinazione<select name="machineId" aria-label="Macchina di destinazione">${machines.map(m=>`<option value="${c.esc(m.id)}" ${m.id===t.machineId?'selected':''}>${c.esc(m.name)}</option>`).join('')}</select></label>`;
  const titleFacts=[t.dueDate?`Consegna ${dueDateLabel(t.dueDate)}`:'',dueDelayDays(t)>0?`Finisce ${dueDelayDays(t)} ${dueDelayDays(t)===1?'giorno':'giorni'} dopo la consegna`:''].filter(Boolean);
  const reference=taskReference(t),referenceInTitle=t.title.toLowerCase().includes(reference.toLowerCase().replace(/^(ordine|lotto)\s+/,''));
  const setup=`${c.mins(t.effectiveSetupMinutes??t.setupOverrideMinutes??t.setupMinutes)}${t.setupOverrideMinutes!=null?` <small class="setup-modified" title="Tempo teorico ${c.esc(c.mins(theoreticalSetup(c.state,t)))}">modificato</small>`:''}${canPlace?' <button type="button" class="link-button" id="selection-setup-edit" aria-label="Modifica il tempo di attrezzaggio">Modifica</button>':''}`;
  const placement=canPlace?`<details class="selection-placement-box" ${t.status==='unplanned'?'open':''}><summary>${t.status==='unplanned'?'Posiziona attività':'Modifica posizione'}</summary><form id="selection-placement">${machineField}<div class="placement-row"><label>Posizione<select name="mode" aria-label="Inserisci attività"><option value="end">In coda</option><option value="before" ${choices.length?'':'disabled'}>Prima</option><option value="after">Dopo</option></select></label><label id="selection-reference-label" hidden>Attività di riferimento<select name="targetId" aria-label="Attività di riferimento"></select></label></div><p class="selection-help" id="selection-placement-help"></p><button type="submit" class="button primary">${submitLabel(t,'end')}</button></form></details>`:`<p class="selection-help">${locked(t)?'Attività bloccata: puoi consultarla, ma non spostarla.':'Attività annullata: usa la scheda completa per ripristinarla.'}</p>`;
  return `<div class="selection-heading"><h2 id="selection-heading" tabindex="-1">Attività selezionata</h2><button class="icon-button" id="clear-planning-selection" aria-label="Chiudi riepilogo attività">×</button></div><div class="selection-body">
  <div class="selection-information"><div class="selection-states">${c.badge(t.status)}<span class="dispatch-state dispatch-tone" data-tone="${c.esc(dispatchTone(t))}">${c.esc(dispatchLabel(t))}</span>${t.fixedStart?'<span class="planning-pin" title="Data fissata: l’inizio resta com’è finché non la rimuovi">Data fissata <button type="button" class="link-button" id="selection-unpin" aria-label="Rimuovi data fissata">Rimuovi</button></span>':''}</div><h3>${c.esc(t.title)}</h3>${subtitle}${titleFacts.length?`<p class="selection-title-facts">${titleFacts.map(value=>c.esc(value)).join(' · ')}</p>`:''}${referenceInTitle?'':`<p class="selection-reference"><span>Riferimento operativo</span><strong>${c.esc(reference)}</strong></p>`}
  ${warning?`<p class="selection-warning" role="status">${c.esc(warning)}</p>`:''}
  <dl class="selection-facts"><div><dt>Prodotto</dt><dd>${c.esc(t.productCode||'Non indicato')}</dd></div><div><dt>Quantità</dt><dd>${c.esc(quantity)}</dd></div><div><dt>Attrezzaggio</dt><dd>${setup}</dd></div><div><dt>Lavorazione</dt><dd>${c.mins(t.runMinutes)}</dd></div><div><dt>Inizio</dt><dd>${c.fmt(t.start)}</dd></div><div><dt>Fine</dt><dd>${t.end?c.fmt(t.end):'Non pianificata'}</dd></div></dl>
  ${placement}
  <details class="selection-materials"><summary>Componenti e descrizioni</summary>${c.materialDetails(t)}</details></div>
  <div class="selection-actions"><button class="button secondary" id="selection-details">Scheda completa</button>${t.start?'<button class="button secondary" id="selection-focus">Mostra giorno e macchina</button>':''}${t.status==='planned'?'<button class="button subtle" id="selection-unplan" title="La rimozione arriva al reparto solo con il prossimo invio del piano; l’attività torna tra quelle da pianificare.">Togli dal piano</button>':''}</div></div>`;
}
export function bindPlanningSelection(c) {
  const root=document.querySelector('#planning-selection');
  root.onkeydown=e=>{if(e.key==='Escape'&&!e.target.matches('select')){e.preventDefault();c.clear();}};
  root.querySelector('#clear-planning-selection')?.addEventListener('click',c.clear);
  root.querySelector('#selection-details')?.addEventListener('click',()=>c.taskDetails(c.selectedTaskId));
  root.querySelector('#selection-setup-edit')?.addEventListener('click',()=>c.setupDialog(c.selectedTaskId));
  root.querySelector('#selection-focus')?.addEventListener('click',c.focusTask);
  root.querySelector('#selection-unpin')?.addEventListener('click',async()=>{const task=c.state.tasks.find(t=>t.id===c.selectedTaskId),queue=c.state.tasks.filter(t=>t.machineId===task.machineId&&t.position!==null).sort((a,b)=>a.position-b.position),next=queue[queue.findIndex(t=>t.id===task.id)+1];try{await c.mutate({kind:'plan',id:task.id,beforeId:next?.id||''},true);}catch(error){c.toast(error.message,true);}});
  root.querySelector('#selection-unplan')?.addEventListener('click',async()=>{try{await c.mutate({kind:'plan',id:c.selectedTaskId,unplan:true},true);}catch(e){c.toast(e.message,true);}});
  const form=root.querySelector('#selection-placement');if(!form)return;
  const task=c.state.tasks.find(t=>t.id===c.selectedTaskId),label=root.querySelector('#selection-reference-label'),help=root.querySelector('#selection-placement-help');
  const update=()=>{const destination={...task,machineId:form.elements.machineId.value};for(const optionMode of ['before','after'])form.elements.mode.querySelector(`[value="${optionMode}"]`).disabled=!placementChoices(c.state.tasks,destination,optionMode).length;if(['before','after'].includes(form.elements.mode.value)&&form.elements.mode.selectedOptions[0].disabled)form.elements.mode.value='end';const mode=form.elements.mode.value;label.hidden=mode==='end';help.textContent=placementHint(mode);help.title=placementHelp(mode);const button=form.querySelector('[type=submit]');button.textContent=submitLabel(task,mode);const choices=placementChoices(c.state.tasks,destination,mode);form.elements.targetId.innerHTML=choices.map(t=>`<option value="${c.esc(t.id)}">${c.esc(t.title)}${locked(t)?' · bloccata':''}</option>`).join('');form.elements.targetId.required=mode==='before'||mode==='after';};
  if(!placementChoices(c.state.tasks,task,'after').length)form.elements.mode.querySelector('[value="after"]').disabled=true;
  form.elements.mode.onchange=update;form.elements.machineId.onchange=update;update();
  form.onsubmit=async e=>{e.preventDefault();const b=form.querySelector('[type="submit"]');b.disabled=true;try{const action=placementAction(c.state.tasks,c.selectedTaskId,form.elements.mode.value,form.elements.targetId.value,form.elements.machineId.value);if(action)await c.mutate(action,true);else c.toast('L’attività è già in questa posizione.');}catch(err){c.toast(err.message,true);}finally{if(b.isConnected)b.disabled=false;}};
}
