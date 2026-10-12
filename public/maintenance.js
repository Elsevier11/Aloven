export function maintenanceDialog(c,machineId,id){
 const {state,esc,fmt,openDialog,dialogHeader,dialogFooter,mutate}=c;
 const blocks=(state.calendar.maintenanceBlocks||[]).filter(b=>b.machineId===machineId).sort((a,b)=>a.start.localeCompare(b.start));
 const block=blocks.find(b=>b.id===id),resource=state.machines.find(m=>m.id===machineId);
 const start=block?.start||`${c.dateStart}T08:00`,end=block?.end||`${c.dateStart}T09:00`;
 openDialog(`${dialogHeader(block?'Modifica indisponibilità':'Inserisci manutenzione / indisponibilità',esc(resource?.name))}<form><div class="dialog-body"><label>Descrizione<input name="name" maxlength="120" required value="${esc(block?.name||'Manutenzione')}"></label><div class="form-grid"><label>Inizio indisponibilità<input type="datetime-local" name="start" required value="${esc(start)}"></label><label>Fine indisponibilità<input type="datetime-local" name="end" required value="${esc(end)}"></label></div><p class="notice">Il blocco riduce la disponibilità della macchina. Le attività coinvolte e quelle successive vengono ricalcolate nella bozza, rispettando turni e attrezzaggi. Prima di salvare vedrai le nuove date.</p>${block?'<button type="button" class="button danger subtle" data-remove-maintenance>Rimuovi indisponibilità…</button>':''}${!block&&blocks.length?`<details class="maintenance-list"><summary>Indisponibilità programmate · ${blocks.length}</summary>${blocks.map(b=>`<button type="button" class="button subtle" data-edit-maintenance="${esc(b.id)}"><strong>${esc(b.name)}</strong><span>${fmt(b.start)} → ${fmt(b.end)}</span></button>`).join('')}</details>`:''}</div>${dialogFooter('Mostra anteprima')}</form>`,async f=>{
  const start=f.get('start'),end=f.get('end');
  if(end<=start)throw new Error('La fine deve essere successiva all’inizio.');
  await mutate({kind:'maintenance',machineId,...(id?{id}:{}),name:f.get('name').trim(),start,end},true);
 },{protectUnsaved:true});
 const modal=document.querySelector('#modal');
 modal.querySelector('[data-remove-maintenance]')?.addEventListener('click',async event=>{
  const button=event.currentTarget;button.disabled=true;
  try{await mutate({kind:'maintenance',machineId,id,remove:true},true);}catch(error){button.disabled=false;c.toast(error.message,true);}
 });
 modal.querySelectorAll('[data-edit-maintenance]').forEach(button=>button.onclick=()=>maintenanceDialog(c,machineId,button.dataset.editMaintenance));
}
