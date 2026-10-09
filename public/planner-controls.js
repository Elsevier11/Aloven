const locked = t => ['in_progress','completed'].includes(t.status);
export function placementChoices(tasks, task, mode) {
  const sequence=tasks.filter(t=>t.machineId===task.machineId&&t.position!==null&&t.id!==task.id).sort((a,b)=>a.position-b.position);
  const boundary=sequence.findLastIndex(locked);
  return mode==='after'?sequence.slice(Math.max(0,boundary)):sequence.slice(boundary+1);
}
export function placementAction(tasks,id,mode,targetId) {
  const task=tasks.find(t=>t.id===id);
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
  if(task.status==='planned'&&next===beforeId)return null;
  return {kind:'plan',id,beforeId};
}
export function planningSelection(c) {
  const t=c.state.tasks.find(t=>t.id===c.selectedTaskId);
  if(!t)return '';
  const choices=placementChoices(c.state.tasks,t,'before');
  const warning=c.warnings.get(t.id);
  const quantity=t.quantity==null?'Non indicata':`${new Intl.NumberFormat('it-IT').format(t.quantity)} ${c.unitLabel(c.state.articles.find(a=>a.id===t.productArticleId)?.unit||'m')}`;
  return `<div class="selection-heading"><h2 id="selection-heading" tabindex="-1">Attività selezionata</h2><button class="icon-button" id="clear-planning-selection" aria-label="Chiudi riepilogo attività">×</button></div><div class="selection-body">
  <div class="selection-information">${c.badge(t.status)}<h3>${c.esc(t.title)}</h3><p class="selection-machine">${c.esc(c.machine(t.machineId)?.name)}</p><p>${c.esc(c.type(t.typeId)?.name)}</p>
  ${warning?`<p class="selection-warning" role="status">${c.esc(warning)}</p>`:''}
  <dl class="selection-facts"><div><dt>Prodotto</dt><dd>${c.esc(t.productCode||'Non indicato')}</dd></div><div><dt>Quantità prevista</dt><dd>${c.esc(quantity)}</dd></div><div><dt>Attrezzaggio</dt><dd>${c.mins(t.effectiveSetupMinutes??t.setupMinutes)}</dd></div><div><dt>Lavorazione</dt><dd>${c.mins(t.runMinutes)}</dd></div><div><dt>Inizio previsto</dt><dd>${c.fmt(t.start)}</dd></div><div><dt>Fine prevista</dt><dd>${t.end?c.fmt(t.end):'Non pianificata'}</dd></div></dl>
  <details class="selection-materials"><summary>Componenti e descrizioni</summary>${c.materialDetails(t)}</details></div>
  ${['planned','unplanned'].includes(t.status)?`<form id="selection-placement"><h3>${t.status==='unplanned'?'Assegna alla sequenza':'Modifica la posizione'}</h3><label>Inserisci<select name="mode" aria-label="Inserisci attività"><option value="end">In coda alla macchina</option><option value="before" ${choices.length?'':'disabled'}>Prima di un’attività</option><option value="after">Dopo un’attività</option></select></label><label id="selection-reference-label" hidden>Attività di riferimento<select name="targetId" aria-label="Attività di riferimento"></select></label><p class="selection-help">Le date dipendono dal calendario e dalla sequenza. L’anteprima mostra gli effetti prima del salvataggio.</p><button type="submit" class="button primary">Anteprima ${t.status==='unplanned'?'assegnazione':'spostamento'}</button></form>`:`<p class="selection-help">${locked(t)?'Attività bloccata: puoi consultarla, ma non spostarla.':'Attività annullata: usa la scheda completa per ripristinarla.'}</p>`}
  <div class="selection-actions"><button class="button secondary" id="selection-details">Scheda completa</button>${t.start?'<button class="button secondary" id="selection-focus">Mostra giorno e macchina</button>':''}${t.status==='planned'?'<button class="button subtle" id="selection-unplan">Torna da assegnare</button>':''}</div></div>`;
}
export function bindPlanningSelection(c) {
  const root=document.querySelector('#planning-selection');
  root.onkeydown=e=>{if(e.key==='Escape'&&!e.target.matches('select')){e.preventDefault();c.clear();}};
  root.querySelector('#clear-planning-selection')?.addEventListener('click',c.clear);
  root.querySelector('#selection-details')?.addEventListener('click',()=>c.taskDetails(c.selectedTaskId));
  root.querySelector('#selection-focus')?.addEventListener('click',c.focusTask);
  root.querySelector('#selection-unplan')?.addEventListener('click',async()=>{try{await c.mutate({kind:'plan',id:c.selectedTaskId,unplan:true},true);}catch(e){c.toast(e.message,true);}});
  const form=root.querySelector('#selection-placement');if(!form)return;
  const task=c.state.tasks.find(t=>t.id===c.selectedTaskId),label=root.querySelector('#selection-reference-label');
  const update=()=>{const mode=form.elements.mode.value;label.hidden=mode==='end';const choices=placementChoices(c.state.tasks,task,mode);form.elements.targetId.innerHTML=choices.map(t=>`<option value="${c.esc(t.id)}">${c.esc(t.title)}${locked(t)?' · bloccata':''}</option>`).join('');form.elements.targetId.required=mode!=='end';};
  if(!placementChoices(c.state.tasks,task,'after').length)form.elements.mode.querySelector('[value="after"]').disabled=true;
  form.elements.mode.onchange=update;update();
  form.onsubmit=async e=>{e.preventDefault();const b=form.querySelector('[type="submit"]');b.disabled=true;try{const action=placementAction(c.state.tasks,c.selectedTaskId,form.elements.mode.value,form.elements.targetId.value);if(action)await c.mutate(action,true);else c.toast('L’attività è già in questa posizione.');}catch(err){c.toast(err.message,true);}finally{if(b.isConnected)b.disabled=false;}};
}
