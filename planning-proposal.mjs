import {scheduleMachine, validateCalendar} from './scheduler.mjs';
import {effectiveMachineCalendar} from './public/calendar.js';

export function migratePlanningCompatibility(db){
  db.exec('BEGIN IMMEDIATE');
  try{
    if(db.prepare("SELECT 1 FROM meta WHERE key='planning-compatibility-v1'").get()){db.exec('COMMIT');return {migrated:false};}
    const columns=new Set(db.prepare('PRAGMA table_info(tasks)').all().map(x=>x.name));
    if(!columns.has('compatibleMachineIds'))db.exec("ALTER TABLE tasks ADD COLUMN compatibleMachineIds TEXT NOT NULL DEFAULT '[]'");
    if(!columns.has('preferredMachineId'))db.exec('ALTER TABLE tasks ADD COLUMN preferredMachineId TEXT');
    const update=db.prepare('UPDATE tasks SET compatibleMachineIds=? WHERE id=?');
    for(const t of db.prepare('SELECT id,machineId FROM tasks').all())update.run(JSON.stringify([t.machineId]),t.id);
    db.prepare('INSERT INTO meta(key,value) VALUES (?,?)').run('planning-compatibility-v1','1');
    db.prepare("UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'").run();
    db.exec('COMMIT');return {migrated:true};
  }catch(error){db.exec('ROLLBACK');throw error;}
}

export function compatibilityFields(values,existing,machines){
  const destination=values.machineId??existing?.machineId;
  let ids=values.compatibleMachineIds??existing?.compatibleMachineIds??[destination];
  if(typeof ids==='string'){try{ids=JSON.parse(ids);}catch{throw new Error('Macchine compatibili non valide.');}}
  // Legacy clients explicitly choosing another destination retain their former ability.
  if(values.compatibleMachineIds===undefined&&existing&&ids.length===1&&ids[0]===existing.machineId&&destination!==existing.machineId)ids=[destination];
  if(!Array.isArray(ids)||!ids.length||ids.some(id=>typeof id!=='string'||!machines.some(m=>m.id===id))||new Set(ids).size!==ids.length)throw new Error('Seleziona almeno una macchina compatibile valida.');
  if(!ids.includes(destination))throw new Error('La macchina di destinazione deve essere compatibile.');
  const preferred=values.preferredMachineId===undefined?(ids.includes(existing?.preferredMachineId)?existing.preferredMachineId:null):(values.preferredMachineId||null);
  if(preferred&&!ids.includes(preferred))throw new Error('La macchina preferita deve essere compatibile.');
  return {compatibleMachineIds:ids,preferredMachineId:preferred};
}

const calendarFor=(s,id)=>effectiveMachineCalendar(s.calendar,id);
const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v+'T12:00Z'))&&new Date(v+'T12:00Z').toISOString().slice(0,10)===v;
function minutes(v){return Date.parse(v+'Z')/60000;}

/** Explicit candidates are appended to the existing queue; no existing activity is removed. */
export function proposePeriod(input,{from,to,machineIds,taskIds},options={}){
  if(!validDate(from)||!validDate(to)||from>to||Date.parse(to)-Date.parse(from)>366*86400000)throw new Error('Seleziona un periodo valido, massimo un anno.');
  if(!Array.isArray(machineIds)||!machineIds.length||new Set(machineIds).size!==machineIds.length||machineIds.some(id=>!input.machines.some(m=>m.id===id)))throw new Error('Seleziona macchine valide.');
  if(!Array.isArray(taskIds)||new Set(taskIds).size!==taskIds.length||taskIds.some(id=>!input.tasks.some(t=>t.id===id)))throw new Error('Seleziona attività valide.');
  const state=structuredClone(input),included=[],excluded=[],load=[];
  const start=from+'T00:00',end=to+'T23:59';
  const notBefore=options.notBefore??start;
  if(typeof notBefore!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(notBefore)||!Number.isFinite(Date.parse(notBefore+'Z')))throw new Error('Ora minima della proposta non valida.');
  const candidates=taskIds.map(id=>state.tasks.find(t=>t.id===id)).sort((a,b)=>(a.dueDate||'9999').localeCompare(b.dueDate||'9999')||a.title.localeCompare(b.title)||a.id.localeCompare(b.id));
  for(const t of candidates)if(t.status!=='unplanned'||!machineIds.includes(t.machineId))excluded.push({id:t.id,reason:t.status!=='unplanned'?'Attività già pianificata o non disponibile':'Macchina di destinazione fuori dalla selezione'});
  for(const id of machineIds){
    const machine=state.machines.find(m=>m.id===id),cal=calendarFor(state,id);validateCalendar(cal);
    const stopped=state.machineStops?.some(s=>s.machineId===id&&!s.endedAt);
    const sequence=state.tasks.filter(t=>t.machineId===id&&t.position!==null&&t.position!==undefined&&t.status!=='cancelled').sort((a,b)=>a.position-b.position);
    let anchor=machine.anchor;
    const originalPending=state.tasks.filter(t=>t.machineId===id&&t.status==='planned'&&t.position!=null);
    // Existing dates are retained. An empty queue starts in the requested period.
    if(!sequence.length&&anchor<start)anchor=start;
    let scheduled=structuredClone(sequence);
    for(const candidate of candidates.filter(t=>t.status==='unplanned'&&t.machineId===id)){
      if(stopped){excluded.push({id:candidate.id,reason:'Fermo macchina aperto: disponibilità da verificare'});continue;}
      // Append from the later of the queue end and period start, without shifting existing work.
      const cursor=scheduled.length?scheduled.at(-1).end:anchor;
      const earliest=[cursor,start,notBefore].sort().at(-1);
      const previous=sequence.at(-1),setup=candidate.setupOverrideMinutes!=null?candidate.setupOverrideMinutes:previous?state.setupRules?.find(r=>r.machineId===id&&r.fromTypeId===previous.typeId&&r.toTypeId===candidate.typeId)?.minutes??candidate.setupMinutes:candidate.setupMinutes;
      let item;
      try{item=scheduleMachine([{...candidate,status:'planned',setupMinutes:setup}],earliest,cal)[0];}catch(error){excluded.push({id:candidate.id,reason:error.message});continue;}
      if(item.end>end){excluded.push({id:candidate.id,reason:'Non entra interamente nel periodo'});continue;}
      const assigned={...item,setupMinutes:candidate.setupMinutes,effectiveSetupMinutes:setup,position:sequence.length};
      sequence.push(assigned);scheduled.push(assigned);Object.assign(candidate,assigned);included.push(candidate.id);
    }
    // Preserve deliberate period anchor through the normal scheduler used by later edits.
    if(included.some(taskId=>state.tasks.find(t=>t.id===taskId)?.machineId===id)){
      if(!originalPending.some(t=>t.start&&t.start<start)&&machine.anchor<start)machine.anchor=start;
      if(sequence.length&&sequence[0].start&&sequence[0].start>machine.anchor&&!['completed','in_progress'].includes(sequence[0].status))machine.anchor=sequence[0].start;
      for(const row of scheduled)Object.assign(state.tasks.find(t=>t.id===row.id),row);
    }
    let available=0;for(let d=Date.parse(from+'T12:00Z');d<=Date.parse(to+'T12:00Z');d+=86400000){const day=new Date(d).toISOString().slice(0,10),shifts=cal.exceptions[day]??cal.weekly[new Date(d).getUTCDay()]??[];for(const [a,b] of shifts)available+=(Number(b.slice(0,2))*60+Number(b.slice(3)))-(Number(a.slice(0,2))*60+Number(a.slice(3)));}
    let occupied=0;for(const t of scheduled)for(const segment of t.segments||[])occupied+=Math.max(0,Math.min(minutes(segment.end),minutes(end)+1)-Math.max(minutes(segment.start),minutes(start)));
    load.push({machineId:id,available,occupied,residual:Math.max(0,available-occupied),uncertain:Boolean(stopped||sequence.some(t=>t.status==='in_progress'))});
  }
  return {state,included,excluded,load,from,to};
}
